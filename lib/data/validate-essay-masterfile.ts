/**
 * Pre-write review for the reconciling essay masterfile (English/Arabic, one file
 * per language). Joins each reconciled student to a roster participant on the
 * `QM Participant ID (email)` column — case-insensitive EXACT email — and merges
 * that with the parser's structural anomalies (≠2 essays, no approved mark) into a
 * single row-by-row report.
 *
 * Rejection rules (row-by-row, nothing global, nothing guessed):
 *  - blank email → REJECT (no join key);
 *  - email not in the subject's roster → REJECT (never guess a participant);
 *  - matched sitting already excluded on the Clean tab → FLAG (not applied);
 *  - a structural anomaly from the parser → REJECT.
 *
 * The Alsama `Student ID` is a human label only — never the join key. Each row
 * carries the MATCHED participant (email + name) so a human signs off before apply.
 * NOTHING is written until the operator confirms; only `valid` rows flow to
 * `uploadEssayMarks`. Pure + engine-free — no provider, no persistence.
 */
import type { EssayUploadRow } from "./provider";
import type { EssayUploadContext, EssaySubjectContext } from "./types";
import type { EssayMasterfileResult, EssaySubjectCode } from "./parse-essay-masterfile";

export type EssayRowStatus = "valid" | "rejected" | "flagged";

export interface MasterfileReviewRow {
  /** Alsama Student ID from the file — a human label (not the join key). */
  studentId: string;
  /** Student name from the file. */
  studentName: string;
  /** The QM email from the file (the join key), lower-cased; "" when blank. */
  email: string;
  /** The MATCHED roster participant's name, once joined — else null. */
  matchedName: string | null;
  /** The MATCHED roster participant's canonical email, once joined — else null. */
  matchedEmail: string | null;
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

/** Case-insensitive exact-email lookup against a subject roster (email = qm id). */
function findByEmail(subject: EssaySubjectContext, email: string) {
  const e = email.trim().toLowerCase();
  if (!e) return undefined;
  return subject.participants.find(
    (p) => (p.studentId ?? "").trim().toLowerCase() === e || p.participantId.trim().toLowerCase() === e,
  );
}

/**
 * Reconcile → email-join → merge into one review report. `result` comes from
 * `parseEssayMasterfile`/`reconcileMasterfile`; `context` from `getEssayContext`.
 */
export function validateEssayMasterfile(
  result: EssayMasterfileResult,
  context: EssayUploadContext,
): MasterfileValidationReport {
  const subject = context.subjects.find((s) => s.code === result.subjectCode);
  const subjectName = subject?.name ?? null;
  const rows: MasterfileReviewRow[] = [];
  const valid: EssayUploadRow[] = [];

  for (const s of result.reconciled) {
    const base = {
      studentId: s.studentId,
      studentName: s.studentName,
      email: s.email,
      matchedName: null as string | null,
      matchedEmail: null as string | null,
      subjectEssay: null as number | null,
      essays: s.essays,
    };

    if (!subject) {
      rows.push({ ...base, status: "rejected", reason: `"${result.subjectCode}" has no essay component in this cycle.` });
      continue;
    }
    if (!s.email) {
      rows.push({ ...base, status: "rejected", reason: "Blank QM Participant ID (email) — cannot join to a participant." });
      continue;
    }
    const entry = findByEmail(subject, s.email);
    if (!entry) {
      rows.push({ ...base, status: "rejected", reason: `QM email "${s.email}" is not in the ${subject.name} roster.` });
      continue;
    }
    const matched = { matchedName: entry.name, matchedEmail: entry.studentId ?? entry.participantId };
    if (entry.excluded) {
      rows.push({ ...base, ...matched, status: "flagged", reason: "Sitting is excluded on the Clean tab — mark not applied." });
      continue;
    }
    rows.push({ ...base, ...matched, status: "valid", subjectEssay: s.subjectEssay, reason: null });
    valid.push({ participantId: s.email, subjectCode: s.subjectCode, totalScore: s.subjectEssay, essayCount: s.essays.length });
  }

  // Structural anomalies from the parser are always rejected (never applied).
  for (const a of result.anomalies) {
    rows.push({
      studentId: a.studentId,
      studentName: a.studentName,
      email: "",
      matchedName: null,
      matchedEmail: null,
      status: "rejected",
      subjectEssay: null,
      essays: null,
      reason: a.reason,
    });
  }

  rows.sort((x, y) => x.studentName.localeCompare(y.studentName) || x.studentId.localeCompare(y.studentId));

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
