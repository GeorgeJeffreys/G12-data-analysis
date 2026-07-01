/**
 * Incident import parser — reconfigurable mapping, row-level validation,
 * bucketing into codes / unclassified, duration parsing, and participant
 * resolution on P-A's stable internal id. Every input row must surface somewhere
 * (ok / unclassified / error) — nothing silently dropped.
 */
import { describe, it, expect } from "vitest";
import {
  parseIncidentRows,
  parseDurationMinutes,
  resolveParticipants,
} from "@/lib/incidents/import";
import { defaultIncidentConfig } from "@/lib/incidents/config";
import type { IncidentColumnMapping } from "@/lib/incidents/types";

const mapping: IncidentColumnMapping = {
  studentId: "Student ID",
  studentName: "Student Name",
  incidentType: "Incident Type",
  questionNumber: "Question Number",
  duration: "Incident Duration",
};
const codes = defaultIncidentConfig().codes;

describe("parseDurationMinutes", () => {
  it("reads bare numbers, unit strings and clock forms", () => {
    expect(parseDurationMinutes("15")).toBe(15);
    expect(parseDurationMinutes("15 min")).toBe(15);
    expect(parseDurationMinutes("10 minutes")).toBe(10);
    expect(parseDurationMinutes("1:30")).toBeCloseTo(1.5, 5);
    expect(parseDurationMinutes("")).toBeNull();
    expect(parseDurationMinutes("n/a")).toBeNull();
  });
});

describe("parseIncidentRows — mapping + bucketing", () => {
  it("classifies a matched incident type to its code", () => {
    const rows = [
      { "Student ID": "amy@x.io", "Student Name": "Amy", "Incident Type": "calculator broke", "Question Number": "Q3", "Incident Duration": "12 min" },
    ];
    const res = parseIncidentRows(rows, mapping, codes);
    expect(res.rows[0]!.status).toBe("ok");
    expect(res.rows[0]!.codeId).toBe(codes.find((c) => c.code === "CALC_FAIL")!.id);
    expect(res.rows[0]!.durationMinutes).toBe(12);
    expect(res.counts.ok).toBe(1);
  });

  it("routes an unmatched incident type to the unclassified bucket (never dropped)", () => {
    const rows = [
      { "Student ID": "bob@x.io", "Student Name": "Bob", "Incident Type": "meteor strike", "Question Number": "", "Incident Duration": "" },
    ];
    const res = parseIncidentRows(rows, mapping, codes);
    expect(res.rows[0]!.status).toBe("unclassified");
    expect(res.rows[0]!.codeId).toBeNull();
    expect(res.counts.unclassified).toBe(1);
  });

  it("flags a row with no Student ID as an error (but keeps it)", () => {
    const rows = [
      { "Student ID": "", "Student Name": "", "Incident Type": "calculator broke", "Question Number": "", "Incident Duration": "5" },
    ];
    const res = parseIncidentRows(rows, mapping, codes);
    expect(res.rows[0]!.status).toBe("error");
    expect(res.rows[0]!.errors.join(" ")).toMatch(/Student ID/i);
    expect(res.counts.error).toBe(1);
    expect(res.rows).toHaveLength(1); // surfaced, not dropped
  });

  it("flags a missing duration when the matched code needs one", () => {
    const rows = [
      { "Student ID": "cara@x.io", "Student Name": "Cara", "Incident Type": "calculator broke", "Question Number": "", "Incident Duration": "" },
    ];
    const res = parseIncidentRows(rows, mapping, codes);
    expect(res.rows[0]!.status).toBe("error");
    expect(res.rows[0]!.errors.join(" ")).toMatch(/duration/i);
  });

  it("does NOT require a duration for a fixed-formula code", () => {
    const rows = [
      { "Student ID": "dan@x.io", "Student Name": "Dan", "Incident Type": "fire alarm", "Question Number": "", "Incident Duration": "" },
    ];
    const res = parseIncidentRows(rows, mapping, codes);
    expect(res.rows[0]!.status).toBe("ok"); // ROOM_DISRUPT is fixed
  });

  it("honours a reconfigured mapping (different headers) with no code change", () => {
    const alt: IncidentColumnMapping = {
      studentId: "sid", studentName: "name", incidentType: "type", questionNumber: "q", duration: "dur",
    };
    const rows = [{ sid: "eve@x.io", name: "Eve", type: "calculator broke", q: "Q1", dur: "20" }];
    const res = parseIncidentRows(rows, alt, codes);
    expect(res.rows[0]!.status).toBe("ok");
    expect(res.rows[0]!.rawStudentId).toBe("eve@x.io");
    expect(res.rows[0]!.durationMinutes).toBe(20);
  });

  it("counts every input row exactly once across the three buckets", () => {
    const rows = [
      { "Student ID": "a@x.io", "Student Name": "A", "Incident Type": "calculator broke", "Question Number": "", "Incident Duration": "10" }, // ok
      { "Student ID": "b@x.io", "Student Name": "B", "Incident Type": "meteor strike", "Question Number": "", "Incident Duration": "" }, // unclassified
      { "Student ID": "", "Student Name": "", "Incident Type": "calculator broke", "Question Number": "", "Incident Duration": "5" }, // error
    ];
    const res = parseIncidentRows(rows, mapping, codes);
    expect(res.counts.total).toBe(3);
    expect(res.counts.ok + res.counts.unclassified + res.counts.error).toBe(3);
  });
});

describe("resolveParticipants — keyed on P-A internal id", () => {
  const roster = [
    { internalId: "amy@x.io", name: "Amy Adams" },
    { internalId: "bob@x.io", name: "Bob Brown" },
    { internalId: "fatima1@x.io", name: "Fatima" },
    { internalId: "fatima2@x.io", name: "Fatima" }, // duplicate name → ambiguous
  ];

  it("matches the file Student ID against the internal id (case-insensitive)", () => {
    const parsed = parseIncidentRows(
      [{ "Student ID": "AMY@X.IO", "Student Name": "someone else", "Incident Type": "calculator broke", "Question Number": "", "Incident Duration": "10" }],
      mapping,
      codes,
    ).rows;
    const [r] = resolveParticipants(parsed, roster);
    expect(r!.participantInternalId).toBe("amy@x.io");
    expect(r!.matched).toBe(true);
  });

  it("falls back to an exact unique name, but not an ambiguous one", () => {
    const parsed = parseIncidentRows(
      [
        { "Student ID": "nomatch", "Student Name": "Bob Brown", "Incident Type": "fire alarm", "Question Number": "", "Incident Duration": "" },
        { "Student ID": "nomatch2", "Student Name": "Fatima", "Incident Type": "fire alarm", "Question Number": "", "Incident Duration": "" },
      ],
      mapping,
      codes,
    ).rows;
    const resolved = resolveParticipants(parsed, roster);
    expect(resolved[0]!.participantInternalId).toBe("bob@x.io"); // unique name
    expect(resolved[1]!.participantInternalId).toBeNull(); // ambiguous → unmatched, surfaced
  });

  it("keeps an unmatched row (matched=false), never drops it", () => {
    const parsed = parseIncidentRows(
      [{ "Student ID": "ghost@x.io", "Student Name": "Ghost", "Incident Type": "fire alarm", "Question Number": "", "Incident Duration": "" }],
      mapping,
      codes,
    ).rows;
    const [r] = resolveParticipants(parsed, roster);
    expect(r!.matched).toBe(false);
    expect(r!.participantInternalId).toBeNull();
  });
});
