/**
 * Bridge from the 3-CSV canonical model to the engine-facing response matrix.
 *
 * The existing pipeline (engine, provider, exports, grades) consumes the long-
 * format `CleanResponse[]` produced by `normalizeResponses`. Rather than re-derive
 * that — and risk engine parity — we synthesise the same single-row-per-answer
 * shape the old combined export had by joining each Items row to its Assessments
 * row, then run the unchanged `ingestAndClean`. The only substitution is the
 * canonical (normalised) subject name in `AssessmentName`, so the "Applicable
 * Maths" variant merges into one subject downstream.
 */

import type { RawExportRow } from "../types";
import type { CsvTable } from "./csv";
import { normalizeSubjectName } from "./canonical";

/**
 * Join Items → Assessments on ResultId into the combined per-answer rows the
 * legacy ingest expects. Item rows whose ResultId has no assessment row are
 * skipped (orphans can't be attributed to a subject/participant).
 */
export function toCombinedRows(items: CsvTable, assessments: CsvTable): RawExportRow[] {
  const assessmentByResult = new Map<string, Record<string, string>>();
  for (const row of assessments.rows) {
    const rid = (row["ResultId"] ?? "").trim();
    if (rid && !assessmentByResult.has(rid)) assessmentByResult.set(rid, row);
  }

  const combined: RawExportRow[] = [];
  for (const it of items.rows) {
    const rid = (it["ResultId"] ?? "").trim();
    const a = assessmentByResult.get(rid);
    if (!a) continue;
    combined.push({
      ...it,
      // Assessment-level columns the legacy normaliser reads.
      AssessmentName: normalizeSubjectName(a["AssessmentName"] ?? ""),
      ResultParticipantName: a["ResultParticipantName"] ?? "",
      ResultStatus: a["ResultStatus"] ?? "",
    });
  }
  return combined;
}
