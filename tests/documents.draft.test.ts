/**
 * P4 — draft vs official certificate export. Proves the SAME generator (no fork)
 * produces a watermarked, DRAFT-named bundle when `draft: true` and a clean
 * official bundle otherwise. Real issuance is gated in the UI on the O1/O2
 * sign-off; this covers the generator half of that gate.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getDocumentGenerator, DRAFT_WATERMARK } from "@/lib/documents/generator";
import type { GenerateRequest } from "@/lib/documents/types";
import type { StudentSummary, DocSettings } from "@/lib/data/types";

// JSZip emits a Blob; the generator wraps it in an object URL. Node has Blob but
// object URLs need a deterministic stub for the test.
beforeAll(() => {
  (URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL = () => "blob:test";
});

function templateBuffer(): ArrayBuffer {
  const buf = fs.readFileSync(path.resolve(__dirname, "../public/templates/certificate_template.pptx"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const STUDENTS: StudentSummary[] = [
  { participantId: "P1", name: "Sara Khan", award: "Distinction", subjects: [] },
  { participantId: "P2", name: "Omar Ali", award: "Advanced", subjects: [] },
];
const SETTINGS: DocSettings = {
  cycleName: "2026 · Overall",
  testCentre: "Centre A",
  examDate: "2026-05-01",
  issueDate: "2026-06-01",
};

function req(draft: boolean): GenerateRequest {
  return {
    cycleId: "year-2026",
    kinds: ["certificate"],
    students: STUDENTS,
    settings: SETTINGS,
    templates: { certificate: templateBuffer() },
    draft,
  };
}

describe("certificate generator — draft vs official", () => {
  it("draft mode names the bundle DRAFT and surfaces a not-for-issue warning", async () => {
    const res = await getDocumentGenerator().generate(req(true));
    expect(res.zipName).toContain("_DRAFT");
    expect(res.fonts.warnings.some((w) => w.includes(DRAFT_WATERMARK))).toBe(true);
    // Every student still renders — drafts are real proofs, just watermarked.
    expect(res.kinds.certificate?.complete).toBe(STUDENTS.length);
  });

  it("official mode produces a clean bundle with no draft watermark", async () => {
    const res = await getDocumentGenerator().generate(req(false));
    expect(res.zipName).not.toContain("_DRAFT");
    expect(res.fonts.warnings.some((w) => w.includes(DRAFT_WATERMARK))).toBe(false);
    expect(res.kinds.certificate?.complete).toBe(STUDENTS.length);
  });
});
