/**
 * Streams a generated artifact (zip or PDF) for a job. Dev-only; production
 * serves artifacts from object storage written by the worker.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { jobOutDir } from "@/lib/documents/server";

export const runtime = "nodejs";

const JOB_RE = /^[0-9a-f-]{36}$/i;
const FILE_RE = /^[\w.\- ]+\.(pdf|zip)$/i;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const job = url.searchParams.get("job") ?? "";
  const file = url.searchParams.get("file") ?? "";

  if (!JOB_RE.test(job) || !FILE_RE.test(file)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const full = path.join(jobOutDir(job), file);
  // Defence in depth: the resolved path must stay inside the job's out dir.
  if (!full.startsWith(jobOutDir(job) + path.sep)) {
    return NextResponse.json({ error: "Bad path." }, { status: 400 });
  }

  let data: Buffer;
  try {
    data = await readFile(full);
  } catch {
    return NextResponse.json({ error: "Not found (jobs are ephemeral)." }, { status: 404 });
  }

  const isZip = file.toLowerCase().endsWith(".zip");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": isZip ? "application/zip" : "application/pdf",
      "Content-Disposition": `attachment; filename="${file}"`,
    },
  });
}
