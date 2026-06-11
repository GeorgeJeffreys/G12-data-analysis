/**
 * Speededness & timing diagnostics (Part 5) — pinned against hand-computed
 * values so the in-app numbers match the team's notebook definitions.
 */
import { describe, it, expect } from "vitest";
import {
  speededness,
  timingPerformance,
  lateItemIds,
  pearson,
  spearman,
  correlationStrength,
  type DiagResponse,
} from "@/lib/diagnostics";

function r(participantId: string, itemId: string, order: number, answered: boolean, correct: boolean, responseTime: number | null): DiagResponse {
  return { participantId, itemId, majorElement: null, order, answered, correct, responseTime };
}

describe("late-item selection", () => {
  it("takes the final 25% of unique items by earliest order (ceil, min 1)", () => {
    // 4 items → ceil(0.25*4)=1 late item (the last by order)
    const recs = [r("a", "Q1", 0, true, true, 10), r("a", "Q2", 1, true, true, 10), r("a", "Q3", 2, true, true, 10), r("a", "Q4", 3, true, true, 10)];
    expect([...lateItemIds(recs)]).toEqual(["Q4"]);
    // 1 item → min 1 late item
    expect([...lateItemIds([r("a", "Q1", 0, true, true, 5)])]).toEqual(["Q1"]);
  });
});

describe("speededness index", () => {
  it("is 0 when omission and accuracy are flat across early/late", () => {
    // 4 items, 2 students, everyone answers all correctly → no omission, no accuracy drop
    const recs: DiagResponse[] = [];
    for (const p of ["s1", "s2"]) for (let q = 1; q <= 4; q++) recs.push(r(p, `Q${q}`, q - 1, true, true, 20));
    const res = speededness(recs);
    expect(res.omissionRate).toBe(0);
    expect(res.completion).toBe(1);
    expect(res.speedednessIndex).toBe(0);
    expect(res.speededStatus).toBe("Good");
    expect(res.completionStatus).toBe("Good");
  });

  it("captures late omission + a late accuracy drop", () => {
    // 4 items (Q4 is the late quarter). Early (Q1-3): all answered & correct.
    // Late (Q4): both students omit it → lateOmission 1, earlyOmission 0.
    // earlyAccuracy = 1 (all early attempts correct); lateAccuracy = 0 (no late
    // attempts → accuracy 0). Index = (max(0,1-0) + max(0,1-0))/2 = 1.
    const recs: DiagResponse[] = [];
    for (const p of ["s1", "s2"]) {
      for (let q = 1; q <= 3; q++) recs.push(r(p, `Q${q}`, q - 1, true, true, 20));
      recs.push(r(p, "Q4", 3, false, false, null)); // omitted late item
    }
    const res = speededness(recs);
    expect(res.earlyOmission).toBe(0);
    expect(res.lateOmission).toBe(1);
    expect(res.earlyAccuracy).toBe(1);
    expect(res.lateAccuracy).toBe(0);
    expect(res.speedednessIndex).toBe(1);
    expect(res.speededStatus).toBe("Flag");
    // 2 students × 1 omitted of 4 items = 8 presentations, 2 omitted → 0.25
    expect(res.omissionRate).toBe(0.25);
    expect(res.omissionStatus).toBe("Flag");
  });
});

describe("correlations", () => {
  it("pearson is exact on a perfect positive line", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });
  it("spearman handles ties via average ranks", () => {
    expect(spearman([1, 2, 2, 3], [1, 2, 2, 3])).toBeCloseTo(1, 10);
  });
  it("labels correlation strength with direction", () => {
    expect(correlationStrength(0.62)).toBe("Strong positive");
    expect(correlationStrength(-0.2)).toBe("Weak negative");
    expect(correlationStrength(0.02)).toBe("Negligible");
    expect(correlationStrength(null)).toBe("Undefined");
  });

  it("timing–performance correlates student median time with score %", () => {
    // 3 students, 2 items each. Slower students score higher → positive corr.
    const recs: DiagResponse[] = [
      r("s1", "Q1", 0, true, false, 10), r("s1", "Q2", 1, true, false, 10), // 0% , med 10
      r("s2", "Q1", 0, true, true, 20), r("s2", "Q2", 1, true, false, 20), // 50%, med 20
      r("s3", "Q1", 0, true, true, 30), r("s3", "Q2", 1, true, true, 30), // 100%, med 30
    ];
    const res = timingPerformance(recs);
    expect(res.nStudents).toBe(3);
    expect(res.pearson).toBeCloseTo(1, 4);
    expect(res.spearman).toBeCloseTo(1, 4);
    expect(res.pearsonStrength).toBe("Very strong positive");
  });
});
