/**
 * Pre-write validation for the essay-marks upload (English/Arabic only).
 *
 * Runs BEFORE anything is written: it takes the rows the existing
 * `parseEssayMarks` produced and the read-only `EssayUploadContext` (the current
 * essay subjects + rosters), and returns a row-by-row valid / rejected / flagged
 * report so the operator can review before applying. Only `valid` rows are handed
 * to the existing `uploadEssayMarks`; rejected/flagged rows are never written.
 *
 * Rules (all row-by-row, nothing global):
 *  - the sheet's subject code must be an essay subject in this cycle;
 *  - the ParticipantID (lowercased) must exist in that subject's roster;
 *  - the mark must be numeric and 0 ≤ mark ≤ `essayItemMax`;
 *  - a sitting already excluded on the Clean tab is FLAGGED, not applied.
 *
 * Pure + engine-free — no provider, no persistence. The write path
 * (`uploadEssayMarks`) and its `(participantId, assessmentId)` keying / the essay
 * half-weighting are untouched.
 */
import type { EssayUploadRow } from "./provider";
import type { EssayUploadContext, EssaySubjectContext } from "./types";

/** Outcome for a single uploaded row. */
export type EssayRowStatus = "valid" | "rejected" | "flagged";

export interface EssayRowResult {
  row: EssayUploadRow;
  status: EssayRowStatus;
  /** Roster name when the participant matched, else null. */
  participantName: string | null;
  /** Subject name when the code matched an essay subject, else null. */
  subjectName: string | null;
  /** Why the row was rejected/flagged (null for a clean valid row). */
  reason: string | null;
}

export interface EssayValidationReport {
  results: EssayRowResult[];
  /** Rows safe to apply (status "valid") — the ONLY rows passed to uploadEssayMarks. */
  valid: EssayUploadRow[];
  validCount: number;
  rejectedCount: number;
  flaggedCount: number;
  /** Distinct essay subject names referenced by valid rows (for the summary line). */
  subjectsSeen: string[];
}

function findSubject(context: EssayUploadContext, code: string): EssaySubjectContext | undefined {
  const c = code.trim().toUpperCase();
  return context.subjects.find((s) => s.code === c);
}

/** Validate parsed essay rows against the cycle's essay subjects + rosters. */
export function validateEssayRows(
  rows: readonly EssayUploadRow[],
  context: EssayUploadContext,
): EssayValidationReport {
  const results: EssayRowResult[] = [];
  const valid: EssayUploadRow[] = [];
  const subjectsSeen = new Set<string>();

  for (const row of rows) {
    const subject = findSubject(context, row.subjectCode);
    if (!subject) {
      results.push({
        row,
        status: "rejected",
        participantName: null,
        subjectName: null,
        reason: `Subject "${row.subjectCode}" has no essay component in this cycle.`,
      });
      continue;
    }

    const id = row.participantId.trim().toLowerCase();
    // Match on EITHER the internal participant id OR the real Student ID
    // (qm_participant_id, e.g. A-A-260506) — the masterfile joins on Student ID,
    // mirroring the provider's matcher which accepts both.
    const entry = subject.participants.find(
      (p) => p.participantId.trim().toLowerCase() === id || (p.studentId ?? "").trim().toLowerCase() === id,
    );
    if (!entry) {
      results.push({
        row,
        status: "rejected",
        participantName: null,
        subjectName: subject.name,
        reason: `ParticipantID "${row.participantId}" is not in the ${subject.name} roster.`,
      });
      continue;
    }

    const mark = Number(row.totalScore);
    if (!Number.isFinite(mark)) {
      results.push({
        row,
        status: "rejected",
        participantName: entry.name,
        subjectName: subject.name,
        reason: `Mark "${row.totalScore}" is not a number.`,
      });
      continue;
    }
    if (mark < 0 || mark > context.essayItemMax) {
      results.push({
        row,
        status: "rejected",
        participantName: entry.name,
        subjectName: subject.name,
        reason: `Mark ${mark} is outside the allowed range 0–${context.essayItemMax}.`,
      });
      continue;
    }

    if (entry.excluded) {
      results.push({
        row,
        status: "flagged",
        participantName: entry.name,
        subjectName: subject.name,
        reason: "Sitting is excluded on the Clean tab — mark not applied.",
      });
      continue;
    }

    results.push({ row, status: "valid", participantName: entry.name, subjectName: subject.name, reason: null });
    valid.push(row);
    subjectsSeen.add(subject.name);
  }

  return {
    results,
    valid,
    validCount: valid.length,
    rejectedCount: results.filter((r) => r.status === "rejected").length,
    flaggedCount: results.filter((r) => r.status === "flagged").length,
    subjectsSeen: [...subjectsSeen],
  };
}
