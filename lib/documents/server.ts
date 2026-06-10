/**
 * Server-only helpers for the dev document generator: writes a job, runs the
 * adapted Python renderer (python-pptx → LibreOffice → zip), and maps its output
 * to the `GenerateResult` the UI expects. NEVER import this from client code.
 */
import "server-only";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DocKind, GenerateResult, PerStudentStatus } from "./types";
import type { DocSettings, StudentSummary } from "@/lib/data/types";

export const JOB_ROOT = path.join(os.tmpdir(), "g12pp-docs");
const SCRIPT = path.join(process.cwd(), "scripts", "doc_gen.py");

export function jobOutDir(jobId: string): string {
  return path.join(JOB_ROOT, jobId, "out");
}

interface PyKind {
  zip?: string;
  complete?: number;
  total?: number;
  error?: string;
  perStudent?: Record<string, { status: string; file?: string; error?: string }>;
}
interface PyResult {
  fonts: { georgiaPresent: boolean; barlowPresent: boolean; warnings: string[] };
  kinds: Record<string, PyKind>;
}

export interface RunJob {
  jobId: string;
  kinds: DocKind[];
  students: StudentSummary[];
  settings: DocSettings;
  templates: Partial<Record<DocKind, Buffer>>;
}

function runPython(jobFile: string): Promise<PyResult> {
  return new Promise((resolve, reject) => {
    // Pass through the env the renderer needs: PATH (to resolve python3 /
    // soffice), the headless LibreOffice VCL plugin, and a writable HOME for the
    // LibreOffice profile. Without these the spawned child can't find or run
    // soffice, which is the most common "works by hand, fails in the route" bug.
    const env = {
      ...process.env,
      SAL_USE_VCLPLUGIN: "svp",
      HOME: process.env.HOME || "/tmp",
    };
    const child = spawn("python3", [SCRIPT, jobFile], { cwd: process.cwd(), env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new Error(`Could not spawn python3: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`doc_gen.py exited ${code}: ${err.slice(-1200)}`));
      try {
        resolve(JSON.parse(out) as PyResult);
      } catch {
        reject(new Error(`doc_gen.py produced no JSON. stdout: ${out.slice(-400)} stderr: ${err.slice(-800)}`));
      }
    });
  });
}

export async function runDocGen(job: RunJob): Promise<GenerateResult> {
  const jobDir = path.join(JOB_ROOT, job.jobId);
  const outDir = path.join(jobDir, "out");
  await mkdir(outDir, { recursive: true });

  const templatePaths: Partial<Record<DocKind, string>> = {};
  for (const kind of job.kinds) {
    const buf = job.templates[kind];
    if (!buf) continue;
    const p = path.join(jobDir, `${kind}.pptx`);
    await writeFile(p, buf);
    templatePaths[kind] = p;
  }

  const jobJson = {
    kinds: job.kinds,
    templates: templatePaths,
    settings: job.settings,
    students: job.students.map((s) => ({
      resultId: s.participantId,
      name: s.name,
      award: s.award,
      subjects: Object.fromEntries(s.subjects.map((su) => [su.slot, { level: su.level, stars: su.stars }])),
    })),
    outDir,
    workDir: path.join(jobDir, "work"),
    fontDir: path.join(jobDir, "fonts"),
  };
  const jobFile = path.join(jobDir, "job.json");
  await writeFile(jobFile, JSON.stringify(jobJson));

  const py = await runPython(jobFile);

  const dl = (file: string) =>
    `/api/documents/download?job=${encodeURIComponent(job.jobId)}&file=${encodeURIComponent(file)}`;

  const kinds: GenerateResult["kinds"] = {};
  for (const kind of job.kinds) {
    const k = py.kinds[kind];
    if (!k) continue;
    kinds[kind] = {
      complete: k.complete ?? 0,
      total: k.total ?? job.students.length,
      zipUrl: k.zip ? dl(k.zip) : undefined,
      error: k.error,
    };
  }

  const perStudent: PerStudentStatus[] = job.students.map((s) => {
    const results: PerStudentStatus["results"] = {};
    for (const kind of job.kinds) {
      const entry = py.kinds[kind]?.perStudent?.[s.participantId];
      if (!entry) continue;
      results[kind] =
        entry.status === "complete"
          ? { status: "complete", downloadUrl: entry.file ? dl(entry.file) : undefined }
          : { status: "error", error: entry.error };
    }
    return { id: s.participantId, name: s.name, award: s.award, results };
  });

  return { jobId: job.jobId, fonts: py.fonts, kinds, perStudent };
}
