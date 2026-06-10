/**
 * DocumentGenerator — the swap point for certificate/report rendering, mirroring
 * the discipline used for the computation engine and the DataProvider.
 *
 * ## Swap point
 *
 * The UI calls `getDocumentGenerator().generate(...)` and depends only on the
 * `DocumentGenerator` interface and the types in `./types`. The current
 * implementation (`HttpDocumentGenerator`) POSTs to a Next route handler that
 * shells out to `scripts/doc_gen.py` (python-pptx fill → LibreOffice → zip) —
 * fine for development.
 *
 * **Production must NOT render in a Vercel serverless function:** LibreOffice is
 * too heavy and slow for that runtime. The production implementation should
 * enqueue a job to a dedicated Python worker (queue + object storage for the
 * artifacts) and implement this same interface. Only this file changes.
 */
import type { GenerateRequest, GenerateResult } from "./types";

export const DOCGEN_VERSION = "docgen-dev-0.1.0";

export interface DocumentGenerator {
  readonly version: string;
  /** Human-readable deployment mode, surfaced in the UI. */
  readonly mode: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

class HttpDocumentGenerator implements DocumentGenerator {
  readonly version = DOCGEN_VERSION;
  readonly mode = "dev-local (Python + LibreOffice via /api/documents)";

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const form = new FormData();
    form.append(
      "payload",
      JSON.stringify({
        cycleId: req.cycleId,
        kinds: req.kinds,
        students: req.students,
        settings: req.settings,
      }),
    );
    for (const kind of req.kinds) {
      const buf = req.templates[kind];
      if (buf) {
        form.append(
          kind,
          new Blob([buf], {
            type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          }),
          `${kind}.pptx`,
        );
      }
    }

    const res = await fetch("/api/documents/generate", { method: "POST", body: form });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) detail = j.error;
      } catch {
        /* keep statusText */
      }
      throw new Error(detail);
    }
    return (await res.json()) as GenerateResult;
  }
}

const generator: DocumentGenerator = new HttpDocumentGenerator();

/** The active document generator. The only place to change when swapping in the worker. */
export function getDocumentGenerator(): DocumentGenerator {
  return generator;
}
