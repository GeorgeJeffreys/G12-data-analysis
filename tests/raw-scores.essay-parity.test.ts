/**
 * Phase C — Raw Scores = cleaned MCQ + essay marks, pinned to the engine's truth.
 *
 * Raw Scores (`getNaiveScores`) must numerically equal the final Score
 * (`getComposition`, which scores via `pctByParticipant`) MINUS the item-review
 * deletion step. Both run the same engine `computeScores`:
 *   Score = f(cleaned, excludedItemIds)   Raw = f(cleaned, [])
 * The live seed carries no item-review deletions and no alterations, so on this
 * cohort the identity holds exactly for every participant × subject — and, for
 * ESL/Arabic, that identity is the drift backstop that pins Raw's half-weighted
 * essay handling (ESSAY_MAX_RESERVED, join, rounding) to the engine, not to a
 * re-implementation in the Raw view.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { ESSAY_MAX_RESERVED } from "@/lib/data/essays";

function setup() {
  const p = new InMemoryDataProvider();
  const cycleId = p.listCycles()[0]!.id;
  return { p, cycleId };
}

describe("Raw Scores ≡ final Score on a zero-deletion cohort (Phase C)", () => {
  it("has no item-review deletions or alterations in the live seed (the identity's premise)", () => {
    const { p, cycleId } = setup();
    const comp = p.getComposition(cycleId)!;
    expect(comp).toBeTruthy();
    for (const a of p.getCycle(cycleId)!.assessments) {
      // No reviewed-item exclusions anywhere in the default cohort.
      expect(p.getNaiveScores(cycleId, a.id)!.assessment.excludedCount).toBe(0);
    }
    // No manual alterations folded into any subject total.
    for (const s of comp.students) for (const sub of s.subjects) expect(sub.alterations).toBe(0);
  });

  it("Raw raw/pct/max equals the final Score for every participant and subject", () => {
    const { p, cycleId } = setup();
    const comp = p.getComposition(cycleId)!;

    // Score read-model: participantId → assessmentId → { total, pct, max }.
    const score = new Map<string, Map<string, { total: number; pct: number; max: number }>>();
    for (const s of comp.students) {
      const byA = new Map<string, { total: number; pct: number; max: number }>();
      for (const sub of s.subjects) byA.set(sub.assessmentId, { total: sub.total, pct: sub.pct, max: sub.max });
      score.set(s.participantId, byA);
    }

    let compared = 0;
    for (const a of p.getCycle(cycleId)!.assessments) {
      const naive = p.getNaiveScores(cycleId, a.id)!;
      for (const row of naive.students) {
        const sc = score.get(row.id)?.get(a.id);
        // Every scored Raw row must have a matching final Score cell (same cohort).
        expect(sc, `no Score cell for ${row.name} on ${a.name}`).toBeTruthy();
        expect(row.raw).toBe(sc!.total);
        expect(row.pct).toBe(sc!.pct);
        expect(row.max).toBe(sc!.max);
        compared += 1;
      }
    }
    // Guard against a vacuous pass (e.g. an empty cohort silently comparing nothing).
    expect(compared).toBeGreaterThan(0);
  });

  it("folds the half-weighted essay into the Raw total for ESL/Arabic subjects", () => {
    const { p, cycleId } = setup();
    const essaySubjects = p.getCycle(cycleId)!.assessments.filter((a) => p.getNaiveScores(cycleId, a.id)!.hasEssay);
    expect(essaySubjects.length).toBeGreaterThan(0); // ESL + Arabic exist in the seed

    for (const a of essaySubjects) {
      const naive = p.getNaiveScores(cycleId, a.id)!;
      // The reserved essay max is part of the subject denominator now (not MCQ-only).
      expect(naive.subjectMax).toBeGreaterThanOrEqual(ESSAY_MAX_RESERVED);
      expect(naive.subjectMax).toBeGreaterThan(naive.mcqItems);
    }
  });
});
