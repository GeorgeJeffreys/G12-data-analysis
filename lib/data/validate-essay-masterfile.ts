/**
 * Pre-write review for the reconciling essay masterfile (English/Arabic, one file
 * per language). Combines the parser's structural anomalies (a student without
 * exactly 2 essays, or an essay with no approved mark — surfaced, never dropped)
 * with the roster validation (`validateEssayRows`: unknown Student ID → rejected,
 * out-of-range mark → rejected, an already-excluded sitting → flagged) into a
 * single row-by-row report. NOTHING is written until the operator confirms; only
 * `valid` rows flow to `uploadEssayMarks`.
 *
 * Pure + engine-free — no provider, no persistence.
 */
import type { EssayUploadRow } from "./provider";
import type { EssayUploadContext } from "./types";
import { validateEssayRows, type EssayRowStatus } from "./validate-essays";
import { masterfileToUploadRows, type EssayMasterfileResult, type EssaySubjectCode } from "./parse-essay-masterfile";

export interface MasterfileReviewRow {
  studentId: string;
  studentName: string;
  status: EssayRowStatus;
  /** Reconciled subject essay /20 for a valid row, else null. */
  subjectEssay: number | null;
  /** The approved per-essay marks /20 (two), for the review table, else null. */
  essays: number[] | null;
  reason: string | null;
}

export interface MasterfileValidationReport {
  subjectCode: EssaySubjectCode;
  /** The essay subject name once resolved against the cycle, else null. */
  subjectName: string | null;
  rows: MasterfileReviewRow[];
  /** The ONLY rows handed to uploadEssayMarks (one reconciled row per student). */
  valid: EssayUploadRow[];
  validCount: number;
  rejectedCount: number;
  flaggedCount: number;
}

/**
 * Reconcile → roster-validate → merge into one review report. `result` comes from
 * `parseEssayMasterfile`/`reconcileMasterfile`; `context` from `getEssayContext`.
 */
export function validateEssayMasterfile(
  result: EssayMasterfileResult,
  context: EssayUploadContext,
): MasterfileValidationReport {
  const uploadRows = masterfileToUploadRows(result);
  const roster = validateEssayRows(uploadRows, context);
  const subjectName = context.subjects.find((s) => s.code === result.subjectCode)?.name ?? null;

  // Index the roster verdict by the reconciled student's id (row.participantId).
  const verdictById = new Map(roster.results.map((r) => [r.row.participantId, r]));
  const reconciledById = new Map(result.reconciled.map((s) => [s.studentId, s]));

  const rows: MasterfileReviewRow[] = [];

  // Reconciled students: carry the roster verdict (valid / rejected / flagged).
  for (const s of result.reconciled) {
    const v = verdictById.get(s.studentId);
    rows.push({
      studentId: s.studentId,
      studentName: s.studentName,
      status: v?.status ?? "valid",
      subjectEssay: v && v.status === "valid" ? s.subjectEssay : null,
      essays: s.essays,
      reason: v?.reason ?? null,
    });
  }

  // Structural anomalies from the parser are always rejected (never applied).
  for (const a of result.anomalies) {
    rows.push({
      studentId: a.studentId,
      studentName: a.studentName,
      status: "rejected",
      subjectEssay: null,
      essays: null,
      reason: a.reason,
    });
  }

  rows.sort((x, y) => x.studentName.localeCompare(y.studentName) || x.studentId.localeCompare(y.studentId));

  // Keep the reconciled context on the valid upload rows (essayCount already set).
  const valid = roster.valid.filter((r) => reconciledById.has(r.participantId));

  return {
    subjectCode: result.subjectCode,
    subjectName,
    rows,
    valid,
    validCount: valid.length,
    rejectedCount: rows.filter((r) => r.status === "rejected").length,
    flaggedCount: rows.filter((r) => r.status === "flagged").length,
  };
}
