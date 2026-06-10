/**
 * Per-student technical exclusions sheet — one canonical layout shared by the
 * Item-analysis workbook and the Grades workbook (both emit the same record).
 *
 * One row per incident the team decided to EXCLUDE (a technical fault on one
 * question for one student). When there are none, the sheet is emitted with the
 * header row plus a single note row, so the sheet is always present and the
 * absence of exclusions is explicit.
 */

import { XLSX, HEADER_STYLE, META_STYLE, styleCell } from "./sheet-utils";
import type { PerStudentExclusionRecord } from "./types";

export const PER_STUDENT_EXCLUSION_HEADERS = [
  "ParticipantID",
  "ParticipantName",
  "AssessmentName",
  "QuestionId",
  "QuestionWording",
  "DemandLevel",
  "Reason",
  "DecidedBy",
  "DecidedAt",
] as const;

export const PER_STUDENT_EXCLUSION_SHEET_NAME = "Per-student exclusions";

const EMPTY_NOTE = "No per-student exclusions recorded for this cycle.";

export function buildPerStudentExclusionsSheet(
  records: readonly PerStudentExclusionRecord[],
): XLSX.WorkSheet {
  const ncols = PER_STUDENT_EXCLUSION_HEADERS.length;
  const aoa: (string | number | null)[][] = [[...PER_STUDENT_EXCLUSION_HEADERS]];

  if (records.length === 0) {
    aoa.push([EMPTY_NOTE]);
  } else {
    for (const r of records) {
      aoa.push([
        r.participantId,
        r.participantName,
        r.assessmentName,
        r.questionId,
        r.questionWording ?? null,
        r.demandLevel ?? null,
        r.reason,
        r.decidedBy,
        r.decidedAt,
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let c = 0; c < ncols; c++) styleCell(ws, 0, c, HEADER_STYLE);
  if (records.length === 0) {
    styleCell(ws, 1, 0, META_STYLE);
    ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: ncols - 1 } }];
  }
  ws["!cols"] = [
    { wch: 14 }, // ParticipantID
    { wch: 18 }, // ParticipantName
    { wch: 24 }, // AssessmentName
    { wch: 14 }, // QuestionId
    { wch: 50 }, // QuestionWording
    { wch: 12 }, // DemandLevel
    { wch: 28 }, // Reason
    { wch: 18 }, // DecidedBy
    { wch: 20 }, // DecidedAt
  ];
  return ws;
}
