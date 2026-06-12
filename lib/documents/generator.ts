"use client";

/**
 * DocumentGenerator — produces the certificate + performance-report documents.
 *
 * Implementation: in-browser PPTX templating + zip. For each student we fill the
 * existing `.pptx` templates by token replacement (docxtemplater over pizzip),
 * then bundle every generated `.pptx` into a single `.zip` (jszip) the browser
 * downloads. Staff open the `.pptx` files and export to PDF themselves.
 *
 * This replaces the old Python + LibreOffice worker path, which can't run on
 * Vercel serverless. Everything here runs client-side — no external worker, no
 * server route, no new hosting platform. The `DocumentGenerator` interface and
 * the swap-point (`getDocumentGenerator`) are unchanged.
 */
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import JSZip from "jszip";
import type { DocKind, GenerateRequest, GenerateResult, PerStudentStatus } from "./types";
import type { DocSettings, StudentSummary } from "@/lib/data/types";

export const DOCGEN_VERSION = "docgen-pptx-zip-1.0.0";

export interface DocumentGenerator {
  readonly version: string;
  /** Human-readable deployment mode, surfaced in the UI. */
  readonly mode: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/** Built-in templates live in /public/templates (copied from data/*.pptx). */
const BUILTIN_TEMPLATE: Record<DocKind, string> = {
  certificate: "/templates/certificate_template.pptx",
  report: "/templates/report_template.pptx",
};
const KIND_LABEL: Record<DocKind, string> = { certificate: "Certificate", report: "Performance Report" };

/** Filesystem-safe filename fragment. */
function safe(name: string): string {
  return (name || "Student").replace(/[\\/:*?"<>|]+/g, "_").trim();
}

/** The full token set for a student (templates use a subset; extras are ignored,
 *  and unknown tokens render empty via the nullGetter). */
function tokensFor(s: StudentSummary, settings: DocSettings): Record<string, string> {
  const data: Record<string, string> = {
    NAME: s.name,
    AWARD: s.award,
    RESULTID: s.participantId,
    TESTCENTRE: settings.testCentre,
    EXAMDATE: settings.examDate,
    ISSUEDATE: settings.issueDate,
    CYCLE: settings.cycleName,
  };
  for (const sub of s.subjects) {
    data[`${sub.slot}_STARS`] = sub.stars;
    data[`${sub.slot}_LEVEL`] = sub.level;
  }
  return data;
}

/** Fill one template for one student → a .pptx as a Uint8Array. */
function renderPptx(template: ArrayBuffer, data: Record<string, string>): Uint8Array {
  const zip = new PizZip(template);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  doc.render(data);
  return doc.getZip().generate({ type: "uint8array" });
}

async function loadTemplate(kind: DocKind, uploaded?: ArrayBuffer): Promise<ArrayBuffer> {
  if (uploaded) return uploaded;
  const res = await fetch(BUILTIN_TEMPLATE[kind]);
  if (!res.ok) throw new Error(`Could not load the built-in ${KIND_LABEL[kind]} template.`);
  return res.arrayBuffer();
}

class PptxZipDocumentGenerator implements DocumentGenerator {
  readonly version = DOCGEN_VERSION;
  readonly mode = "Browser PPTX → zip (no server worker)";

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const archive = new JSZip();
    const perStudent = new Map<string, PerStudentStatus>();
    const kinds: GenerateResult["kinds"] = {};

    for (const s of req.students) {
      perStudent.set(s.participantId, { id: s.participantId, name: s.name, award: s.award, results: {} });
    }

    for (const kind of req.kinds) {
      const template = await loadTemplate(kind, req.templates[kind]);
      let complete = 0;
      for (const s of req.students) {
        const ps = perStudent.get(s.participantId)!;
        try {
          const bytes = renderPptx(template, tokensFor(s, req.settings));
          archive.file(`${KIND_LABEL[kind]} - ${safe(s.name)}.pptx`, bytes);
          ps.results[kind] = { status: "complete" };
          complete += 1;
        } catch (e) {
          ps.results[kind] = { status: "error", error: (e as Error).message };
        }
      }
      kinds[kind] = { complete, total: req.students.length };
    }

    const blob = await archive.generateAsync({ type: "blob", compression: "DEFLATE" });
    const zipUrl = URL.createObjectURL(blob);
    const zipName = `${safe(req.settings.cycleName) || "documents"}_documents.zip`;

    return {
      jobId: `pptx-${Date.now()}`,
      fonts: {
        georgiaPresent: false,
        barlowPresent: false,
        warnings: [
          "Generated as editable .pptx. Open each file and export to PDF to finalise. Token replacement keeps the template design; non-embedded fonts may substitute on machines without them.",
        ],
      },
      kinds,
      perStudent: [...perStudent.values()],
      zipUrl,
      zipName,
    };
  }
}

const generator: DocumentGenerator = new PptxZipDocumentGenerator();

/** The active document generator. The only place to change to swap renderers. */
export function getDocumentGenerator(): DocumentGenerator {
  return generator;
}
