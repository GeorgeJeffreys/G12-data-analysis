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
import { PARTICIPANT_IDENTITY_COLUMNS } from "../participant-identity";
import type { CsvTable } from "./csv";
import { normalizeSubjectName } from "./canonical";
import { normalizeResultId } from "./result-id";

/**
 * Join Items → Assessments on ResultId into the combined per-answer rows the
 * legacy ingest expects. Item rows whose ResultId has no assessment row are
 * skipped (orphans can't be attributed to a subject/participant).
 */
export function toCombinedRows(items: CsvTable, assessments: CsvTable): RawExportRow[] {
  const assessmentByResult = new Map<string, Record<string, string>>();
  for (const row of assessments.rows) {
    const rid = normalizeResultId(row["ResultId"] ?? "");
    if (rid && !assessmentByResult.has(rid)) assessmentByResult.set(rid, row);
  }

  const combined: RawExportRow[] = [];
  for (const it of items.rows) {
    // Join on the CANONICAL ResultId so a representational skew between the Items
    // and Assessments exports (a trailing `.0`, quotes, exponential form) does not
    // orphan a whole sitting's items against its roster row (task 19).
    const rid = normalizeResultId(it["ResultId"] ?? "");
    const a = assessmentByResult.get(rid);
    if (!a) continue;
    // Every participant-identity column from the Assessments row, so the legacy
    // normaliser resolves the SAME internal identity the canonical model does
    // (keyed on the collision-free email, never a name/DOB-shaped field).
    const identityCols: Record<string, string> = {};
    for (const col of PARTICIPANT_IDENTITY_COLUMNS) {
      if (a[col] !== undefined) identityCols[col] = a[col] ?? "";
    }
    combined.push({
      ...it,
      // Carry the canonical ResultId so the sitting key persisted from the
      // responses (`qm_result_id`) matches the one the canonical roster / result
      // totals use — otherwise the same sitting would key differently per table.
      ResultId: rid,
      // Assessment-level columns the legacy normaliser reads.
      AssessmentName: normalizeSubjectName(a["AssessmentName"] ?? ""),
      ...identityCols,
      ResultParticipantName: a["ResultParticipantName"] ?? "",
      ResultStatus: a["ResultStatus"] ?? "",
    });
  }
  return combined;
}
