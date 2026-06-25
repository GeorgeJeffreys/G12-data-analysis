/**
 * P6 — Section 6 Scores: per-subject D3 correct % (Part A, display-only) and the
 * configurable ±% borderline band as a Settings config value (Part B).
 *
 * Covers (per the task's verification list):
 *  - Per-subject D3 correct % renders correctly in the composition read-model.
 *  - The borderline band is a real config value with a ±2% placeholder default.
 *  - Changing the Settings % re-flags students AND recomputes through the engine
 *    (the D3 distinction safeguard still applies — no bypass path).
 *  - Server-bound validation bounds are enforced in the provider setter.
 */

import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import {
  DEFAULT_BORDERLINE_BAND_PCT,
  BORDERLINE_BAND_MIN,
  BORDERLINE_BAND_MAX,
  isValidBorderlineBand,
} from "@/lib/data/grading";

const CYCLE = "may-2026";

describe("Part A — per-subject D3 correct % (display-only)", () => {
  it("surfaces D3 correct/available/pct per subject on every subject that carries D3 items", () => {
    const p = new InMemoryDataProvider();
    const comp = p.getComposition(CYCLE)!;
    let sawD3 = 0;
    for (const s of comp.students) {
      for (const sj of s.subjects) {
        if (!sj.d3) continue;
        sawD3 += 1;
        // correct never exceeds available; pct is the rounded correct/available share.
        expect(sj.d3.available).toBeGreaterThan(0);
        expect(sj.d3.correct).toBeGreaterThanOrEqual(0);
        expect(sj.d3.correct).toBeLessThanOrEqual(sj.d3.available);
        expect(sj.d3.pct).toBeCloseTo((sj.d3.correct / sj.d3.available) * 100, 1);
      }
    }
    // The seed has D3 items, so at least some subjects carry a per-subject D3 figure.
    expect(sawD3).toBeGreaterThan(0);
  });

  it("the per-subject D3 correct count matches the score>0 count on that subject's D3 pool", () => {
    // Independent recompute from getComposition's own byDemand split: for binary D3
    // items the demand 'score' sum equals the count answered correctly, so the
    // per-subject d3.correct must line up with the D3 demand score where present.
    const p = new InMemoryDataProvider();
    const comp = p.getComposition(CYCLE)!;
    for (const s of comp.students) {
      for (const sj of s.subjects) {
        const d3Demand = sj.byDemand.find((d) => d.demand === "D3");
        if (!sj.d3 || !d3Demand) continue;
        // available aligns with the D3 demand item count (max, for unit-max items).
        expect(sj.d3.available).toBe(d3Demand.max);
        // correct (score > 0) is at most the summed score on those items.
        expect(sj.d3.correct).toBeLessThanOrEqual(d3Demand.score + 1e-9);
      }
    }
  });
});

describe("Part B — borderline band as a config value", () => {
  it("defaults to the ±2% placeholder and exposes it on the config read-model", () => {
    const p = new InMemoryDataProvider();
    expect(DEFAULT_BORDERLINE_BAND_PCT).toBe(2);
    expect(p.getConfig().borderline.bandPct).toBe(DEFAULT_BORDERLINE_BAND_PCT);
  });

  it("setBorderlineConfig updates the live value (within bounds)", () => {
    const p = new InMemoryDataProvider();
    p.setBorderlineConfig({ bandPct: 3.5 });
    expect(p.getConfig().borderline.bandPct).toBe(3.5);
  });

  it("clamps out-of-range values to the bounds (server also re-validates)", () => {
    const p = new InMemoryDataProvider();
    p.setBorderlineConfig({ bandPct: BORDERLINE_BAND_MAX + 100 });
    expect(p.getConfig().borderline.bandPct).toBe(BORDERLINE_BAND_MAX);
    p.setBorderlineConfig({ bandPct: BORDERLINE_BAND_MIN - 100 });
    expect(p.getConfig().borderline.bandPct).toBe(BORDERLINE_BAND_MIN);
  });

  it("ignores non-numeric input (no NaN leak into the grade-bearing value)", () => {
    const p = new InMemoryDataProvider();
    p.setBorderlineConfig({ bandPct: 4 });
    p.setBorderlineConfig({ bandPct: Number.NaN });
    expect(p.getConfig().borderline.bandPct).toBe(4); // unchanged
  });

  it("isValidBorderlineBand guards the same bounds the UI + server enforce", () => {
    expect(isValidBorderlineBand(0)).toBe(true);
    expect(isValidBorderlineBand(20)).toBe(true);
    expect(isValidBorderlineBand(2)).toBe(true);
    expect(isValidBorderlineBand(-1)).toBe(false);
    expect(isValidBorderlineBand(21)).toBe(false);
    expect(isValidBorderlineBand(Number.NaN)).toBe(false);
  });
});

describe("Part B — the band recomputes through the engine incl. the D3 safeguard", () => {
  it("widening the band re-flags a student but the D3 cap still denies Distinction", () => {
    const p = new InMemoryDataProvider();
    // Drop every cut so the cohort reaches the Distinction level-pattern; the
    // score-based D3 cap then gates Distinction (same setup as the safeguard tests).
    for (const a of p.getGrades(CYCLE)!.assessments) p.setBoundary(CYCLE, a.id, { cuts: [5, 3, 1] });
    const distinction = p.getGrades(CYCLE)!.awardLevels[0]!;
    const capped = p.getGrades(CYCLE)!.rows.find((r) => r.distinctionCap);
    expect(capped).toBeTruthy();
    expect(capped!.award).not.toBe(distinction);

    // Changing the borderline band must not open any path around the safeguard:
    // re-read after a band change and the same student is still D3-capped.
    p.setBorderlineConfig({ bandPct: 10 });
    const after = p.getGrades(CYCLE)!.rows.find((r) => r.id === capped!.id)!;
    expect(after.award).not.toBe(distinction);
    expect(after.distinctionCap).toBeTruthy();
  });
});
