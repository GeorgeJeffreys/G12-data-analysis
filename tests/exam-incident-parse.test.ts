/**
 * Parser for the technical-incident export (0043). Locks the tolerant parsing
 * contract: emails lowercased (the only join key); `Duration (min)` + the affected
 * count coerced to int; empty `Questions Affected (list)` → null and a populated
 * one parsed to ids; a count > 0 with no list → the `q_list_missing` flag; missing
 * Reference / Email → a row `error` (never staged, never thrown); and the STU-…
 * `Student ID` carried as an informational label, never a join key.
 */
import { describe, it, expect } from "vitest";
import { parseExamIncidentRows, EXAM_INCIDENT_HEADERS } from "@/lib/incidents/exam-incident-parse";

const HEADER = Object.values(EXAM_INCIDENT_HEADERS);

/** Build a 20-column row in header order from a sparse patch (by logical field). */
function row(patch: Partial<Record<keyof typeof EXAM_INCIDENT_HEADERS, string>>): string[] {
  const keys = Object.keys(EXAM_INCIDENT_HEADERS) as (keyof typeof EXAM_INCIDENT_HEADERS)[];
  return keys.map((k) => patch[k] ?? "");
}

const base = {
  reference: "INC-2026-000002",
  examCycle: "May 2026",
  subject: "Arabic as a First Language",
  studentEmail: "H.A@Alsama.COM",
  studentId: "STU-2026-000004",
  duration: "181",
} as const;

describe("exam-incident parser", () => {
  it("lowercases the email and carries the STU-… id as a label (never a key)", () => {
    const { rows } = parseExamIncidentRows([HEADER, row(base)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.studentEmail).toBe("h.a@alsama.com");
    expect(rows[0]!.studentIdExternal).toBe("STU-2026-000004");
  });

  it("coerces Duration (min) and the affected count to int (authoritative duration)", () => {
    const { rows } = parseExamIncidentRows([HEADER, row({ ...base, duration: "181", questionsCount: "10" })]);
    expect(rows[0]!.durationMin).toBe(181);
    expect(rows[0]!.questionsAffectedCount).toBe(10);
  });

  it("returns null for a blank / non-numeric duration or count", () => {
    const { rows } = parseExamIncidentRows([HEADER, row({ ...base, duration: "", questionsCount: "n/a" })]);
    expect(rows[0]!.durationMin).toBeNull();
    expect(rows[0]!.questionsAffectedCount).toBeNull();
  });

  it("treats an empty Questions Affected (list) as null", () => {
    const { rows } = parseExamIncidentRows([HEADER, row({ ...base, questionsCount: "0", questionsList: "" })]);
    expect(rows[0]!.questionsAffectedList).toBeNull();
    expect(rows[0]!.flags).not.toContain("q_list_missing");
  });

  it("parses a populated question list into ids", () => {
    const { rows } = parseExamIncidentRows([HEADER, row({ ...base, questionsCount: "3", questionsList: "Q1, Q2; Q3" })]);
    expect(rows[0]!.questionsAffectedList).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("flags q_list_missing when count > 0 but the list is empty (never fails the row)", () => {
    const { rows } = parseExamIncidentRows([HEADER, row({ ...base, questionsCount: "10", questionsList: "" })]);
    expect(rows[0]!.flags).toContain("q_list_missing");
    expect(rows[0]!.errors).toHaveLength(0);
  });

  it("records a row error for a missing Reference or Email (surfaced, not thrown)", () => {
    const { rows, counts } = parseExamIncidentRows([
      HEADER,
      row({ ...base, reference: "" }),
      row({ ...base, studentEmail: "" }),
    ]);
    expect(counts.parseErrors).toBe(2);
    expect(rows[0]!.errors.join(" ")).toMatch(/Reference/i);
    expect(rows[1]!.errors.join(" ")).toMatch(/Email/i);
  });

  it("does not recompute duration from the time fields", () => {
    // Duration says 2 even though the times would imply otherwise — file is authoritative.
    const { rows } = parseExamIncidentRows([
      HEADER,
      row({ ...base, duration: "2", timeStarted: "09:00", timeResolved: "12:00" }),
    ]);
    expect(rows[0]!.durationMin).toBe(2);
  });

  it("skips a fully blank spacer row", () => {
    const { rows } = parseExamIncidentRows([HEADER, row({}), row(base)]);
    expect(rows).toHaveLength(1);
  });
});
