/**
 * Incident-log triage → alterations (Part 3). Incidents are queued, never
 * auto-applied; a human decision becomes an alteration (+/− raw marks) that feeds
 * the subject total. "All students in a subject" applies in bulk.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import seedJson from "@/lib/data/seed.generated.json";

const seed = seedJson as unknown as {
  liveCycle: { id: string; participants: { id: string; label: string }[]; assessments: { id: string; name: string }[] };
};
const CYCLE = seed.liveCycle.id;
const math = seed.liveCycle.assessments.find((a) => /applicable math/i.test(a.name))!;

describe("incident triage", () => {
  it("queues incidents without auto-applying; exam code defaults the subject", () => {
    const p = new InMemoryDataProvider();
    p.uploadIncidentLog(CYCLE, "log.xlsx", [
      { source: "incident_log", studentName: seed.liveCycle.participants[0]!.label, exam: "AM", issueType: "Frozen tool", actionTaken: "Extra time", questionsAffected: "Q1" },
    ]);
    const adj = p.getAdjustments(CYCLE)!;
    expect(adj.counts.incidents).toBe(1);
    expect(adj.counts.awaiting).toBe(1);
    expect(adj.counts.alterations).toBe(0); // nothing applied until decided
    const inc = adj.incidents[0]!;
    expect(inc.applyTo).toBeNull();
    expect(inc.subjectId).toBe(math.id); // AM → Applicable Math defaulted
    expect(inc.suggestedStudentId).toBe(seed.liveCycle.participants[0]!.id);
  });

  it("a per-student decision adds raw marks to that student's subject total", () => {
    const p = new InMemoryDataProvider();
    const sid = seed.liveCycle.participants[0]!.id;
    const before = p.getBoundaries(CYCLE, math.id)!.stats.mean;
    p.uploadIncidentLog(CYCLE, "log.xlsx", [
      { source: "incident_log", studentName: "ambiguous", exam: "AM", issueType: "x", actionTaken: "y" },
    ]);
    const inc = p.getAdjustments(CYCLE)!.incidents[0]!;
    p.decideIncident(CYCLE, inc.id, { applyTo: "student", studentId: sid, subjectId: math.id, marks: 5, reason: "Lost time on a frozen item" });

    const adj = p.getAdjustments(CYCLE)!;
    expect(adj.counts.decided).toBe(1);
    expect(adj.counts.alterations).toBe(1);
    expect(adj.netBySubject[math.id]).toBe(5);
    // the cohort mean moves because one student's Maths total rose
    expect(p.getBoundaries(CYCLE, math.id)!.stats.mean).not.toBe(before);
  });

  it("'all students in a subject' applies in bulk", () => {
    const p = new InMemoryDataProvider();
    p.uploadIncidentLog(CYCLE, "log.xlsx", [
      { source: "incident_log", studentName: "All students", exam: "AM", issueType: "Projector flicker", actionTaken: "Paused" },
    ]);
    const inc = p.getAdjustments(CYCLE)!.incidents[0]!;
    p.decideIncident(CYCLE, inc.id, { applyTo: "subject", subjectId: math.id, marks: 2, reason: "Whole-room disruption" });

    const adj = p.getAdjustments(CYCLE)!;
    const n = seed.liveCycle.participants.length;
    expect(adj.counts.alterations).toBe(n); // one per roster student
    expect(adj.netBySubject[math.id]).toBe(2 * n);
  });

  it("'no action' records the decision but applies nothing", () => {
    const p = new InMemoryDataProvider();
    p.uploadIncidentLog(CYCLE, "log.xlsx", [
      { source: "complaint", studentName: "someone", description: "Felt rushed" },
    ]);
    const inc = p.getAdjustments(CYCLE)!.incidents[0]!;
    p.decideIncident(CYCLE, inc.id, { applyTo: "none", reason: "Informational only" });
    const adj = p.getAdjustments(CYCLE)!;
    expect(adj.counts.decided).toBe(1);
    expect(adj.counts.alterations).toBe(0);
  });
});
