/**
 * Alterations sheet — the canonical record of human-decided raw-mark alterations
 * (the incident-log triage from the Adjustments step). Replaces the old
 * Per-student Exclusions sheet now that the scoring model uses additive/
 * subtractive alterations rather than exclusions.
 *
 * One row per applied alteration (a whole-subject bulk decision yields one row
 * per student). When there are none, the sheet is emitted with the header row
 * plus a single note, so it is always present and the absence is explicit.
 */

import { XLSX, HEADER_STYLE, META_STYLE, styleCell } from "./sheet-utils";
import type { AlterationRecord } from "./types";

export const ALTERATION_HEADERS = [
  "ParticipantID",
  "ParticipantName",
  "Subject",
  "Marks (+/-)",
  "Reason",
  "DecidedBy",
  "DecidedAt",
  "SourceIncident",
] as const;

export const ALTERATIONS_SHEET_NAME = "Alterations";

const EMPTY_NOTE = "No alterations recorded for this cycle.";

export function buildAlterationsSheet(records: readonly AlterationRecord[]): XLSX.WorkSheet {
  const ncols = ALTERATION_HEADERS.length;
  const aoa: (string | number | null)[][] = [[...ALTERATION_HEADERS]];

  if (records.length === 0) {
    aoa.push([EMPTY_NOTE]);
  } else {
    for (const r of records) {
      aoa.push([
        r.participantId,
        r.participantName,
        r.subject,
        r.marks,
        r.reason,
        r.decidedBy,
        r.decidedAt,
        r.sourceIncident ?? null,
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
    { wch: 22 }, // Subject
    { wch: 11 }, // Marks
    { wch: 34 }, // Reason
    { wch: 18 }, // DecidedBy
    { wch: 20 }, // DecidedAt
    { wch: 28 }, // SourceIncident
  ];
  return ws;
}
