/**
 * Pre-write review for the essay workbook. Joins each extracted student to a
 * roster participant on the QM email column — case-insensitive EXACT — and
 * produces a row-by-row valid/rejected report. NOTHING is written until the
 * operator confirms; only `valid` rows flow to `uploadEssayMarks`.
 *
 * Rejection rules (row-by-row, nothing guessed):
 *  - no `Adjusted scores (USE THESE)` value for the student → REJECT;
 *  - blank QM email → REJECT (G12's cue to fill it);
 *  - email not in that subject's roster → REJECT (never guess a participant);
 *  - matched sitting already excluded on the Clean tab → FLAG (not applied).
 *
 * The Alsama Student ID is a display label only. Each row carries the MATCHED
 * participant (email + name) so a human signs off before apply. There is NO
 * identity mapping here — no DOB, no Student-ID resolution, no crosswalk. Pure +
 * engine-free.
 */
import type { EssayUploadRow } from "./provider";
import type { EssayUploadContext, EssaySubjectContext } from "./types";
import type { ExtractedEssayStudent, EssayMasterfileResult, EssaySubjectCode } from "./parse-essay-masterfile";

export type EssayRowStatus = "valid" | "rejected" | "flagged";

export interface MasterfileReviewRow {
  subjectCode: EssaySubjectCode;
  subjectName: string | null;
  /** Alsama Student ID from the file — a display label. */
  studentLabel: string;
  /** Student name from the file. */
  studentName: string;
  /** QM email from the file (join key), lower-cased; "" when blank. */
  email: string;
  /** MATCHED roster participant's name, once joined — else null. */
  matchedName: string | null;
  /** MATCHED roster participant's canonical email, once joined — else null. */
  matchedEmail: string | null;
  status: EssayRowStatus;
  /** The subject essay /20 (after ESSAY_MARK_ROUNDING) for a valid row, else null. */
  subjectEssay: number | null;
  /** The raw Adjusted value /20 (may be fractional), for the review table. */
  adjustedRaw: number | null;
  reason: string | null;
}

export interface MasterfileValidationReport {
  rows: MasterfileReviewRow[];
  /** The ONLY rows handed to uploadEssayMarks (one per matched student per subject). */
  valid: EssayUploadRow[];
  validCount: number;
  rejectedCount: number;
  flaggedCount: number;
  /** Distinct essay subject names referenced by valid rows (for the summary line). */
  subjectsSeen: string[];
}

/** Case-insensitive exact-email lookup against a subject roster (email = qm id). */
function findByEmail(subject: EssaySubjectContext, email: string) {
  const e = email.trim().toLowerCase();
  if (!e) return undefined;
  return subject.participants.find(
    (p) => (p.studentId ?? "").trim().toLowerCase() === e || p.participantId.trim().toLowerCase() === e,
  );
}

function subjectFor(context: EssayUploadContext, code: EssaySubjectCode): EssaySubjectContext | undefined {
  return context.subjects.find((s) => s.code === code);
}

/** Validate one extracted student against the roster. */
function reviewOne(s: ExtractedEssayStudent, context: EssayUploadContext): MasterfileReviewRow {
  const subject = subjectFor(context, s.subjectCode);
  const base = {
    subjectCode: s.subjectCode,
    subjectName: subject?.name ?? null,
    studentLabel: s.studentLabel,
    studentName: s.studentName,
    email: s.email,
    matchedName: null as string | null,
    matchedEmail: null as string | null,
    subjectEssay: null as number | null,
    adjustedRaw: s.adjustedRaw,
  };
  if (!subject) return { ...base, status: "rejected", reason: `"${s.subjectCode}" has no essay component in this cycle.` };
  if (s.subjectEssay == null) return { ...base, status: "rejected", reason: "No “Adjusted scores (USE THESE)” value for this student." };
  if (!s.email) return { ...base, status: "rejected", reason: "Blank QM email — cannot join to a participant (ask G12 to fill it)." };
  const entry = findByEmail(subject, s.email);
  if (!entry) return { ...base, status: "rejected", reason: `QM email “${s.email}” is not in the ${subject.name} roster.` };
  const matched = { matchedName: entry.name, matchedEmail: entry.studentId ?? entry.participantId };
  if (entry.excluded) return { ...base, ...matched, status: "flagged", reason: "Sitting is excluded on the Clean tab — mark not applied." };
  return { ...base, ...matched, status: "valid", subjectEssay: s.subjectEssay, reason: null };
}

/** Validate a parsed workbook against the cycle's essay subjects + rosters. */
export function validateEssayMasterfile(
  result: EssayMasterfileResult,
  context: EssayUploadContext,
): MasterfileValidationReport {
  const rows = result.students.map((s) => reviewOne(s, context));
  rows.sort(
    (a, b) =>
      a.subjectCode.localeCompare(b.subjectCode) ||
      a.studentName.localeCompare(b.studentName) ||
      a.studentLabel.localeCompare(b.studentLabel),
  );

  const valid: EssayUploadRow[] = [];
  const subjectsSeen = new Set<string>();
  for (const r of rows) {
    if (r.status !== "valid" || r.subjectEssay == null) continue;
    valid.push({ participantId: r.email, subjectCode: r.subjectCode, totalScore: r.subjectEssay, essayCount: 1 });
    if (r.subjectName) subjectsSeen.add(r.subjectName);
  }

  return {
    rows,
    valid,
    validCount: valid.length,
    rejectedCount: rows.filter((r) => r.status === "rejected").length,
    flaggedCount: rows.filter((r) => r.status === "flagged").length,
    subjectsSeen: [...subjectsSeen],
  };
}
