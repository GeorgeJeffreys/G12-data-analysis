/**
 * Grades workbook: each participant's section grades and overall grade, plus a
 * grade-distribution summary.
 */

import { XLSX } from "./sheet-utils";
import type { GradesInput } from "./types";

export function buildGradesWorkbook(input: GradesInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { assessments, participants, grades } = input;

  const gradeByKey = new Map(grades.map((g) => [`${g.participantId} ${g.scope}`, g]));

  // --- Grades sheet ---------------------------------------------------------
  const header: string[] = ["Participant"];
  for (const a of assessments) header.push(`${a.name} Grade`);
  header.push("Overall Grade", "Overall Score");

  const rows: (string | number | null)[][] = [header];
  for (const p of participants) {
    const row: (string | number | null)[] = [p.label];
    for (const a of assessments) {
      row.push(gradeByKey.get(`${p.id} ${a.id}`)?.gradeLabel ?? null);
    }
    const overall = gradeByKey.get(`${p.id} overall`);
    row.push(overall?.gradeLabel ?? null, overall?.score ?? null);
    rows.push(row);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Grades");

  // --- Distribution sheet ---------------------------------------------------
  const distRows: (string | number)[][] = [["Grade", "Count"]];
  const counts = new Map<string, number>();
  for (const g of grades) {
    if (g.scope !== "overall" || !g.gradeLabel) continue;
    counts.set(g.gradeLabel, (counts.get(g.gradeLabel) ?? 0) + 1);
  }
  for (const [label, count] of counts) distRows.push([label, count]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(distRows), "Distribution");

  return wb;
}

export const GRADES_FIXED_HEADERS = ["Participant"] as const;
