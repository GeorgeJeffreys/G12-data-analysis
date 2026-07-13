/**
 * Essay-marks template generator — the app owns ONE fixed template on both ends:
 * it CLONES the stored canonical workbook and parses only this shape
 * (`lib/data/parse-essay-masterfile.ts`).
 *
 * The canonical structure is the stored asset `G12_Essay_Marks_FIXED_TEMPLATE.xlsx`
 * (`public/templates/…`). "Download template" does NOT regenerate the marking
 * formulas from scratch — it clones the stored template's header + per-student
 * block (formulas intact) and stamps one block per roster participant with the
 * identity columns (`QM email`, `Student name`, `Alsama Student ID`) PRE-FILLED
 * from the current cohort's roster and every mark/dim cell cleared. Emails are
 * therefore always roster-sourced and never hand-typed, so the join key can't
 * drift.
 *
 * The stored asset holds exactly ONE blank student block after the header; that
 * block is the prototype. Its relative formulas (`AVERAGE(F2:F5)` …) are re-based
 * per student so each cloned block auto-computes over its own rows.
 *
 * The roster comes from the SAME participant source the score path uses
 * (`getEssayContext` → the subject's responses), so no identity is hand-mapped.
 *
 * Reuses the repo's `xlsx-js-style` (via `lib/export/sheet-utils`) to read the
 * stored asset (preserving formulas + styles) and write the cloned workbook.
 */
import { XLSX, sanitizeSheetName } from "@/lib/export/sheet-utils";
import type { EssayUploadContext, EssaySubjectContext } from "./types";
import { sheetSubjectCode, normalizeHeader, EMAIL_HEADER } from "./parse-essay-masterfile";

/** Suggested file name for the downloaded template + the stored asset's basename. */
export const ESSAY_TEMPLATE_FILENAME = "G12_Essay_Marks_FIXED_TEMPLATE.xlsx";
/** Public path of the canonical structural asset the generator clones. */
export const ESSAY_TEMPLATE_ASSET_PATH = "/templates/G12_Essay_Marks_FIXED_TEMPLATE.xlsx";

/** Sheet name per subject code — the parser routes back to the subject by this name. */
function sheetNameFor(code: "AFL" | "ESL"): string {
  return code === "ESL" ? "English Essay master" : "Arabic Essay master";
}

/**
 * Shift every A1-style row reference in a formula by `delta`. Block formulas only
 * reference rows inside their own block, so a uniform shift re-bases a cloned block
 * onto its own rows (`AVERAGE(F2:F5)` → `AVERAGE(F6:F9)`). Column letters and bare
 * numeric literals (a `/2` divisor) are left untouched.
 */
function rebaseFormula(f: string, delta: number): string {
  if (!delta) return f;
  return f.replace(/(\$?[A-Za-z]{1,3}\$?)(\d+)/g, (_m, col: string, row: string) => `${col}${Number(row) + delta}`);
}

type Cell = XLSX.CellObject;

/** Clone the source sheet's structure and stamp one block per roster participant. */
function cloneSheetForRoster(srcWs: XLSX.WorkSheet, subject: EssaySubjectContext): XLSX.WorkSheet {
  const range = XLSX.utils.decode_range(srcWs["!ref"] ?? "A1");
  const nCols = range.e.c - range.s.c + 1;
  const at = (r: number, c: number): Cell | undefined => srcWs[XLSX.utils.encode_cell({ r, c })] as Cell | undefined;

  const headerNorm: string[] = [];
  for (let c = 0; c < nCols; c++) headerNorm.push(normalizeHeader(at(0, c)?.v));
  const emailCol = headerNorm.indexOf(EMAIL_HEADER);
  const nameCol = headerNorm.indexOf("student name");
  const alsamaCol = headerNorm.indexOf("alsama student id");

  // The prototype block = every data row of the stored asset (one blank student).
  const proto: (Cell | undefined)[][] = [];
  for (let r = 1; r <= range.e.r; r++) {
    const row: (Cell | undefined)[] = [];
    for (let c = 0; c < nCols; c++) row.push(at(r, c));
    proto.push(row);
  }
  const BLOCK = Math.max(proto.length, 1);

  const out: XLSX.WorkSheet = {};
  // Header — copied verbatim (value + style).
  for (let c = 0; c < nCols; c++) {
    const h = at(0, c);
    if (h) out[XLSX.utils.encode_cell({ r: 0, c })] = { t: h.t, v: h.v, s: h.s } as Cell;
  }

  let outR = 1;
  subject.participants.forEach((p, i) => {
    const delta = i * BLOCK;
    for (let br = 0; br < proto.length; br++) {
      const rr = outR++;
      for (let c = 0; c < nCols; c++) {
        const addr = XLSX.utils.encode_cell({ r: rr, c });
        // Identity columns: PRE-FILL from the roster on every row of the block.
        if (c === emailCol) { out[addr] = { t: "s", v: p.studentId } as Cell; continue; }
        if (c === nameCol) { out[addr] = { t: "s", v: p.name } as Cell; continue; }
        if (c === alsamaCol) { out[addr] = { t: "s", v: p.participantId } as Cell; continue; }
        const cell = proto[br]![c];
        if (!cell) continue; // blank prototype cell → cleared mark/dim, stays blank
        if (cell.f) { out[addr] = { t: "n", f: rebaseFormula(cell.f, delta), s: cell.s } as Cell; continue; }
        // Non-formula prototype content (Essay ID / Marker labels). Mark/dim value
        // cells are blank in the asset, so this never carries a mark.
        out[addr] = { t: cell.t, v: cell.v, s: cell.s } as Cell;
      }
    }
  });

  out["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(outR - 1, 0), c: nCols - 1 } });
  if (srcWs["!cols"]) out["!cols"] = srcWs["!cols"];
  return out;
}

/**
 * Build the essay template by CLONING the stored canonical asset and pre-filling
 * identity from the roster. `stored` is the raw bytes of the stored asset workbook
 * (loaded via `ESSAY_TEMPLATE_ASSET_PATH` in the browser, or read from disk in
 * tests). One sheet is emitted per essay subject in the registry (`context.subjects`
 * — English + Arabic, never hardcoded); each sheet clones the stored sheet whose
 * name routes to that subject.
 */
export function buildEssayTemplateWorkbook(stored: ArrayBuffer | Uint8Array, context: EssayUploadContext): XLSX.WorkBook {
  const src = XLSX.read(stored, { type: "array" });
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const subject of context.subjects) {
    const srcName = src.SheetNames.find((n) => sheetSubjectCode(n) === subject.code) ?? src.SheetNames[0]!;
    const ws = cloneSheetForRoster(src.Sheets[srcName]!, subject);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetNameFor(subject.code), used));
  }
  return wb;
}
