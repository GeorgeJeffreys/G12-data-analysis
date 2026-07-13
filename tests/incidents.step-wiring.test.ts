/**
 * Critical-path Incident STEP ↔ config wiring (the fix for #14).
 *
 * Proves the step now CONSUMES the admin incident config end-to-end: a
 * real-file-shaped import (raw rows keyed by the configured column mapping) is
 * parsed + classified against the incident CODES, resolved to cohort participants,
 * and turned into a per-student review where the mark alteration is AUTO-COMPUTED
 * from each matched code's formula and CAPPED (per-code + per-student, add-only) —
 * not a blank manual form. Also proves the imported SOURCE is tracked (real vs
 * sample) and that clearing removes it. The base score is never touched.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { parseIncidentRows, resolveParticipants } from "@/lib/incidents/import";

function liveId(p: InMemoryDataProvider): string {
  return p.listCycles()[0]!.id;
}

// Import a real-file-shaped batch of raw rows (keyed by the configured mapping
// headers) through the exact page path: parse+classify against the config, resolve
// against the roster, then hand the resolved rows to the provider.
function importRawRows(p: InMemoryDataProvider, cycleId: string, raw: Record<string, unknown>[], fileName = "incident_log.xlsx") {
  const config = p.getIncidentConfig();
  const parsed = parseIncidentRows(raw, config.mapping, config.codes);
  const resolved = resolveParticipants(parsed.rows, p.getIncidentRoster(cycleId));
  p.importIncidentRows(cycleId, resolved, { fileName, sample: false });
  return parsed;
}

describe("incident step — config-driven import", () => {
  it("matches incidents to configured codes and auto-computes capped, add-only alterations", () => {
    const p = new InMemoryDataProvider();
    const id = liveId(p);
    const roster = p.getIncidentRoster(id);
    expect(roster.length).toBeGreaterThan(0);
    const stu = roster[0]!;

    // Two incidents for one student, keyed on the default column mapping:
    //  - "Fire alarm" → ROOM_DISRUPT, fixed +1
    //  - "Calculator broke" for 40 min → CALC_FAIL (+0.5/5min = +4) clamped to cap 3
    importRawRows(p, id, [
      { "Student ID": stu.internalId, "Student Name": stu.name, "Incident Type": "Fire alarm", "Question Number": "—", "Incident Duration": "" },
      { "Student ID": stu.internalId, "Student Name": stu.name, "Incident Type": "Calculator broke", "Question Number": "Q7", "Incident Duration": "40 min" },
    ]);

    const review = p.getIncidentReview(id)!;
    expect(review.counts.incidents).toBe(2);
    const row = review.students.find((s) => s.participantId === stu.internalId)!;
    expect(row).toBeTruthy();

    // Every contribution is matched to a configured code (nothing unclassified here).
    const codes = row.contributions.map((c) => c.code).sort();
    expect(codes).toEqual(["CALC_FAIL", "ROOM_DISRUPT"]);

    // Auto-computed + capped: fixed +1, per-duration +4 clamped to per-code cap 3.
    const calc = row.contributions.find((c) => c.code === "CALC_FAIL")!;
    expect(calc.rawMarks).toBeCloseTo(4, 6);
    expect(calc.marks).toBe(3);
    expect(calc.perCodeCapHit).toBe(true);

    // Cumulative per student: 1 + 3 = 4 (under the default global cap 5), add-only.
    expect(row.adjustment).toBe(4);
    expect(row.adjustment).toBeGreaterThanOrEqual(0);
    expect(row.adjusted).toBeCloseTo(row.base + row.adjustment, 6);
  });

  it("routes unmatched incident types to the unclassified bucket (zero, surfaced)", () => {
    const p = new InMemoryDataProvider();
    const id = liveId(p);
    const stu = p.getIncidentRoster(id)[0]!;
    importRawRows(p, id, [
      { "Student ID": stu.internalId, "Student Name": stu.name, "Incident Type": "Spilled water on desk", "Question Number": "Q1", "Incident Duration": "" },
    ]);
    const review = p.getIncidentReview(id)!;
    expect(review.counts.unclassified).toBe(1);
    const c = review.students.flatMap((s) => s.contributions).find((c) => c.incidentType === "Spilled water on desk")!;
    expect(c.code).toBeNull();
    expect(c.marks).toBe(0); // never silently applied
  });

  it("surfaces an incident row that matches no cohort participant (unmatched)", () => {
    const p = new InMemoryDataProvider();
    const id = liveId(p);
    importRawRows(p, id, [
      { "Student ID": "NOT-A-REAL-ID", "Student Name": "A. Nonymous", "Incident Type": "Fire alarm", "Question Number": "—", "Incident Duration": "" },
    ]);
    const review = p.getIncidentReview(id)!;
    expect(review.unmatched.length).toBe(1);
    expect(review.students.length).toBe(0);
  });

  it("tracks the imported source (real file) and clears it", () => {
    const p = new InMemoryDataProvider();
    const id = liveId(p);
    const stu = p.getIncidentRoster(id)[0]!;

    importRawRows(p, id, [
      { "Student ID": stu.internalId, "Student Name": stu.name, "Incident Type": "Fire alarm", "Question Number": "—", "Incident Duration": "" },
    ], "march_incidents.xlsx");
    let review = p.getIncidentReview(id)!;
    expect(review.source).toEqual({ fileName: "march_incidents.xlsx", sample: false });

    // Clearing removes the rows and the source.
    p.clearIncidentRows(id);
    review = p.getIncidentReview(id)!;
    expect(review.counts.incidents).toBe(0);
    expect(review.source).toBeNull();
  });

  it("does not touch base scores — they reconcile with the engine whether or not incidents are imported", () => {
    const p = new InMemoryDataProvider();
    const id = liveId(p);
    const baseBefore = p.getComposition(id)!.students.map((s) => ({ id: s.participantId, total: s.overall.total }));
    const stu = p.getIncidentRoster(id)[0]!;
    importRawRows(p, id, [
      { "Student ID": stu.internalId, "Student Name": stu.name, "Incident Type": "Fire alarm", "Question Number": "—", "Incident Duration": "" },
    ]);
    p.applyIncidentAdjustments(id);
    const baseAfter = p.getComposition(id)!.students.map((s) => ({ id: s.participantId, total: s.overall.total }));
    expect(baseAfter).toEqual(baseBefore);
  });
});
