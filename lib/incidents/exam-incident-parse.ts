/**
 * Tolerant parser for the REAL technical-incident export (the 20-column
 * `exam-incidents-YYYY-MM-DD.csv` the operations team produces). This is ingest
 * only — it turns the file into typed rows and surfaces row-level problems; it
 * NEVER derives an adjustment. `Action Taken` is free text and `Code` classifies
 * the *issue*, not the *remedy*, so neither is parsed into a mark change (see
 * `docs/incident-upload-findings.md`, §3 gate).
 *
 * Pure + engine-free (no Supabase / React): the matrix→rows step is fully unit
 * testable with a plain string matrix. `parseExamIncidentMatrix` is the thin
 * SheetJS wrapper that turns an uploaded File/CSV into that matrix (SheetJS also
 * parses CSV and strips the UTF-8 BOM), mirroring `parse-essay-masterfile.ts`.
 *
 * Guarantees (nothing silently dropped):
 *  - Every input row yields exactly one `ParsedExamIncidentRow`.
 *  - Emails are lowercased on ingest (the only valid join key). `Student ID`
 *    (STU-…) is carried as an informational label and is NEVER a join key.
 *  - `Duration (min)` and the affected-question COUNT are coerced to int;
 *    `Duration (min)` is authoritative and is never recomputed from the times.
 *  - An empty `Questions Affected (list)` becomes `null`; a populated one is
 *    parsed into a string[] of ids.
 *  - Row-level problems are recorded as `errors` (a missing Reference/Email — the
 *    row cannot be staged, both are NOT NULL) or `flags` (`q_list_missing` when a
 *    count > 0 has no list), never thrown.
 */

/** The 20 canonical logical fields, each mapped to its file header. */
export const EXAM_INCIDENT_HEADERS = {
  reference: "Reference",
  examCycle: "Exam Cycle",
  subject: "Subject",
  examDate: "Exam Date",
  partnerCenter: "Partner Center",
  category: "Category",
  issue: "Issue",
  code: "Code",
  studentName: "Student Name",
  studentEmail: "Student Email",
  studentId: "Student ID",
  timeStarted: "Time Started",
  timeResolved: "Time Resolved",
  duration: "Duration (min)",
  actionTaken: "Action Taken",
  questionsCount: "Questions Affected (count)",
  questionsList: "Questions Affected (list)",
  status: "Status",
  invigilator: "Invigilator",
  createdAt: "Created At",
} as const;

/** One parsed incident row, pre-match. Every input row yields exactly one. */
export interface ParsedExamIncidentRow {
  /** 1-based source row number (excludes the header), for surfacing in the UI. */
  rowNumber: number;
  reference: string;
  examCycle: string;
  subjectRaw: string;
  examDate: string | null;
  partnerCenter: string;
  category: string;
  issue: string;
  code: string;
  studentName: string;
  /** Lowercased on ingest — the ONLY valid participant join key. */
  studentEmail: string;
  /** The STU-… value. Informational only; NEVER a join key. */
  studentIdExternal: string;
  /** Stored as given; times are informational (duration is authoritative). */
  timeStarted: string;
  timeResolved: string;
  /** Authoritative duration in minutes; null when blank/unparseable. */
  durationMin: number | null;
  /** Free text; informational only — never parsed into an adjustment. */
  actionTaken: string;
  questionsAffectedCount: number | null;
  /** Parsed ids when present; null when the list cell is empty. */
  questionsAffectedList: string[] | null;
  status: string;
  invigilator: string;
  sourceCreatedAt: string | null;
  /** Hard row problems (missing Reference/Email) — the row cannot be staged. */
  errors: string[];
  /** Non-fatal flags surfaced in the report (e.g. `q_list_missing`). */
  flags: string[];
}

export interface ParseExamIncidentsResult {
  rows: ParsedExamIncidentRow[];
  counts: { total: number; parseErrors: number };
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Normalise a header cell for tolerant matching (strip BOM, trim, collapse ws, lowercase). */
function normHeader(h: unknown): string {
  return String(h ?? "").replace(/﻿/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Coerce a numeric cell to an integer; blank / non-numeric → null. */
export function intOrNull(raw: unknown): number | null {
  const s = str(raw);
  if (!s) return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Parse the "Questions Affected (list)" cell into a list of ids. Empty → null.
 * Splits on commas / semicolons / whitespace and trims; keeps ids verbatim (they
 * are QM-facing labels, not numbers to coerce).
 */
export function parseQuestionList(raw: unknown): string[] | null {
  const s = str(raw);
  if (!s) return null;
  const ids = s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

/** Map each canonical field to its 0-based column index (header-text tolerant). */
function resolveColumns(headers: readonly unknown[]): Record<keyof typeof EXAM_INCIDENT_HEADERS, number> {
  const norm = headers.map(normHeader);
  const idx = {} as Record<keyof typeof EXAM_INCIDENT_HEADERS, number>;
  for (const key of Object.keys(EXAM_INCIDENT_HEADERS) as (keyof typeof EXAM_INCIDENT_HEADERS)[]) {
    idx[key] = norm.indexOf(normHeader(EXAM_INCIDENT_HEADERS[key]));
  }
  return idx;
}

/**
 * Parse + validate a technical-incident row matrix (row 0 = headers). Pure — no
 * cohort matching (see `matchExamIncidents`). Tolerates whitespace, coerces
 * numerics, lowercases emails, and records (never throws) row-level problems.
 */
export function parseExamIncidentRows(matrix: readonly (readonly unknown[])[]): ParseExamIncidentsResult {
  if (matrix.length === 0) return { rows: [], counts: { total: 0, parseErrors: 0 } };
  const cols = resolveColumns(matrix[0] ?? []);
  const cell = (row: readonly unknown[], key: keyof typeof EXAM_INCIDENT_HEADERS): string =>
    cols[key] >= 0 ? str(row[cols[key]]) : "";

  const rows: ParsedExamIncidentRow[] = [];
  let parseErrors = 0;

  matrix.slice(1).forEach((row, i) => {
    // Skip a fully blank spacer row (no reference AND no email AND no subject).
    const reference = cell(row, "reference");
    const email = cell(row, "studentEmail").toLowerCase();
    const subjectRaw = cell(row, "subject");
    if (!reference && !email && !subjectRaw && !cell(row, "studentName")) return;

    const questionsAffectedCount = intOrNull(cols.questionsCount >= 0 ? row[cols.questionsCount] : "");
    const questionsAffectedList = parseQuestionList(cols.questionsList >= 0 ? row[cols.questionsList] : "");

    const errors: string[] = [];
    if (!reference) errors.push("Missing Reference — the row cannot be staged (Reference is the upsert key).");
    if (!email) errors.push("Missing Student Email — the row cannot be matched or staged.");

    const flags: string[] = [];
    // A per-question remedy downstream would need the ids; flag (never fail).
    if ((questionsAffectedCount ?? 0) > 0 && !questionsAffectedList) flags.push("q_list_missing");

    if (errors.length > 0) parseErrors += 1;

    rows.push({
      rowNumber: i + 1,
      reference,
      examCycle: cell(row, "examCycle"),
      subjectRaw,
      examDate: cell(row, "examDate") || null,
      partnerCenter: cell(row, "partnerCenter"),
      category: cell(row, "category"),
      issue: cell(row, "issue"),
      code: cell(row, "code"),
      studentName: cell(row, "studentName"),
      studentEmail: email,
      studentIdExternal: cell(row, "studentId"),
      timeStarted: cell(row, "timeStarted"),
      timeResolved: cell(row, "timeResolved"),
      durationMin: intOrNull(cols.duration >= 0 ? row[cols.duration] : ""),
      actionTaken: cell(row, "actionTaken"),
      questionsAffectedCount,
      questionsAffectedList,
      status: cell(row, "status"),
      invigilator: cell(row, "invigilator"),
      sourceCreatedAt: cell(row, "createdAt") || null,
      errors,
      flags,
    });
  });

  return { rows, counts: { total: rows.length, parseErrors } };
}

/**
 * Browser/CSV-only: read a technical-incident export into a row matrix using the
 * repo's existing SheetJS reader (parses CSV, strips the UTF-8 BOM). Accepts a
 * decoded string (tests) or the raw file bytes (upload). `raw: false` keeps every
 * cell as a trimmed string so numeric coercion is ours, not SheetJS's.
 */
export async function parseExamIncidentMatrix(input: string | ArrayBuffer): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const wb = typeof input === "string" ? XLSX.read(input, { type: "string" }) : XLSX.read(input, { type: "array", codepage: 65001 });
  const name = wb.SheetNames[0];
  if (!name) return [];
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, raw: false, defval: "" });
}

/** Read + parse a technical-incident export File. */
export async function parseExamIncidentFile(file: File): Promise<ParseExamIncidentsResult> {
  const matrix = await parseExamIncidentMatrix(await file.arrayBuffer());
  return parseExamIncidentRows(matrix);
}
