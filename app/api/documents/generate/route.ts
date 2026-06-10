/**
 * Dev document-generation endpoint: receives the Student Summary + uploaded
 * PowerPoint template(s), runs the adapted Python renderer, and returns the
 * per-student/per-kind result with download URLs.
 *
 * Node runtime only (shells out to python3 + LibreOffice). NOT for Vercel
 * serverless in production — see lib/documents/generator.ts.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { runDocGen } from "@/lib/documents/server";
import type { DocKind } from "@/lib/documents/types";
import type { DocSettings, StudentSummary } from "@/lib/data/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Payload {
  cycleId: string;
  kinds: DocKind[];
  students: StudentSummary[];
  settings: DocSettings;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const raw = form.get("payload");
  if (typeof raw !== "string") {
    return NextResponse.json({ error: "Missing payload." }, { status: 400 });
  }
  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid payload JSON." }, { status: 400 });
  }

  if (!Array.isArray(payload.kinds) || payload.kinds.length === 0) {
    return NextResponse.json({ error: "Choose at least one document type." }, { status: 400 });
  }
  if (!Array.isArray(payload.students) || payload.students.length === 0) {
    return NextResponse.json({ error: "No students — lock grades first." }, { status: 400 });
  }

  const templates: Partial<Record<DocKind, Buffer>> = {};
  for (const kind of payload.kinds) {
    const file = form.get(kind);
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: `Upload a ${kind} template.` }, { status: 400 });
    }
    templates[kind] = Buffer.from(await file.arrayBuffer());
  }

  try {
    const result = await runDocGen({
      jobId: randomUUID(),
      kinds: payload.kinds,
      students: payload.students,
      settings: payload.settings,
      templates,
    });
    return NextResponse.json(result);
  } catch (e) {
    // Surface the real underlying failure (spawn / LibreOffice stderr) rather
    // than a generic 500 so the cause is visible.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
