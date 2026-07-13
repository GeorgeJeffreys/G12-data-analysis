/**
 * Parser for the app's fixed essay template. The app owns ONE template on both
 * ends — it generates it pre-filled (`lib/data/essay-template.ts`) and parses only
 * this shape. It does NOT parse the markers' working spreadsheet, and it does NOT
 * depend on the sheet's structure beyond the three anchors below: the marking
 * sheets are living documents (dimension scores, moderation, per-essay finals,
 * `/10` halving) and the two sheets drift apart, so everything else is the team's
 * working area the app never reads.
 *
 * ## The contract — the ONLY things the app reads
 *  1. **Tab name → subject.** `English Essay master` → English (ESL); `Arabic Essay
 *     master` → Arabic (AFL).
 *  2. **`QM email`** — matched case-insensitively (the sheets use both `QM Email`
 *     and `QM email`).
 *  3. **`Final essay mark (/20)`** — the subject final, ONE value per student (on
 *     the student's first row). Matched by EXACT normalized header (lowercase, trim,
 *     collapse whitespace → `final essay mark (/20)`), NOT by substring — the
 *     English sheet also carries `Indvidual final scores (/20)` and `Individual
 *     final scores (/10)`, which must NOT be picked up.
 *
 * Everything else — `Dim1–5`, `Total score`, `Average`, `Flag`, `Moderated score`,
 * per-essay `Individual final` columns, `/10`, `Essay ID`, `Marker`, `Mark`,
 * `Student name`, `Alsama Student ID` — is ignored.
 *
 * ## Enforce the contract
 * A sheet that maps to a subject but has no column whose normalized header is
 * exactly `final essay mark (/20)` (or no `qm email` column) is REJECTED as a whole
 * with a clear message, so the contract fails loudly rather than silently mis-read.
 *
 * ## Rules
 *  1. Group data rows by `QM email` (lower-cased). Per student, take the single
 *     non-blank `Final essay mark`. None → rejected (`no final mark`); more than one
 *     → rejected (`multiple final marks`). (Rejections are surfaced by the
 *     validation layer with the resolved participant.)
 *  2. `ESSAY_MARK_ROUNDING` (named constant) — default `'half_up'`
 *     (`round_half_up(final)` → whole /20, e.g. 15.5 → 16); `'none'` keeps the
 *     entered value.
 *  3. Join on `QM email` — exact, case-insensitive (validation layer). Blank /
 *     off-roster → rejected, never guessed. No DOB, no Student-ID, no crosswalk.
 *
 * ## Full weight
 * The Final IS the /20 subject essay; the engine adds it as-is against a reserved
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

/** The exact normalized header of the ONLY score column the app reads. */
export const FINAL_HEADER = "final essay mark (/20)";
/** The exact normalized header of the join-key column. */
export const EMAIL_HEADER = "qm email";

/**
 * How the entered `Final essay mark` is rounded to the stored subject mark.
 * Default `'half_up'` — `round_half_up(final)` → integer /20, consistent with the
 * MCQ scale (e.g. 15.5 → 16). `'none'` — keep the entered value (e.g. 15.5).
 * Single, inspectable, one-line-changeable constant (George to confirm; default
 * stands).
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

/** A sheet that maps to a subject but violates the column contract (rejected whole). */
export interface EssaySheetError {
  sheet: string;
  subjectCode: EssaySubjectCode;
  reason: string;
}

export interface EssayMasterfileResult {
  students: ExtractedEssayStudent[];
  /** Subject codes whose sheet was found, routable, AND contract-valid. */
  subjectsSeen: EssaySubjectCode[];
  /** Sheet names present but not routable to an essay subject (informational). */
  skippedSheets: string[];
  /**
   * Mapped sheets rejected wholesale for breaking the column contract. Always set
   * by `parseEssayMasterfile`; optional so callers that hand-build a result (tests
   * feeding a pre-extracted matrix) may omit it.
   */
  sheetErrors?: EssaySheetError[];
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

/** Normalise a header cell (strip BOM, trim, collapse whitespace, lowercase). */
export function normalizeHeader(h: unknown): string {
  return String(h ?? "").replace(/﻿/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

interface SheetColumns {
  email: number;
  final: number;
}

/**
 * Resolve the ONLY two columns the app reads — `QM email` and `Final essay mark
 * (/20)` — by EXACT normalized header. -1 when absent. The Final column is matched
 * exactly (never by substring) so the decoy `Individual final scores (/10)` /
 * `Indvidual final scores (/20)` columns are never picked up.
 */
export function resolveColumns(headers: unknown[]): SheetColumns {
  const h = headers.map(normalizeHeader);
  return {
    email: h.indexOf(EMAIL_HEADER),
    final: h.indexOf(FINAL_HEADER),
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
 * Extract one student per QM email from a sheet matrix. Assumes the column contract
 * holds (see `resolveColumns`); returns `[]` when the canonical Final column is
 * absent (the caller records a sheet-level rejection). Groups data rows by the
 * lower-cased email, collecting every non-blank `Final essay mark`; a row with a
 * blank email AND blank Final is a pure detail row and is skipped. Pure — no
 * roster, no engine.
 */
export function extractSheet(matrix: unknown[][], subjectCode: EssaySubjectCode): ExtractedEssayStudent[] {
  if (matrix.length === 0) return [];
  const cols = resolveColumns(matrix[0] ?? []);
  if (cols.final < 0) return []; // no canonical column → nothing to extract

  const groups = new Map<string, { email: string; finals: number[]; order: number }>();
  let seq = 0;
  for (const row of matrix.slice(1)) {
    const email = cols.email >= 0 ? String(row[cols.email] ?? "").trim().toLowerCase() : "";
    const final = numOrNull(row[cols.final]);
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

/**
 * Check the column contract for one mapped sheet. Returns a rejection reason when
 * the canonical Final column (or the QM email column) is missing, else null.
 */
export function sheetContractError(matrix: unknown[][], subjectCode: EssaySubjectCode): string | null {
  const cols = resolveColumns(matrix[0] ?? []);
  if (cols.final < 0)
    return `The ${subjectCode} sheet has no “Final essay mark (/20)” column — add a “Final essay mark (/20)” column holding one subject final per student.`;
  if (cols.email < 0) return `The ${subjectCode} sheet has no “QM email” column — the app joins marks on the QM email.`;
  return null;
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
 * by NAME; a lone sheet whose name does not route falls back to the FILE NAME. A
 * routed sheet that breaks the column contract is rejected wholesale (`sheetErrors`)
 * rather than silently mis-read.
 */
export async function parseEssayMasterfile(file: File): Promise<EssayMasterfileResult> {
  const sheets = await readWorkbookSheets(await file.arrayBuffer());
  const students: ExtractedEssayStudent[] = [];
  const subjectsSeen = new Set<EssaySubjectCode>();
  const skippedSheets: string[] = [];
  const sheetErrors: EssaySheetError[] = [];

  for (const { name, matrix } of sheets) {
    const code = sheetSubjectCode(name) ?? (sheets.length === 1 ? inferEssayLanguage(file.name) : null);
    if (!code) {
      skippedSheets.push(name);
      continue;
    }
    const err = sheetContractError(matrix, code);
    if (err) {
      sheetErrors.push({ sheet: name, subjectCode: code, reason: err });
      continue; // reject the whole sheet — never partially read a broken contract
    }
    subjectsSeen.add(code);
    students.push(...extractSheet(matrix, code));
  }

  return { students, subjectsSeen: [...subjectsSeen], skippedSheets, sheetErrors };
}
