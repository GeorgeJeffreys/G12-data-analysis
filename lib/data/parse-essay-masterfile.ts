/**
 * Reconciling parser for the team's REAL essay double-marking masterfile (CSV,
 * one file per language). This is NOT an idealised template — it is the exact
 * file the marking team maintains, with two marker rows per essay and two essays
 * per student. The reconciliation policy below is SIGNED OFF by George; it is
 * encoded here as named, explicit rules — never as silent guesses.
 *
 * ## The file (verified against
 *   `[INTERNAL] FEB26 marking masterfile [AFL ESL] (English Essay master).csv`)
 * - One file per language (English → ESL, Arabic → AFL). Subject/assessment is
 *   determined by WHICH file is uploaded (the filename), not by a column.
 * - Header columns by position — names are messy, so we match defensively on
 *   header TEXT (whitespace/case-tolerant) and fall back to the documented
 *   position: `0 Marker A · 1 Student name · 2 Student ID · 3 Essay ID ·
 *   4 Marker · 5-9 Dim1..Dim5 · 10 Total score · 11 Average · 12 Flag ·
 *   13 Moderated final score · 14 Final scores:` — columns 15+ are tracking/
 *   warning junk and are ignored.
 * - TWO rows per essay (markers M1/M2). The approved fields (`Moderated final
 *   score`, `Final scores:`) are populated on the FIRST row of the pair.
 * - TWO essays per student (e.g. `A-A-260506` has `EE01.png` and `EE02.png`).
 *
 * ## Reconciliation policy (SIGNED OFF — explicit rules)
 *  1. Ignore the double-marking entirely — `Dim1–5`, per-marker `Total score`
 *     and `Average` are NOT read. Only the final approved mark per essay matters.
 *  2. Approved mark per essay = `Moderated final score` if non-blank, else
 *     `Final scores:` (Moderated is an override and wins when present). Each
 *     essay is /20.
 *  3. Halve each essay to /10, then SUM the two → subject essay score /20.
 *  4. Round the summed /20 up on a 0.5: `round_half_up(essay_1/2 + essay_2/2)`.
 *     Kept as the single named constant `ESSAY_ROUND_STAGE = 'sum'`. The rejected
 *     alternative `'each'` (round each /10 first) is computed for the record but
 *     never used; the two differ for exactly 3 of 17 students.
 *  5. Join on the `QM Participant ID (email)` column — case-insensitive EXACT
 *     email match against the roster. The Alsama `Student ID` is NOT in the
 *     Questionmark export, so it is a human label only, never the join key. A
 *     blank email, or an email not in the subject's roster, is REJECTED — never
 *     guessed. (The email → participant join happens in the validation layer; this
 *     parser is roster-agnostic and simply carries the file's email + label.)
 *  6. Anomalies are FLAGGED, never silently dropped: a student without exactly 2
 *     essays, or an essay with no approved mark, is surfaced as an anomaly and
 *     excluded from the reconciled output.
 *
 * ## Not a double-halve
 * The engine's essay layer adds the per-subject essay `mark` to the numerator
 * AS-IS (it does not multiply by 0.5) against a reserved max of 20 (see
 * `lib/data/essays.ts` / `lib/engine/scores.ts`). Policy step 3 already produces
 * that half-weighted /20 value (essay_1/2 + essay_2/2, max 20). So the reconciled
 * /20 is fed straight through as a single per-student mark and the subject essay
 * is halved EXACTLY ONCE. `lib/engine/*` is untouched.
 *
 * Pure + engine-free. Uses the repo's existing SheetJS (`xlsx`) reader, which
 * also parses CSV and strips the UTF-8 BOM.
 */
import type { EssayUploadRow } from "./provider";

/** Arabic Unicode block (U+0600–U+06FF) — matches an Arabic-script filename. */
const ARABIC_SCRIPT = /[؀-ۿ]/;

/** Maximum marks for a single essay item (each essay is /20). */
export const ESSAY_ITEM_MAX = 20;

/**
 * WHEN the 0.5-round-up is applied. `'sum'` (SIGNED OFF by George): round the
 * summed /20 once — `round_half_up(essay_1/2 + essay_2/2)`. `'each'` (rejected):
 * round each /10 first. Kept as a single, inspectable, one-line-changeable
 * constant; there is no open question — `'sum'` is authoritative.
 */
export type EssayRoundStage = "sum" | "each";
export const ESSAY_ROUND_STAGE: EssayRoundStage = "sum";

/** The two essay-carrying subjects, by file/sheet code. */
export type EssaySubjectCode = "AFL" | "ESL";

/** Round half up on a 0.5 (`round_half_up(2.5) === 3`); positive marks only. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

/** One student reconciled to a single subject essay mark. */
export interface ReconciledEssayStudent {
  /**
   * The Alsama Student ID from the file (e.g. `A-A-260506`). A HUMAN LABEL ONLY —
   * it is NOT in the Questionmark export, so it is never the join key.
   */
  studentId: string;
  /**
   * `QM Participant ID (email)` from the file — the participant's Questionmark
   * email, which IS the join key (QM has no numeric student id). May be blank
   * (→ rejected at validation). Lower-cased for the exact-email join.
   */
  email: string;
  /** Student name (never used to join; carried for the review report only). */
  studentName: string;
  subjectCode: EssaySubjectCode;
  /** The approved mark per essay, /20, in file order (two of them). */
  essays: number[];
  /** `round_half_up(essay_1/2 + essay_2/2)` — the authoritative `'sum'` value. */
  subjectEssaySum: number;
  /** `round_half_up(essay_1/2) + round_half_up(essay_2/2)` — recorded, NOT used. */
  subjectEssayEach: number;
  /** The value per `ESSAY_ROUND_STAGE` — what is fed to the engine, /20. */
  subjectEssay: number;
}

/** A student/essay excluded from apply, with the reason (never silently dropped). */
export interface EssayMasterfileAnomaly {
  studentId: string;
  studentName: string;
  essayCount: number;
  reason: string;
}

export interface EssayMasterfileResult {
  subjectCode: EssaySubjectCode;
  reconciled: ReconciledEssayStudent[];
  anomalies: EssayMasterfileAnomaly[];
}

/**
 * Infer the essay language/subject code from the uploaded file's name. Arabic
 * (script or the word) → AFL; English → ESL. Note the real filename carries the
 * literal `[AFL ESL]` split instruction, so we key on the language WORD in the
 * parenthetical (`(English Essay master)`), not the AFL/ESL codes.
 */
export function inferEssayLanguage(fileName: string): EssaySubjectCode | null {
  const s = (fileName || "").toLowerCase();
  if (ARABIC_SCRIPT.test(fileName) || s.includes("arabic")) return "AFL";
  if (s.includes("english")) return "ESL";
  return null;
}

/** Normalise a header cell for defensive matching (trim, collapse ws, lowercase). */
function norm(h: unknown): string {
  return String(h ?? "").replace(/﻿/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

interface ColumnMap {
  studentId: number;
  studentName: number;
  essayId: number;
  moderated: number;
  final: number;
  /** The QM email join column — matched by HEADER NAME, not position (may sit anywhere). */
  email: number;
}

/**
 * Resolve the columns we read. Header-text match first (whitespace/case-tolerant),
 * documented position as the fallback — so a re-ordered or messy header still
 * works, and a header-less/garbled first row still lands on the known positions.
 * The QM email column is matched by NAME ONLY (no position fallback) — it is
 * appended by G12 and may sit anywhere; if absent, `email` is -1 and every row is
 * rejected at validation (a missing join key must never be guessed).
 */
function resolveColumns(headers: string[]): ColumnMap {
  const h = headers.map(norm);
  const findBy = (pred: (s: string) => boolean, fallback: number): number => {
    const i = h.findIndex(pred);
    return i >= 0 ? i : fallback;
  };
  return {
    // "student id" (not "essay id", not "student name") — a human label only
    studentId: findBy((s) => s.includes("student id") || (s.includes("id") && !s.includes("essay") && !s.includes("name") && !s.includes("qm") && !s.includes("email")), 2),
    studentName: findBy((s) => s.includes("student name") || (s.includes("name") && !s.includes("id")), 1),
    essayId: findBy((s) => s.includes("essay id") || s.includes("essay"), 3),
    moderated: findBy((s) => s.includes("moderated"), 13),
    // "final score(s)" but NOT the "moderated final score" column
    final: findBy((s) => s.includes("final") && !s.includes("moderated"), 14),
    // "QM Participant ID (email)" — by name only, no position fallback
    email: findBy((s) => s.includes("qm participant") || s.includes("participant id (email)") || s.includes("email"), -1),
  };
}

/** Parse a numeric cell; blank/`""`/null → null, otherwise the stripped number. */
function numOrNull(cell: unknown): number | null {
  const s = String(cell ?? "").replace(/[^0-9.\-]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a masterfile CSV into a row matrix using the repo's SheetJS reader. Accepts
 * a decoded string (tests) or the raw file bytes (upload). BOM handled by SheetJS.
 */
export async function parseMasterfileMatrix(input: string | ArrayBuffer): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const wb = typeof input === "string" ? XLSX.read(input, { type: "string" }) : XLSX.read(input, { type: "array", codepage: 65001 });
  const name = wb.SheetNames[0];
  if (!name) return [];
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, raw: false, defval: "" });
}

interface EssayAgg {
  order: number;
  moderated: number | null;
  final: number | null;
}

/**
 * Apply the SIGNED-OFF reconciliation policy to a masterfile row matrix.
 * Pure — no roster, no provider, no engine. The email → participant join and the
 * blank/unknown-email rejection live in the validation layer.
 */
export function reconcileMasterfile(matrix: string[][], subjectCode: EssaySubjectCode): EssayMasterfileResult {
  const reconciled: ReconciledEssayStudent[] = [];
  const anomalies: EssayMasterfileAnomaly[] = [];
  if (matrix.length === 0) return { subjectCode, reconciled, anomalies };

  const cols = resolveColumns(matrix[0] ?? []);

  // Group by Student ID → Essay ID. Per essay we keep the first non-blank
  // Moderated and the first non-blank Final across BOTH marker rows, so the
  // Moderated override wins regardless of which row carries it.
  interface StudentRows {
    studentId: string;
    email: string;
    studentName: string;
    essays: Map<string, EssayAgg>;
    order: number;
  }
  const students = new Map<string, StudentRows>();
  let studentSeq = 0;
  let essaySeq = 0;

  const emailOf = (row: string[]): string =>
    cols.email >= 0 ? String(row[cols.email] ?? "").trim().toLowerCase() : "";

  for (const row of matrix.slice(1)) {
    const studentId = String(row[cols.studentId] ?? "").trim();
    const essayId = String(row[cols.essayId] ?? "").trim();
    if (!studentId || !essayId) continue; // blank/spacer row
    const studentName = String(row[cols.studentName] ?? "").trim();
    const email = emailOf(row);

    let sr = students.get(studentId);
    if (!sr) {
      sr = { studentId, email, studentName, essays: new Map(), order: studentSeq++ };
      students.set(studentId, sr);
    }
    if (studentName && !sr.studentName) sr.studentName = studentName;
    if (email && !sr.email) sr.email = email; // first non-blank email for the student

    let ea = sr.essays.get(essayId);
    if (!ea) {
      ea = { order: essaySeq++, moderated: null, final: null };
      sr.essays.set(essayId, ea);
    }
    const mod = numOrNull(row[cols.moderated]);
    const fin = numOrNull(row[cols.final]);
    if (ea.moderated == null && mod != null) ea.moderated = mod;
    if (ea.final == null && fin != null) ea.final = fin;
  }

  const orderedStudents = [...students.values()].sort((a, b) => a.order - b.order);
  for (const sr of orderedStudents) {
    const essays = [...sr.essays.entries()].sort((a, b) => a[1].order - b[1].order);

    // Rule 2: approved = Moderated if non-blank, else Final.
    const approved = essays.map(([, ea]) => (ea.moderated != null ? ea.moderated : ea.final));

    if (essays.length !== 2) {
      anomalies.push({
        studentId: sr.studentId,
        studentName: sr.studentName,
        essayCount: essays.length,
        reason: `Expected exactly 2 essays, found ${essays.length}.`,
      });
      continue;
    }
    const missingIdx = approved.findIndex((m) => m == null);
    if (missingIdx >= 0) {
      anomalies.push({
        studentId: sr.studentId,
        studentName: sr.studentName,
        essayCount: essays.length,
        reason: `Essay "${essays[missingIdx]![0]}" has no approved mark (Moderated/Final both blank).`,
      });
      continue;
    }
    const outOfRange = approved.find((m) => m! < 0 || m! > ESSAY_ITEM_MAX);
    if (outOfRange != null) {
      anomalies.push({
        studentId: sr.studentId,
        studentName: sr.studentName,
        essayCount: essays.length,
        reason: `An approved essay mark (${outOfRange}) is outside 0–${ESSAY_ITEM_MAX}.`,
      });
      continue;
    }

    const marks = approved as number[];
    // Rule 3 + 4: halve each /20 → /10, sum, round half up on the sum.
    const subjectEssaySum = roundHalfUp(marks.reduce((n, m) => n + m / 2, 0));
    const subjectEssayEach = marks.reduce((n, m) => n + roundHalfUp(m / 2), 0);
    reconciled.push({
      studentId: sr.studentId,
      email: sr.email,
      studentName: sr.studentName,
      subjectCode,
      essays: marks,
      subjectEssaySum,
      subjectEssayEach,
      subjectEssay: ESSAY_ROUND_STAGE === "sum" ? subjectEssaySum : subjectEssayEach,
    });
  }

  return { subjectCode, reconciled, anomalies };
}

/** Read + reconcile a masterfile File; subject inferred from the filename. */
export async function parseEssayMasterfile(file: File): Promise<EssayMasterfileResult> {
  const subjectCode = inferEssayLanguage(file.name);
  if (!subjectCode) {
    throw new Error(
      "Couldn't tell which language this file is. Name it so it contains \"English\" (ESL) or \"Arabic\" (AFL).",
    );
  }
  const matrix = await parseMasterfileMatrix(await file.arrayBuffer());
  return reconcileMasterfile(matrix, subjectCode);
}

/**
 * Convert reconciled students to the existing `EssayUploadRow[]` — ONE row per
 * student carrying the already-reconciled /20 (`subjectEssay`), keyed on the QM
 * email (the join key; the provider matcher / qm→uuid map resolve it to the
 * participant). Fed through the existing `uploadEssayMarks` path, whose per-student
 * averaging is identity on a single row, so the reconciled value reaches the
 * engine unchanged (halved once). `essayCount` carries the true number of essays
 * for the "pending" disclosure. Students with a blank email are still emitted (with
 * an empty `participantId`) so validation can REJECT them with a clear reason — the
 * join never silently drops a row.
 */
export function masterfileToUploadRows(result: EssayMasterfileResult): EssayUploadRow[] {
  return result.reconciled.map((s) => ({
    participantId: s.email,
    subjectCode: s.subjectCode,
    totalScore: s.subjectEssay,
    essayCount: s.essays.length,
  }));
}
