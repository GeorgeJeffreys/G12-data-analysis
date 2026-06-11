/**
 * Client-side parser for the OPTIONAL incident log uploaded at Ingest. This is a
 * free-text operational record, NOT a clean alteration list — the parser just
 * lands every row in a triage queue for a human to decide on (Adjustments step).
 *
 * Two sheets are read:
 *  - `Incident_Log` (header on ROW 3): # / Student name / Exam / Time started /
 *    Issue type / Action taken / Time resolved / Duration / Questions affected /
 *    Staff full name.
 *  - `Students Complaints` (student-submitted): name / email / school /
 *    description.
 *
 * Messy reality is tolerated: missing columns, "All students" rows, `n/a`
 * questions and ambiguous names never throw — they all become queue rows.
 */
import type { IncidentInput } from "./provider";

function headerIndex(headers: string[], aliases: string[]): number {
  const lower = headers.map((h) => String(h ?? "").trim().toLowerCase());
  for (const a of aliases) {
    const i = lower.indexOf(a);
    if (i >= 0) return i;
  }
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] && aliases.some((a) => lower[i]!.includes(a))) return i;
  }
  return -1;
}

function findSheet(names: string[], needle: string): string | undefined {
  return names.find((n) => n.toLowerCase().includes(needle));
}

function cell(row: (string | number | null)[], i: number): string {
  return i < 0 ? "" : String(row[i] ?? "").trim();
}

export async function parseIncidentLog(file: File): Promise<IncidentInput[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const out: IncidentInput[] = [];

  // --- Incident_Log (header on row 3 → index 2) ---
  const logName = findSheet(wb.SheetNames, "incident");
  if (logName && wb.Sheets[logName]) {
    const m = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[logName]!, { header: 1, blankrows: false });
    // Locate the header row: the row that mentions "student" and "exam"/"issue".
    let h = 2;
    for (let i = 0; i < Math.min(m.length, 6); i++) {
      const joined = (m[i] ?? []).map((c) => String(c ?? "").toLowerCase()).join(" ");
      if (joined.includes("student") && (joined.includes("exam") || joined.includes("issue"))) {
        h = i;
        break;
      }
    }
    const headers = (m[h] ?? []).map((c) => String(c ?? ""));
    const idx = {
      student: headerIndex(headers, ["student name", "student", "name"]),
      exam: headerIndex(headers, ["exam", "subject", "assessment"]),
      issue: headerIndex(headers, ["issue type", "issue", "fault", "problem"]),
      action: headerIndex(headers, ["action taken", "action", "resolution"]),
      questions: headerIndex(headers, ["questions affected", "questions", "items", "q"]),
      staff: headerIndex(headers, ["staff full name", "staff", "invigilator"]),
    };
    for (const row of m.slice(h + 1)) {
      const studentName = cell(row, idx.student);
      const issueType = cell(row, idx.issue);
      const actionTaken = cell(row, idx.action);
      // skip wholly empty rows
      if (!studentName && !issueType && !actionTaken) continue;
      out.push({
        source: "incident_log",
        studentName,
        exam: cell(row, idx.exam),
        issueType,
        actionTaken,
        questionsAffected: cell(row, idx.questions),
        staff: cell(row, idx.staff),
      });
    }
  }

  // --- Students Complaints ---
  const compName = findSheet(wb.SheetNames, "complaint");
  if (compName && wb.Sheets[compName]) {
    const m = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[compName]!, { header: 1, blankrows: false });
    let h = 0;
    for (let i = 0; i < Math.min(m.length, 6); i++) {
      const joined = (m[i] ?? []).map((c) => String(c ?? "").toLowerCase()).join(" ");
      if (joined.includes("name") || joined.includes("description") || joined.includes("email")) {
        h = i;
        break;
      }
    }
    const headers = (m[h] ?? []).map((c) => String(c ?? ""));
    const idx = {
      name: headerIndex(headers, ["name", "student"]),
      email: headerIndex(headers, ["email", "e-mail"]),
      school: headerIndex(headers, ["school", "centre", "center"]),
      desc: headerIndex(headers, ["description", "complaint", "detail", "issue"]),
    };
    for (const row of m.slice(h + 1)) {
      const studentName = cell(row, idx.name);
      const description = cell(row, idx.desc);
      if (!studentName && !description) continue;
      out.push({
        source: "complaint",
        studentName,
        email: cell(row, idx.email),
        school: cell(row, idx.school),
        description,
      });
    }
  }

  return out;
}
