/**
 * Essay-marks template builder.
 *
 * Produces a downloadable `.xlsx` pre-populated one row per participant × essay
 * subject from the current roster, so the marking team never types a
 * ParticipantID by hand. The sheet names (AFL / ESL) and column headers
 * (`ParticipantID`, `TotalScore`) are exactly what the EXISTING `parseEssayMarks`
 * consumes, so a filled-in template round-trips straight back through the current
 * upload path — no new parser. `MaxMark` is a read-only reference column the
 * parser ignores; `TotalScore` is left blank for the marker to fill (0..MaxMark).
 *
 * Reuses the repo's `xlsx-js-style` sheet library (via `lib/export/sheet-utils`),
 * the same one the analysis workbooks use.
 */
import { XLSX, sanitizeSheetName, HEADER_STYLE, META_STYLE, styleCell } from "@/lib/export/sheet-utils";
import type { EssayUploadContext } from "./types";

const HEADERS = ["ParticipantID", "Student", "Subject", "TotalScore", "MaxMark"] as const;

/** Build the essay-marks template workbook from the read-only upload context. */
export function buildEssayTemplateWorkbook(context: EssayUploadContext): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  for (const subject of context.subjects) {
    const aoa: (string | number)[][] = [
      [...HEADERS],
      ...subject.participants.map((p) => [p.participantId, p.name, subject.name, "", context.essayItemMax]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Bold header row; grey out the read-only MaxMark column values so it reads as
    // reference, not an input the marker should touch.
    for (let c = 0; c < HEADERS.length; c++) styleCell(ws, 0, c, HEADER_STYLE);
    for (let r = 1; r <= subject.participants.length; r++) styleCell(ws, r, HEADERS.length - 1, META_STYLE);

    ws["!cols"] = [{ wch: 16 }, { wch: 22 }, { wch: 26 }, { wch: 12 }, { wch: 10 }];
    // Name the sheet by its subject code so parseEssayMarks maps it (AFL/ESL).
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(subject.code, used));
  }

  return wb;
}

/** Suggested file name for the downloaded template. */
export const ESSAY_TEMPLATE_FILENAME = "essay_marks_template.xlsx";
