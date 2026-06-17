/**
 * POST /api/cycles/:cycleId/ingest — raw-export ingest write path.
 *
 * Persists a cleaned, split combined export (assessments + items + participants +
 * the response matrix) for a cycle, then runs the engine write path so item_stats
 * and participant_scores are ready when the client re-hydrates. The browser parses
 * + cleans + validates the file (reusing lib/ingest) and POSTs the cleaned
 * responses here; the persist + engine work must run server-side (the engine never
 * runs in the browser, and these tables are not client-writable).
 *
 * The caller is authorized as a lead_admin of the cycle via the RLS-scoped session
 * client; the privileged writes then use the secret-key admin client.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestCleanResponses } from "@/lib/server/ingest-write";
import { recomputeAndWrite } from "@/lib/server/engine-write";
import type { CleanResponse, ValidationReport } from "@/lib/ingest/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IngestBody {
  clean: CleanResponse[];
  report?: ValidationReport;
  fileName?: string;
}

export async function POST(req: Request, { params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;

  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data } = await supabase.from("memberships").select("role,cycle_id").eq("user_id", user.id);
  const memberships = (data ?? []) as unknown as { role: string; cycle_id: string | null }[];
  const allowed = memberships.some(
    (m) => m.role === "lead_admin" && (m.cycle_id === null || m.cycle_id === cycleId),
  );
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.clean) || body.clean.length === 0) {
    return NextResponse.json({ error: "no cleaned responses to ingest" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const ingest = await ingestCleanResponses(admin, cycleId, body.clean, {
      fileRef: body.fileName,
      report: body.report,
    });
    const compute = await recomputeAndWrite(admin, cycleId);
    // Mark the cycle as past the draft/upload stage now that data is in. The
    // typed client marks `status` non-client-writable, but the secret-key admin
    // client is the sanctioned privileged writer (it bypasses RLS).
    await (admin.from as unknown as (n: string) => {
      update(v: unknown): { eq(c: string, val: string): Promise<{ error: { message: string } | null }> };
    })("exam_cycles").update({ status: "in_review" }).eq("id", cycleId);
    return NextResponse.json({ ok: true, ingest, compute });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
