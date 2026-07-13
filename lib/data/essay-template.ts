/**
 * Essay-marks template generator (v2) — the app owns ONE fixed template on both
 * ends: it generates this workbook pre-filled from the roster, and it parses only
 * this shape (`lib/data/parse-essay-masterfile.ts`).
 *
 * Contract (see the parser for the read side):
 *  - `.xlsx` with two sheets `English Essay master` / `Arabic Essay master` — the
 *    SHEET NAME is the subject. Emitted for each essay subject in the registry
 *    (`context.subjects`, currently English + Arabic — never hardcoded here).
 *  - Header row: QM email · Student name · Alsama Student ID · Essay ID · Marker ·
 *    Mark (/20) · Final essay mark (/20).
 *  - 4 rows per roster participant (2 essays × markers M1/M2). Identity columns
 *    (QM email, Student name) are PRE-FILLED from the roster so the join key — the
 *    QM email — is never hand-typed and can't drift. `Final essay mark` on the
 *    block's first row is `=IFERROR(AVERAGE(F..F+3),"")` (auto-averages the four
 *    marks, blank until filled; the team types over it to moderate); blank on the
 *    other three rows.
 *
 * The roster comes from the SAME participant source the score path uses
 * (`getEssayContext` → the subject's responses), so no identity is hand-mapped.
 *
 * Reuses the repo's `xlsx-js-style` sheet library (via `lib/export/sheet-utils`).
 */
import { XLSX, sanitizeSheetName, HEADER_STYLE, styleCell, type CellStyle } from "@/lib/export/sheet-utils";
import type { EssayUploadContext } from "./types";

const HEADERS = [
  "QM email",
  "Student name",
  "Alsama Student ID",
  "Essay ID",
  "Marker",
  "Mark (/20)",
  "Final essay mark (/20)",
] as const;

/** Sheet name per subject code — the parser routes back to the subject by this name. */
function sheetNameFor(code: "AFL" | "ESL"): string {
  return code === "ESL" ? "English Essay master" : "Arabic Essay master";
}

/** Distinct fill so it's obvious which columns the team fills (Mark F, Final G). */
const FILL_STYLE: CellStyle = { fill: { patternType: "solid", fgColor: { rgb: "FFF2CC" } } };

/** Build the v2 essay template workbook from the read-only upload context. */
export function buildEssayTemplateWorkbook(context: EssayUploadContext): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  // Four working rows per student: 2 essays × 2 markers.
  const ESSAY_IDS = ["Essay 1", "Essay 1", "Essay 2", "Essay 2"];
  const MARKERS = ["M1", "M2", "M1", "M2"];

  for (const subject of context.subjects) {
    const aoa: (string | number)[][] = [[...HEADERS]];
    for (const p of subject.participants) {
      for (let k = 0; k < 4; k++) {
        // QM email = the roster's participant key (qm_participant_id = the email);
        // pre-filled so the join key is never hand-typed. Alsama Student ID is the
        // team's working column and is left blank (not an app identity).
        aoa.push([p.studentId, p.name, "", ESSAY_IDS[k]!, MARKERS[k]!, "", ""]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Header styling.
    for (let c = 0; c < HEADERS.length; c++) styleCell(ws, 0, c, HEADER_STYLE);

    // Per-student: the Final formula on the block's first row + fill the two input
    // columns (Mark F, Final G) across the block so they read as fillable.
    subject.participants.forEach((_p, i) => {
      const start = 2 + i * 4; // 1-based row of the block's first data row (header = 1)
      ws[`G${start}`] = { t: "n", f: `IFERROR(AVERAGE(F${start}:F${start + 3}),"")` };
      for (let r = start; r < start + 4; r++) {
        styleCell(ws, r - 1, 5, FILL_STYLE); // Mark (col F / index 5)
        styleCell(ws, r - 1, 6, FILL_STYLE); // Final (col G / index 6)
      }
    });

    ws["!cols"] = [{ wch: 30 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetNameFor(subject.code), used));
  }

  return wb;
}

/** Suggested file name for the downloaded template. */
export const ESSAY_TEMPLATE_FILENAME = "G12_Essay_Marks_TEMPLATE_v2.xlsx";
