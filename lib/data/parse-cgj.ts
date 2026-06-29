/**
 * Client-side parser for the OPTIONAL centre expectations file uploaded at the
 * CGJ step. Partner centres list their students with an EXPECTED grade per
 * subject. The layout is a simple matrix: one row per student, the first column
 * the student name (or ID), and one column per subject (header = subject code or
 * name) whose cells carry the expected level (a PLD label, shorthand, or stars).
 *
 * Read from the first sheet whose name hints at expectations ("CGJ" / "Expected"
 * / "Grades" / "Judgement"), falling back to the first sheet. Messy reality is
 * tolerated — unknown headers, blank cells and stray rows never throw; cell
 * normalisation into canonical levels happens later, in the provider.
 */
import type { CgjUploadRow } from "./provider";

function findSheet(names: string[], needles: string[]): string | undefined {
  for (const needle of needles) {
    const hit = names.find((n) => n.toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return names[0];
}

function str(v: string | number | null | undefined): string {
  return String(v ?? "").trim();
}

/** Header columns that name the student, not a subject. */
const STUDENT_HEADER = /^(student|name|candidate|pupil|learner|id|student id|student name)$/i;

export async function parseCgjFile(file: File): Promise<CgjUploadRow[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = findSheet(wb.SheetNames, ["cgj", "expected", "judg", "grade", "result"]);
  if (!sheetName || !wb.Sheets[sheetName]) return [];
  const m = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[sheetName]!, {
    header: 1,
    blankrows: false,
  });
  if (m.length === 0) return [];

  // Locate the header row: the first row in the first few that names a student
  // column AND at least one other (subject) column.
  let h = 0;
  for (let i = 0; i < Math.min(m.length, 6); i++) {
    const cells = (m[i] ?? []).map(str);
    const nonEmpty = cells.filter(Boolean);
    if (nonEmpty.some((c) => STUDENT_HEADER.test(c)) && nonEmpty.length >= 2) {
      h = i;
      break;
    }
  }
  const headers = (m[h] ?? []).map(str);
  // The student column is the first header that looks like a name/id column, else
  // column 0.
  let studentCol = headers.findIndex((c) => STUDENT_HEADER.test(c));
  if (studentCol < 0) studentCol = 0;
  // Every other non-empty header is a subject column.
  const subjectCols = headers
    .map((label, i) => ({ label, i }))
    .filter(({ label, i }) => i !== studentCol && label.length > 0);

  const out: CgjUploadRow[] = [];
  for (const row of m.slice(h + 1)) {
    const studentName = str(row[studentCol]);
    if (!studentName) continue;
    const levels: Record<string, string> = {};
    for (const { label, i } of subjectCols) {
      const v = str(row[i]);
      if (v) levels[label] = v;
    }
    // Skip rows that carry a name but no expectations at all.
    if (Object.keys(levels).length === 0) continue;
    out.push({ studentName, levels });
  }
  return out;
}
