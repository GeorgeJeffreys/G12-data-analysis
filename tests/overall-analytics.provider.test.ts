/**
 * Provider integration for getOverallAnalytics — the in-memory provider wires the
 * live cell (real May + demo February baseline) plus clearly-labelled synthetic
 * cells into computeOverallAnalytics, honestly reporting `hasComparison`.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

function fresh() {
  return new InMemoryDataProvider();
}

describe("getOverallAnalytics — in-memory provider", () => {
  it("returns a well-formed read-model with the four vocabularies", () => {
    const oa = fresh().getOverallAnalytics();
    expect(oa.awards).toHaveLength(4);
    expect(oa.awards.map((a) => a.key)).toEqual(["dist", "adv", "sec", "rol"]);
    // "No Award" is exposed as "Record of Learning".
    expect(oa.awards[3]!.name).toBe("Record of Learning");
    expect(oa.plevels).toHaveLength(4);
    expect(oa.plevels.map((p) => p.key)).toEqual(["out", "exc", "meet", "not"]);
    expect(oa.subjects.length).toBeGreaterThan(0);
  });

  it("includes the live year + centre and synthetic priors, honest hasComparison", () => {
    const oa = fresh().getOverallAnalytics();
    expect(oa.years.length).toBeGreaterThanOrEqual(1);
    expect(oa.years).toEqual([...oa.years].sort((a, b) => a - b)); // ascending
    expect(oa.centres.length).toBeGreaterThanOrEqual(1);
    // Only one real year exists in the in-memory seed → comparison is not real.
    expect(oa.hasComparison).toBe(false);
  });

  it("participation and award distribution are populated for the latest year", () => {
    const oa = fresh().getOverallAnalytics();
    const latest = oa.years[oa.years.length - 1]!;
    const part = oa.participation[latest]!;
    expect(part.centres).toBeGreaterThanOrEqual(1);
    expect(part.satMay).toBeGreaterThan(0);
    expect(part.passComb).toBeGreaterThanOrEqual(0);
    expect(part.passComb).toBeLessThanOrEqual(100);

    const dist = oa.awardDist[latest]!;
    const total = dist.dist + dist.adv + dist.sec + dist.rol;
    // Percentages over a non-empty cohort sum to ~100 (rounding tolerance).
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });

  it("exposes per-subject performance with best-of-two levels and Feb→May change", () => {
    const oa = fresh().getOverallAnalytics();
    const latest = oa.years[oa.years.length - 1]!;
    const key = oa.subjects[0]!.key;
    const sy = oa.perf[key]?.[latest];
    expect(sy).toBeTruthy();
    const levelTotal = sy!.levels.out + sy!.levels.exc + sy!.levels.meet + sy!.levels.not;
    expect(levelTotal).toBeGreaterThan(99);
    expect(levelTotal).toBeLessThan(101);
    // The live cell has both a (demo) February and a real May sitting.
    expect(sy!.change).not.toBeNull();
    expect(sy!.feb).not.toBeNull();
    expect(sy!.may).not.toBeNull();
  });

  it("does not disturb the existing Compare cycles read-model", () => {
    const p = fresh();
    const before = p.getAnalyticsCompare();
    p.getOverallAnalytics();
    expect(p.getAnalyticsCompare()).toEqual(before);
  });
});
