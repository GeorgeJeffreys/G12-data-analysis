/**
 * Parser for the marking team's essay WORKBOOK. The team has already reconciled
 * and moderated the essays; this parser reads their single per-student decision
 * column directly and does NOT recompute anything.
 *
 * ## The file (verified against the real workbook)
 * - An `.xlsx` workbook with TWO sheets: `English Essay master` and
 *   `Arabic Essay master`. Each sheet is routed to its subject BY SHEET NAME
 *   (English → English 2nd Language; Arabic → اللّغة العربيّة). A single-language
 *   file (CSV or one-sheet xlsx) is also accepted, inferring the subject from the
 *   filename as a fallback.
 * - The mark to use per sheet is `Adjusted scores (USE THESE)` — ONE value per
 *   student (it sits on the student's first row; blank elsewhere). It is the
 *   moderated subject essay score, /20. Everything else — `Dim1–5`, `Total score`,
 *   `Average`, `Final scores:`, `Moderated final score`, all tracking/junk — is an
 *   input the team already consumed and is ignored.
 * - The JOIN KEY is a column G12 fill with the participant's QM email
 *   (`ResultParticipantName`). Its header is matched defensively (case-insensitive,
 *   contains "email"). The Alsama `Student ID` is a DISPLAY LABEL only — there is
 *   NO identity mapping in the app (no DOB, no Student-ID resolution, no crosswalk).
 *
 * ## Rules (explicit)
 *  1. Per student, take the single populated `Adjusted scores (USE THESE)` value
 *     for that sheet → the subject essay /20. A student with none is rejected
 *     (at validation) with a clear reason. One value per student per subject.
 *  2. Rounding — `ESSAY_MARK_ROUNDING` (named constant). Default `'half_up'`:
 *     `round_half_up(adjusted)` → whole /20 (e.g. 15.25 → 15, 18.5 → 19).
 *     `'none'`: keep the team's exact value. One-line change either way.
 *  3. Join on the QM email column — exact, case-insensitive — to the subject
 *     roster (validation layer). Blank / off-roster email → rejected, never guessed.
 *  4. Never recompute the mark from per-essay scores. `Adjusted scores (USE THESE)`
 *     is authoritative.
 *
 * ## Not a double-halve
 * The engine adds the per-subject essay `mark` to the numerator AS-IS against a
 * reserved max of 20 (`lib/engine/scores.ts`; wiring proven in
 * `docs/diagnostics/2026-07-essay-score-wiring.md`). The Adjusted value is already
 * the /20 subject essay, so it is fed straight through at FULL weight — halved
 * zero further times. `lib/engine/*` is untouched.
 *
 * Pure + engine-free. Uses the repo's existing SheetJS (`xlsx`) reader, which
 * reads both `.xlsx` and `.csv` and strips the UTF-8 BOM.
 */

/** Arabic Unicode block (U+0600–U+06FF) — matches an Arabic-script sheet/filename. */
const ARABIC_SCRIPT = /[؀-ۿ]/;

/** Each subject essay is out of 20. */
export const ESSAY_ITEM_MAX = 20;

/**
 * How the moderated `Adjusted` value is rounded to the stored subject mark.
 * Default `'half_up'` — `round_half_up(adjusted)` → integer /20, consistent with
 * the MCQ scale. `'none'` — keep the team's exact quarter-point value. Single,
 * inspectable, one-line-changeable constant (George to confirm; default stands).
 */
export type EssayMarkRounding = "half_up" | "none";
export const ESSAY_MARK_ROUNDING: EssayMarkRounding = "half_up";

/** The two essay-carrying subjects, by sheet/subject code. */
export type EssaySubjectCode = "AFL" | "ESL";

/** Round half up on a 0.5 (`round_half_up(2.5) === 3`); positive marks only. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

/** Apply `ESSAY_MARK_ROUNDING` to a raw Adjusted value. */
export function roundEssayMark(adjusted: number): number {
  return ESSAY_MARK_ROUNDING === "half_up" ? roundHalfUp(adjusted) : adjusted;
}

/** One student's moderated subject essay, extracted from a sheet. */
export interface ExtractedEssayStudent {
  subjectCode: EssaySubjectCode;
  /** QM email (the join key), lower-cased; "" when G12 left it blank. */
  email: string;
  /** Alsama Student ID from the file — a DISPLAY LABEL only, never the join key. */
  studentLabel: string;
  /** Student name from the file (display only). */
  studentName: string;
  /** The `Adjusted scores (USE THESE)` value as-is (/20); null if the student has none. */
  adjustedRaw: number | null;
  /** The stored subject essay /20 after `ESSAY_MARK_ROUNDING`; null if no Adjusted. */
  subjectEssay: number | null;
}

export interface EssayMasterfileResult {
  students: ExtractedEssayStudent[];
  /** Subject codes whose sheet was found and read. */
  subjectsSeen: EssaySubjectCode[];
  /** Sheet names present but not routable to an essay subject (informational). */
  skippedSheets: string[];
}

/** Route a sheet name to its subject: English → ESL, Arabic (word/script) → AFL. */
export function sheetSubjectCode(sheetName: string): EssaySubjectCode | null {
  const s = (sheetName || "").toLowerCase();
  if (ARABIC_SCRIPT.test(sheetName) || s.includes("arabic")) return "AFL";
  if (s.includes("english")) return "ESL";
  return null;
}

/** Fallback subject inference from the file name for a single-language file. */
export function inferEssayLanguage(fileName: string): EssaySubjectCode | null {
  return sheetSubjectCode(fileName);
}

/** Normalise a header cell for defensive matching (trim, collapse ws, lowercase). */
function norm(h: unknown): string {
  return String(h ?? "").replace(/﻿/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

interface SheetColumns {
  adjusted: number;
  email: number;
  studentName: number;
  studentId: number;
}

/**
 * Resolve the columns we read by HEADER TEXT (case/whitespace-tolerant). Only four
 * matter; every other column (Dim1–5, Total, Average, Final/Moderated, junk) is
 * ignored. Returns -1 for a column that is absent.
 */
function resolveColumns(headers: string[]): SheetColumns {
  const h = headers.map(norm);
  const find = (pred: (s: string) => boolean) => h.findIndex(pred);
  return {
    // "Adjusted scores (USE THESE)"
    adjusted: find((s) => s.includes("adjusted")),
    // the QM email column G12 fill (contains "email")
    email: find((s) => s.includes("email")),
    studentName: find((s) => s.includes("student name") || (s.includes("name") && !s.includes("id") && !s.includes("email") && !s.includes("sheet") && !s.includes("file"))),
    // Alsama Student ID label (not "essay id", not the email column)
    studentId: find((s) => s.includes("student id") || (s.includes("id") && !s.includes("essay") && !s.includes("email") && !s.includes("name"))),
  };
}

/** Parse a numeric cell; blank/`""`/null → null, otherwise the number (keeps decimals). */
function numOrNull(cell: unknown): number | null {
  const s = String(cell ?? "").replace(/[^0-9.\-]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function str(cell: unknown): string {
  return String(cell ?? "").trim();
}

/**
 * Extract one moderated student per group from a sheet matrix. Rows are grouped
 * into students by the Student ID column with FORWARD-FILL (the ID sits on the
 * student's first row, blank on the marker/essay detail rows below — the common
 * "merged cell" workbook layout). If the sheet has no Student ID column, each row
 * carrying an email or an Adjusted value is treated as its own student. Within a
 * group we take the single non-blank `Adjusted`, and the first non-blank email/name.
 * Pure — no roster, no engine.
 */
export function extractSheet(matrix: string[][], subjectCode: EssaySubjectCode): ExtractedEssayStudent[] {
  if (matrix.length === 0) return [];
  const cols = resolveColumns(matrix[0] ?? []);

  interface Group {
    order: number;
    label: string;
    email: string;
    name: string;
    adjusted: number | null;
  }
  const groups: Group[] = [];
  let current: Group | null = null;
  let seq = 0;

  const startGroup = (label: string): Group => {
    const g: Group = { order: seq++, label, email: "", name: "", adjusted: null };
    groups.push(g);
    return g;
  };

  for (const row of matrix.slice(1)) {
    const idCell = cols.studentId >= 0 ? str(row[cols.studentId]) : "";
    const email = cols.email >= 0 ? str(row[cols.email]).toLowerCase() : "";
    const name = cols.studentName >= 0 ? str(row[cols.studentName]) : "";
    const adjusted = cols.adjusted >= 0 ? numOrNull(row[cols.adjusted]) : null;

    if (cols.studentId >= 0) {
      // Forward-fill: a non-blank Student ID starts a new student; blank rows below
      // attach to the current one.
      if (idCell) current = startGroup(idCell);
      if (!current) {
        // A detail row before any anchor, or a student whose ID is genuinely blank
        // but that carries a value — anchor on the value so it is never dropped.
        if (email || name || adjusted != null) current = startGroup("");
        else continue;
      }
    } else {
      // No Student ID column: each row with an email or an Adjusted value is a student.
      if (email || adjusted != null || name) current = startGroup("");
      else continue;
    }

    if (email && !current.email) current.email = email;
    if (name && !current.name) current.name = name;
    if (adjusted != null && current.adjusted == null) current.adjusted = adjusted;
  }

  return groups.map((g) => ({
    subjectCode,
    email: g.email,
    studentLabel: g.label,
    studentName: g.name,
    adjustedRaw: g.adjusted,
    subjectEssay: g.adjusted == null ? null : roundEssayMark(g.adjusted),
  }));
}

/** Read a workbook/CSV into per-sheet row matrices via the repo's SheetJS reader. */
export async function readWorkbookSheets(input: string | ArrayBuffer): Promise<{ name: string; matrix: string[][] }[]> {
  const XLSX = await import("xlsx");
  const wb = typeof input === "string" ? XLSX.read(input, { type: "string" }) : XLSX.read(input, { type: "array", codepage: 65001 });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const matrix = sheet ? XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, raw: false, defval: "" }) : [];
    return { name, matrix };
  });
}

/**
 * Read + route an essay workbook (or single-language CSV/xlsx). Each sheet routes
 * by NAME; a lone sheet whose name does not route falls back to the FILE NAME.
 */
export async function parseEssayMasterfile(file: File): Promise<EssayMasterfileResult> {
  const sheets = await readWorkbookSheets(await file.arrayBuffer());
  const students: ExtractedEssayStudent[] = [];
  const subjectsSeen = new Set<EssaySubjectCode>();
  const skippedSheets: string[] = [];

  for (const { name, matrix } of sheets) {
    const code = sheetSubjectCode(name) ?? (sheets.length === 1 ? inferEssayLanguage(file.name) : null);
    if (!code) {
      skippedSheets.push(name);
      continue;
    }
    subjectsSeen.add(code);
    students.push(...extractSheet(matrix, code));
  }

  return { students, subjectsSeen: [...subjectsSeen], skippedSheets };
}
