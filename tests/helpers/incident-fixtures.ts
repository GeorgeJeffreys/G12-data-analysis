/**
 * Test-only incident-row fixture.
 *
 * Production ships no synthetic incident data (the `loadSampleIncidentRows`
 * provider affordance was removed in the production cutover). This helper
 * reproduces the same representative set of resolved incident rows the old
 * sample used to inject, but through the REAL public import path
 * (`importIncidentRows`) — so the incident review / apply / permissions tests
 * keep exercising genuine behaviour without a demo affordance in shipped code.
 */
import type { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { ResolvedIncidentRow } from "@/lib/incidents/import";
import { classifyIncidentType } from "@/lib/incidents/config";

export function seedIncidentRows(provider: InMemoryDataProvider, cycleId: string): void {
  const comp = provider.getComposition(cycleId);
  if (!comp) return;
  const students = comp.students.slice(0, 3);
  const codes = provider.getIncidentConfig().codes;
  const rows: ResolvedIncidentRow[] = [];
  let n = 0;
  const push = (
    pid: string | null,
    name: string,
    incidentType: string,
    questionNumber: string,
    durationMinutes: number | null,
  ) => {
    n += 1;
    const matched = classifyIncidentType(incidentType, codes);
    const needsDuration = matched?.formula.kind === "per_duration";
    const errors: string[] = [];
    if (!pid) errors.push("No cohort participant matched this Student ID.");
    const status: ResolvedIncidentRow["status"] =
      needsDuration && durationMinutes === null ? "error" : matched ? "ok" : "unclassified";
    rows.push({
      rowNumber: n,
      rawStudentId: pid ?? "UNKNOWN-042",
      studentName: name,
      incidentType,
      questionNumber,
      durationMinutes,
      codeId: matched ? matched.id : null,
      status,
      errors,
      participantInternalId: pid,
      matched: pid !== null,
    });
  };
  if (students[0]) {
    push(students[0].participantId, students[0].name, "Calculator broke", "Q7", 40);
    push(students[0].participantId, students[0].name, "Fire alarm", "—", null); // fixed +1
  }
  if (students[1]) {
    // Several disruptions → sums over the per-student global cap (default 5).
    push(students[1].participantId, students[1].name, "Fire alarm", "—", null);
    push(students[1].participantId, students[1].name, "Power cut", "—", null);
    push(students[1].participantId, students[1].name, "Calculator failure", "Q3", 60); // 6→cap 3
    push(students[1].participantId, students[1].name, "Noise disruption", "—", null);
  }
  if (students[2]) {
    push(students[2].participantId, students[2].name, "Spilled water on desk", "Q1", null); // unclassified
  }
  // An unmatched row (no cohort participant) — surfaced for manual attention.
  push(null, "A. Nonymous", "Fire alarm", "—", null);
  provider.importIncidentRows(cycleId, rows, { fileName: "sample_incident_log.xlsx", sample: false });
}
