/**
 * Client-side parser for the OPTIONAL technical-errors spreadsheet uploaded at
 * Ingest. Columns: student, question, error (matched by header, case-insensitive,
 * with a positional fallback). Real file-reading path — the provider then turns
 * the rows into per-student incident records. CSV and XLSX both work via SheetJS.
 */
import type { TechnicalErrorRow } from "./provider";

function pickColumn(headers: string[], aliases: string[]): number {
  const lower = headers.map((h) => String(h ?? "").trim().toLowerCase());
  for (const a of aliases) {
    const i = lower.indexOf(a);
    if (i >= 0) return i;
  }
  // fuzzy contains
  for (let i = 0; i < lower.length; i++) {
    if (aliases.some((a) => lower[i]!.includes(a))) return i;
  }
  return -1;
}

export async function parseTechnicalErrors(file: File): Promise<TechnicalErrorRow[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, blankrows: false });
  if (matrix.length === 0) return [];

  const headers = (matrix[0] ?? []).map((h) => String(h ?? ""));
  let sCol = pickColumn(headers, ["student", "participant", "id", "pseudonym"]);
  let qCol = pickColumn(headers, ["question", "item", "qid", "q"]);
  let eCol = pickColumn(headers, ["error", "fault", "issue", "incident", "note"]);
  // If no recognisable header row, treat every row as data in the first 3 columns.
  const hasHeader = sCol >= 0 || qCol >= 0 || eCol >= 0;
  if (sCol < 0) sCol = 0;
  if (qCol < 0) qCol = 1;
  if (eCol < 0) eCol = 2;

  const dataRows = hasHeader ? matrix.slice(1) : matrix;
  return dataRows
    .map((r) => ({
      student: String(r[sCol] ?? "").trim(),
      question: String(r[qCol] ?? "").trim(),
      error: String(r[eCol] ?? "").trim(),
    }))
    .filter((r) => r.student || r.question || r.error);
}
