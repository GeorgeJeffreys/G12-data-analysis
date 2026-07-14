/**
 * Pre-write review for the essay template. Joins each extracted student to a
 * roster participant on the QM email — case-insensitive EXACT — and produces a
 * row-by-row valid/rejected report. NOTHING is written until the operator
 * confirms; only `valid` rows flow to `uploadEssayMarks`.
 *
 * ONE row per student (grouped by QM email upstream) — never per essay or per
 * marker. Rejection rules (row-by-row, nothing guessed):
 *  - no `Final essay mark` for the student → REJECT (unmarked);
 *  - more than one non-blank `Final` → REJECT (`multiple final marks`);
 *  - blank QM email → REJECT;
 *  - email not in that subject's roster → REJECT (never guess a participant);
 *  - matched sitting already excluded on the Clean tab → FLAG (not applied).
 *
 * Each row carries the MATCHED participant (email + name) so a human signs off, plus
 * the sheet's `Student name` as a consistent display identifier across valid and
 * rejected rows. No identity mapping — no DOB, no Student-ID resolution, no
 * crosswalk. Pure.
 */
import type { EssayUploadRow } from "./provider";
import type { EssayUploadContext, EssaySubjectContext } from "./types";
import type { ExtractedEssayStudent, EssayMasterfileResult, EssaySubjectCode, EssaySheetError } from "./parse-essay-masterfile";

export type EssayRowStatus = "valid" | "rejected" | "flagged";

export interface MasterfileReviewRow {
  subjectCode: EssaySubjectCode;
  subjectName: string | null;
  /** QM email from the file (join key), lower-cased; "" when blank. */
  email: string;
  /**
   * `Student name` from the sheet (display only) — the ONE identifier the review
   * shows across valid AND rejected rows (falling back to the email when blank), so
   * the grain is consistent regardless of whether the row joined to the roster.
   */
  studentName: string | null;
  /** MATCHED roster participant's name, once joined — else null. */
  matchedName: string | null;
  /** MATCHED roster participant's canonical email, once joined — else null. */
  matchedEmail: string | null;
  status: EssayRowStatus;
  /** The subject essay /20 (after ESSAY_MARK_ROUNDING) for a valid row, else null. */
  subjectEssay: number | null;
  /** The entered Final value /20 (may be fractional), for the review table. */
  finalRaw: number | null;
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
  /** Whole-sheet rejections (broken column contract) — surfaced, never applied. */
  sheetErrors: EssaySheetError[];
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
    email: s.email,
    studentName: s.studentName || null,
    matchedName: null as string | null,
    matchedEmail: null as string | null,
    subjectEssay: null as number | null,
    finalRaw: s.finalRaw,
  };
  if (!subject) return { ...base, status: "rejected", reason: `"${s.subjectCode}" has no essay component in this cycle.` };
  if (!s.email) return { ...base, status: "rejected", reason: "Blank QM email — cannot join to a participant (ask G12 to fill it)." };
  if (s.finals.length === 0) return { ...base, status: "rejected", reason: "No Final essay mark — this student is unmarked." };
  if (s.finals.length > 1) return { ...base, status: "rejected", reason: `Multiple Final marks (${s.finals.join(", ")}) — expected one per student.` };
  const entry = findByEmail(subject, s.email);
  if (!entry) return { ...base, status: "rejected", reason: `QM email “${s.email}” is not in the ${subject.name} roster.` };
  const matched = { matchedName: entry.name, matchedEmail: entry.studentId ?? entry.participantId };
  if (entry.excluded) return { ...base, ...matched, status: "flagged", reason: "Sitting is excluded on the Clean tab — mark not applied." };
  return { ...base, ...matched, status: "valid", subjectEssay: s.subjectEssay, reason: null };
}

/** Validate a parsed template against the cycle's essay subjects + rosters. */
export function validateEssayMasterfile(
  result: EssayMasterfileResult,
  context: EssayUploadContext,
): MasterfileValidationReport {
  const rows = result.students.map((s) => reviewOne(s, context));
  rows.sort((a, b) => a.subjectCode.localeCompare(b.subjectCode) || (a.matchedName ?? a.email).localeCompare(b.matchedName ?? b.email));

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
    sheetErrors: result.sheetErrors ?? [],
  };
}
