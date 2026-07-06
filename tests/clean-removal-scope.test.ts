/**
 * Bug 1 — per-subject vs cohort removal scope.
 *
 * Removing a participant from ONE subject's view must remove only that sitting
 * ((participant, subject)), leaving their other subjects intact. A separate,
 * explicit action removes them from the WHOLE cohort (every subject). The two
 * scopes must be distinguishable in the cleaning model (`subjectExcludedRows` vs
 * `cohortExcludedRows`), reflected in the counts, and reversible in their own scope.
 *
 * This is the "strike Afraa from Applicable Math" case: she must vanish from Math
 * only, still present in her other subjects; a distinct "remove from all subjects"
 * removes her everywhere.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

function setup() {
  const p = new InMemoryDataProvider();
  const cycleId = p.listCycles()[0]!.id;
  const cyc = p.getCycle(cycleId)!;
  // A participant who sits (and is scored in) at least two subjects.
  const present = cyc.assessments.map((a) => ({ id: a.id, ids: new Set(p.getNaiveScores(cycleId, a.id)!.students.map((s) => s.id)) }));
  const sharer = [...present[0]!.ids].find((id) => present.filter((x) => x.ids.has(id)).length >= 2)!;
  const subs = present.filter((x) => x.ids.has(sharer)).map((x) => x.id);
  return { p, cycleId, cyc, victim: sharer, subjectA: subs[0]!, subjectB: subs[1]! };
}

describe("per-subject removal scope (Bug 1)", () => {
  it("removes the sitting from ONE subject only, leaving the other subjects intact", () => {
    const { p, cycleId, cyc, victim, subjectA, subjectB } = setup();
    const naiveABefore = p.getNaiveScores(cycleId, subjectA)!.students.length;
    const naiveBBefore = p.getNaiveScores(cycleId, subjectB)!.students.length;

    // Strike the participant from subject A only (the default "Remove from <subject>").
    p.setCleanRemoval(cycleId, subjectA, { rows: [victim] }, true);

    // Gone from subject A's scored cohort, still present in subject B.
    expect(p.getNaiveScores(cycleId, subjectA)!.students.some((s) => s.id === victim)).toBe(false);
    expect(p.getNaiveScores(cycleId, subjectA)!.students.length).toBe(naiveABefore - 1);
    expect(p.getNaiveScores(cycleId, subjectB)!.students.some((s) => s.id === victim)).toBe(true);
    expect(p.getNaiveScores(cycleId, subjectB)!.students.length).toBe(naiveBBefore);

    // Still in the cohort headline (present in ≥1 subject) — NOT a cohort removal.
    expect(p.getCycle(cycleId)!.participants).toBe(cyc.participants);
    // Still graded (from their remaining subject).
    expect(p.getGrades(cycleId)!.rows.some((r) => r.id === victim)).toBe(true);
  });

  it("marks the struck row per-subject in the cleaning model, scoped to that subject", () => {
    const { p, cycleId, victim, subjectA, subjectB } = setup();
    p.setCleanRemoval(cycleId, subjectA, { rows: [victim] }, true);

    const cleanA = p.getDataCleaning(cycleId, subjectA)!;
    expect(cleanA.excludedRows).toContain(victim); // struck here
    expect(cleanA.subjectExcludedRows).toContain(victim); // per-subject scope
    expect(cleanA.cohortExcludedRows).not.toContain(victim); // not cohort-wide
    expect(cleanA.rows.some((r) => r.id === victim)).toBe(true); // still visible

    const cleanB = p.getDataCleaning(cycleId, subjectB)!;
    expect(cleanB.excludedRows).not.toContain(victim); // untouched in the other subject
  });

  it("the per-subject removal is reversible in its own scope", () => {
    const { p, cycleId, victim, subjectA } = setup();
    const n0 = p.getNaiveScores(cycleId, subjectA)!.students.length;
    p.setCleanRemoval(cycleId, subjectA, { rows: [victim] }, true);
    expect(p.getNaiveScores(cycleId, subjectA)!.students.length).toBe(n0 - 1);
    p.setCleanRemoval(cycleId, subjectA, { rows: [victim] }, false); // restore
    expect(p.getNaiveScores(cycleId, subjectA)!.students.some((s) => s.id === victim)).toBe(true);
    expect(p.getNaiveScores(cycleId, subjectA)!.students.length).toBe(n0);
  });
});

describe("cohort removal scope (Bug 1)", () => {
  it("a distinct cohort action removes the participant from EVERY subject + the headline", () => {
    const { p, cycleId, cyc, victim, subjectA, subjectB } = setup();

    p.excludeParticipantFromCohort(cycleId, victim, true, "Remove from all subjects");

    expect(p.getNaiveScores(cycleId, subjectA)!.students.some((s) => s.id === victim)).toBe(false);
    expect(p.getNaiveScores(cycleId, subjectB)!.students.some((s) => s.id === victim)).toBe(false);
    expect(p.getGrades(cycleId)!.rows.some((r) => r.id === victim)).toBe(false);
    expect(p.getCycle(cycleId)!.participants).toBe(cyc.participants - 1);

    // The cleaning model marks it cohort-wide in every subject the participant sat.
    for (const s of [subjectA, subjectB]) {
      const clean = p.getDataCleaning(cycleId, s)!;
      expect(clean.cohortExcludedRows).toContain(victim);
      expect(clean.subjectExcludedRows).not.toContain(victim);
    }
  });

  it("the cohort removal is reversible", () => {
    const { p, cycleId, cyc, victim } = setup();
    p.excludeParticipantFromCohort(cycleId, victim, true, "staff");
    expect(p.getCycle(cycleId)!.participants).toBe(cyc.participants - 1);
    p.excludeParticipantFromCohort(cycleId, victim, false);
    expect(p.getCycle(cycleId)!.participants).toBe(cyc.participants);
    expect(p.getGrades(cycleId)!.rows.some((r) => r.id === victim)).toBe(true);
  });
});
