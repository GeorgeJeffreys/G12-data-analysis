/**
 * Parser for the app's fixed essay template (v2). The app owns one template on
 * both ends — it generates it pre-filled (`lib/data/essay-template.ts`) and parses
 * only this shape. It does NOT parse the markers' working spreadsheet.
 *
 * ## The template contract (the only shape this reads)
 * - `.xlsx` with two sheets `English Essay master` / `Arabic Essay master`. The
 *   SHEET NAME is the subject (English → ESL, Arabic → AFL). A single-language
 *   file (CSV or one-sheet xlsx) is also accepted, inferring the subject from the
 *   filename as a fallback.
 * - Header row: `QM email · Student name · Alsama Student ID · Essay ID · Marker ·
 *   Mark (/20) · Final essay mark (/20)`.
 * - 4 rows per student (2 essays × 2 markers). `Final essay mark` is filled ONCE
 *   per student, on that student's first row.
 *
 * ## The app reads ONLY three things
 * the **tab name** (→ subject), **`QM email`**, and **`Final essay mark`**. Every
 * other column (`Essay ID`, `Marker`, `Mark`, `Student name`, `Alsama Student ID`)
 * is the team's working record and is ignored. The two data columns are matched by
 * HEADER NAME (case-insensitive, tolerant of extra columns / whitespace / a
 * `(/20)` suffix): the email column contains "email"; the final column contains
 * "final".
 *
 * ## Rules
 *  1. Group data rows by `QM email` (lower-cased). Per student, take the single
 *     non-blank `Final essay mark`. None → rejected (`no final mark`); more than
 *     one → rejected (`multiple final marks`). (Rejections are surfaced by the
 *     validation layer with the resolved participant.)
 *  2. `ESSAY_MARK_ROUNDING` (named constant) — default `'half_up'`
 *     (`round_half_up(final)` → whole /20); `'none'` keeps the entered value.
 *  3. Join on `QM email` — exact, case-insensitive (validation layer). Blank /
 *     off-roster → rejected, never guessed. No DOB, no Student-ID, no crosswalk.
 *  4. Ignore `Essay ID` / `Marker` / `Mark` entirely.
 *
 * ## Full weight
 * The Final is the /20 subject essay; the engine adds it as-is against a reserved
 * max of 20 (`lib/engine/scores.ts`; wiring in `2026-07-essay-score-wiring.md`).
 * Fed straight through — halved zero further times. `lib/engine/*` untouched.
 *
 * Pure + engine-free. Uses the repo's SheetJS (`xlsx`) reader (`.xlsx` + `.csv`,
 * BOM-stripping).
 */

/** Arabic Unicode block (U+0600–U+06FF) — matches an Arabic-script sheet/filename. */
const ARABIC_SCRIPT = /[؀-ۿ]/;

/** Each subject essay is out of 20. */
export const ESSAY_ITEM_MAX = 20;

/**
 * How the entered `Final essay mark` is rounded to the stored subject mark.
 * Default `'half_up'` — `round_half_up(final)` → integer /20, consistent with the
 * MCQ scale. `'none'` — keep the entered value (e.g. 15.25). Single, inspectable,
 * one-line-changeable constant (George to confirm; default stands).
 */
export type EssayMarkRounding = "half_up" | "none";
export const ESSAY_MARK_ROUNDING: EssayMarkRounding = "half_up";

/** The two essay-carrying subjects, by sheet/subject code. */
export type EssaySubjectCode = "AFL" | "ESL";

/** Round half up on a 0.5 (`round_half_up(2.5) === 3`); positive marks only. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

/** Apply `ESSAY_MARK_ROUNDING` to an entered Final value. */
export function roundEssayMark(final: number): number {
  return ESSAY_MARK_ROUNDING === "half_up" ? roundHalfUp(final) : final;
}

/** One student's Final essay mark, extracted from a sheet (grouped by QM email). */
export interface ExtractedEssayStudent {
  subjectCode: EssaySubjectCode;
  /** QM email (the join key), lower-cased; "" when the row carried no email. */
  email: string;
  /** All non-blank `Final essay mark` values in this student's group. */
  finals: number[];
  /** The single Final /20 if exactly one, else null (0 or >1 → rejected). */
  finalRaw: number | null;
  /** The stored subject essay /20 after `ESSAY_MARK_ROUNDING`; null unless one Final. */
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
  email: number;
  final: number;
}

/** Resolve the ONLY two columns read — email + final — by header text. -1 if absent. */
function resolveColumns(headers: string[]): SheetColumns {
  const h = headers.map(norm);
  return {
    email: h.findIndex((s) => s.includes("email")),
    // "Final essay mark (/20)" — contains "final"
    final: h.findIndex((s) => s.includes("final")),
  };
}

/** Parse a numeric cell; blank/`""`/null → null, otherwise the number (keeps decimals). */
function numOrNull(cell: unknown): number | null {
  const s = String(cell ?? "").replace(/[^0-9.\-]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract one student per QM email from a sheet matrix. Groups data rows by the
 * lower-cased email, collecting every non-blank `Final essay mark`; a row with a
 * blank email AND blank Final is a pure detail row and is skipped. Pure — no
 * roster, no engine.
 */
export function extractSheet(matrix: string[][], subjectCode: EssaySubjectCode): ExtractedEssayStudent[] {
  if (matrix.length === 0) return [];
  const cols = resolveColumns(matrix[0] ?? []);

  const groups = new Map<string, { email: string; finals: number[]; order: number }>();
  let seq = 0;
  for (const row of matrix.slice(1)) {
    const email = cols.email >= 0 ? String(row[cols.email] ?? "").trim().toLowerCase() : "";
    const final = cols.final >= 0 ? numOrNull(row[cols.final]) : null;
    if (!email && final == null) continue; // blank/detail row
    const g = groups.get(email) ?? { email, finals: [], order: seq++ };
    if (final != null) g.finals.push(final);
    groups.set(email, g);
  }

  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({
      subjectCode,
      email: g.email,
      finals: g.finals,
      finalRaw: g.finals.length === 1 ? g.finals[0]! : null,
      subjectEssay: g.finals.length === 1 ? roundEssayMark(g.finals[0]!) : null,
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
 * Read + route the essay template (or single-language CSV/xlsx). Each sheet routes
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
