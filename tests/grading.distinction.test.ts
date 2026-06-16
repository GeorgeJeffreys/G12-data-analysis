/**
 * Integration tests for the award rule + D3 cap through the real provider — the
 * end-to-end proof that the engine logic (tests/engine.award.test.ts) is wired
 * into getGrades and the distinction safeguard over the genuine seeded cohort.
 *
 * The honest cohort tops out well below the Outstanding cut, so we lower the
 * per-subject performance cut-scores to bring real candidates into the
 * Distinction level-pattern — then the genuine, score-based D3 cap still applies.
 * Nothing is fabricated: D3 correctness comes from the seeded responses.
 */

import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

const CYCLE = "may-2026";

/** Drop every subject's performance cut-scores so most of the cohort reaches the
 *  Distinction level-pattern (★★★ in ≥3, rest ≥★). */
function lowerAllCuts(p: InMemoryDataProvider) {
  for (const a of p.getGrades(CYCLE)!.assessments) {
    p.setBoundary(CYCLE, a.id, { cuts: [5, 3, 1] });
  }
}

describe("award rule wired through the provider", () => {
  it("the award rule is no longer the unconfirmed placeholder", () => {
    const p = new InMemoryDataProvider();
    expect(p.getGradingDefaults().awardRuleUnconfirmed).toBe(false);
  });

  it("derives the award from subject levels, not a cut on the overall score", () => {
    const p = new InMemoryDataProvider();
    lowerAllCuts(p);
    const grades = p.getGrades(CYCLE)!;
    const distinction = grades.awardLevels[0]!;
    const advanced = grades.awardLevels[1]!;
    // Inflating levels lifts the cohort into ★★-or-better territory → Advanced,
    // even though overall percentages are unchanged and modest.
    const advCount = grades.distribution.find((d) => d.level === advanced)!.count;
    expect(advCount).toBeGreaterThan(0);
    // And no Distinction is handed out for free: the D3 cap gates it (below).
    void distinction;
  });

  it("the D3 cap denies Distinction with visible reasoning on the grade row", () => {
    const p = new InMemoryDataProvider();
    lowerAllCuts(p);
    const grades = p.getGrades(CYCLE)!;
    const distinction = grades.awardLevels[0]!;
    const advanced = grades.awardLevels[1]!;

    const capped = grades.rows.filter((r) => r.distinctionCap);
    expect(capped.length).toBeGreaterThan(0);
    for (const r of capped) {
      // capped students fell through from Distinction → not Distinction
      expect(r.award).not.toBe(distinction);
      expect(r.award).toBe(advanced);
      // the working: correct < majority, available is real
      expect(r.distinctionCap!.available).toBeGreaterThan(0);
      expect(r.distinctionCap!.correct).toBeLessThan(r.distinctionCap!.majority);
      // majority is strictly more than half of available
      expect(r.distinctionCap!.majority).toBe(Math.floor(r.distinctionCap!.available / 2) + 1);
    }
  });

  it("the safeguard surfaces correct-of-available, the dynamic majority, and a cap reason", () => {
    const p = new InMemoryDataProvider();
    lowerAllCuts(p);
    const sg = p.getDistinctionSafeguard(CYCLE)!;
    expect(sg.counts.inLine).toBeGreaterThan(0);
    expect(sg.counts.capped).toBeGreaterThan(0);
    // dynamic majority of the available pool on the scope
    expect(sg.threshold).toBe(Math.floor(sg.topDifficultyPool / 2) + 1);
    const cappedCand = sg.candidates.find((c) => c.result === "capped")!;
    expect(cappedCand.meets).toBe(false);
    expect(cappedCand.topDifficultyCorrect).toBeLessThan(cappedCand.majority);
    expect(cappedCand.capReason).toMatch(/majority is/i);
    // the note documents the corrected metric (correct, not attempted)
    expect(sg.attemptedNote.toLowerCase()).toContain("correctly");
  });

  it("a Lead override restores Distinction through getGrades (level pattern + D3 pass)", () => {
    const p = new InMemoryDataProvider();
    lowerAllCuts(p);
    const distinction = p.getGrades(CYCLE)!.awardLevels[0]!;
    const cappedId = p.getGrades(CYCLE)!.rows.find((r) => r.distinctionCap)!.id;

    p.overrideDistinctionCap(CYCLE, cappedId, "Reviewed — technical fault on D3 items");
    const after = p.getGrades(CYCLE)!.rows.find((r) => r.id === cappedId)!;
    expect(after.award).toBe(distinction);
    expect(after.distinctionCap ?? null).toBeNull();
  });
});
