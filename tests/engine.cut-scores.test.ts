/**
 * Wave 3b — suggested cut-scores: backsolve + guard-rails + ½-D3 sanity check.
 *
 * The backsolver consumes a per-subject score distribution and target band
 * proportions and produces suggested cut-points. These tests pin the hard
 * numerical behaviour: nearest-achievable snapping at small cohort sizes, the
 * 25%/90% guard-rails (with clamp reporting), the stated tie rule, and the
 * cohort-level ½-D3 warning. None of this touches item statistics or raw scores
 * — engine parity is unaffected.
 */

import { describe, it, expect } from "vitest";
import {
  backsolveCuts,
  checkOutstandingHalfD3,
  POLICY_GUARDRAILS,
  DEFAULT_POLICY_TARGETS,
} from "@/lib/engine/cut-scores";

/** Build a flat-ish spread of percent scores from explicit (score,count) pairs. */
function spread(pairs: [number, number][]): number[] {
  const out: number[] = [];
  for (const [score, count] of pairs) for (let k = 0; k < count; k++) out.push(score);
  return out;
}

describe("backsolveCuts — nearest achievable band sizes", () => {
  it("hits the exact band sizes for a clean, well-separated distribution", () => {
    // 100 students, evenly placed so targets land on whole students cleanly.
    // Scores chosen so each target band maps onto a distinct cut with no ties.
    const scores: number[] = [];
    for (let i = 0; i < 10; i++) scores.push(95); // top 10 → Outstanding
    for (let i = 0; i < 20; i++) scores.push(80); // next 20 → Exceeds
    for (let i = 0; i < 50; i++) scores.push(60); // next 50 → Meets
    for (let i = 0; i < 20; i++) scores.push(40); // bottom 20 → remainder
    const res = backsolveCuts(scores, [10, 20, 50]);
    expect(res.n).toBe(100);
    // Achieved band sizes match the targets exactly here.
    expect(res.bandCountAchieved).toEqual([10, 20, 50, 20]);
    expect(res.bandPctAchieved.map((p) => Math.round(p))).toEqual([10, 20, 50, 20]);
    // Cuts are descending.
    expect(res.cuts[0]).toBeGreaterThan(res.cuts[1]!);
    expect(res.cuts[1]).toBeGreaterThan(res.cuts[2]!);
  });

  it("snaps to whole students and reports the honest target-vs-achieved gap at n≈18", () => {
    // 18 students — 15% of 18 = 2.7, impossible exactly.
    const scores = spread([
      [92, 3],
      [78, 4],
      [60, 8],
      [40, 3],
    ]);
    expect(scores.length).toBe(18);
    const res = backsolveCuts(scores, [15, 25, 45]);
    // Every achieved band is a whole-student count.
    for (const c of res.bandCountAchieved) expect(Number.isInteger(c)).toBe(true);
    // Total students conserved.
    expect(res.bandCountAchieved.reduce((a, b) => a + b, 0)).toBe(18);
    // Outstanding target 15% (=2.7) → nearest achievable is 3 students (16.7%).
    const top = res.perCut[0]!;
    expect(top.targetPct).toBe(15);
    expect(top.achievedCount).toBe(3);
    expect(Math.round(top.achievedPct)).toBe(17);
    // The achieved % differs from target — the gap is real and surfaced.
    expect(top.achievedPct).not.toBe(top.targetPct);
  });
});

describe("backsolveCuts — guard-rails (clamp + report)", () => {
  it("raises a sub-floor cut to 25% and records the move", () => {
    // A distribution where the Meets target would place its cut very low.
    const scores = spread([
      [95, 2],
      [85, 2],
      [20, 14], // a big clump at 20% → Meets cut wants to sit ~20%, below the 25% floor
    ]);
    const res = backsolveCuts(scores, [10, 10, 70]);
    const meets = res.perCut[2]!;
    // Final cut respects the floor.
    expect(meets.cut).toBeGreaterThanOrEqual(POLICY_GUARDRAILS.floorPct);
    // And the clamp is reported with the original distribution value.
    if (meets.distributionCut < POLICY_GUARDRAILS.floorPct) {
      expect(meets.clamp).not.toBeNull();
      expect(meets.clamp!.bound).toBe("floor");
      expect(meets.clamp!.to).toBe(POLICY_GUARDRAILS.floorPct);
      expect(meets.clamp!.from).toBe(meets.distributionCut);
    }
  });

  it("lowers an above-ceiling cut to 90% and records the move", () => {
    // Everyone scores very high → Outstanding cut wants to sit above 90%.
    const scores = spread([
      [99, 5],
      [97, 5],
      [95, 8],
    ]);
    const res = backsolveCuts(scores, [20, 30, 40]);
    const top = res.perCut[0]!;
    expect(top.cut).toBeLessThanOrEqual(POLICY_GUARDRAILS.ceilingPct);
    if (top.distributionCut > POLICY_GUARDRAILS.ceilingPct) {
      expect(top.clamp).not.toBeNull();
      expect(top.clamp!.bound).toBe("ceiling");
      expect(top.clamp!.to).toBe(POLICY_GUARDRAILS.ceilingPct);
    }
  });

  it("never suggests a cut outside [25, 90]", () => {
    const scores = spread([
      [100, 4],
      [50, 6],
      [5, 8],
    ]);
    const res = backsolveCuts(scores, [20, 30, 40]);
    for (const c of res.cuts) {
      expect(c).toBeGreaterThanOrEqual(POLICY_GUARDRAILS.floorPct);
      expect(c).toBeLessThanOrEqual(POLICY_GUARDRAILS.ceilingPct);
    }
  });
});

describe("backsolveCuts — ties", () => {
  it("keeps a shared-score clump together and flags the forced band size", () => {
    // 10 students all on the same boundary score → a cut can't split them.
    const scores = spread([
      [70, 10], // big clump
      [40, 10],
    ]);
    // Target wants ~3 in the top band, but the 10-clump at 70 forces all-or-nothing.
    const res = backsolveCuts(scores, [15, 15, 50]);
    const flagged = res.perCut.some((c) => c.tie && c.tie.count >= 2);
    expect(flagged).toBe(true);
    // The clump moves as a block: the top band is either 0 or 10, never 3.
    expect([0, 10]).toContain(res.bandCountAchieved[0]);
  });
});

describe("checkOutstandingHalfD3 — cohort sanity check", () => {
  it("is consistent when every Outstanding student cleared ≥ ½ of D3", () => {
    // 6 D3 items, half = 3. All three top students got ≥ 3 correct.
    const r = checkOutstandingHalfD3([6, 5, 4], 6);
    expect(r.halfThreshold).toBe(3);
    expect(r.belowHalf).toBe(0);
    expect(r.consistent).toBe(true);
  });

  it("warns when an Outstanding student cleared the cut without ≥ ½ of D3", () => {
    const r = checkOutstandingHalfD3([6, 2, 5], 6); // the middle student has only 2/6
    expect(r.belowHalf).toBe(1);
    expect(r.consistent).toBe(false);
    expect(r.note).toMatch(/CONFIRM/);
  });

  it("is not applicable when the subject has no D3 items", () => {
    const r = checkOutstandingHalfD3([], 0);
    expect(r.consistent).toBe(true);
    expect(r.note).toMatch(/not applicable/i);
  });
});

describe("policy defaults", () => {
  it("default targets are the midpoints of the policy indicative ranges", () => {
    expect(DEFAULT_POLICY_TARGETS).toEqual([15, 20, 50]);
  });
  it("guard-rails are the policy 25% floor / 90% ceiling", () => {
    expect(POLICY_GUARDRAILS).toEqual({ floorPct: 25, ceilingPct: 90 });
  });
});
