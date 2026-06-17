/**
 * POST /api/cycles/:cycleId/recompute — server-side engine write path.
 *
 * Runs the TypeScript engine over the cycle's data and persists item_stats +
 * participant_scores. The engine must never run in the browser, so this lives in
 * a Node route handler. The caller is authorized as a lead_admin of the cycle via
 * the RLS-scoped session client; the privileged writes then use the secret-key
 * admin client (see lib/server/engine-write.ts).
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recomputeAndWrite } from "@/lib/server/engine-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { cycleId: string } }) {
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

  try {
    const admin = createAdminClient();
    const result = await recomputeAndWrite(admin, cycleId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // Log the full error server-side only; return a generic message so a raw
    // Supabase/`Headers.set` error (which can embed the secret key) never reaches
    // the browser.
    console.error(`recompute failed for cycle ${cycleId}:`, e);
    return NextResponse.json(
      { error: "Couldn't connect to the data store — check configuration." },
      { status: 500 },
    );
  }
}
