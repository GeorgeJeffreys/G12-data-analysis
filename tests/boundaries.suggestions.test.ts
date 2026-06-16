/**
 * Wave 3b — boundary suggestions wired through the DataProvider.
 *
 * Exercises the real read/write model over the bundled seed: the backsolved
 * suggestion appears per subject, guard-rails are reported, re-suggest and
 * reset-to-suggestion round-trip, editing a cut live-updates the band %s, and
 * the ½-D3 warning is surfaced (never enforced). Consumes scores only — parity
 * is covered by engine.parity.test.ts and is unaffected.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { POLICY_GUARDRAILS } from "@/lib/engine/cut-scores";

function liveCycleId(p: InMemoryDataProvider): string {
  return p.listCycles()[0]!.id;
}
/** First per-subject (non-overall) scope. */
function subjectScope(p: InMemoryDataProvider, cycleId: string): string {
  const m = p.getBoundaries(cycleId, "overall")!;
  return m.scopes.find((s) => s.id !== "overall")!.id;
}

describe("getBoundaries — suggestion model", () => {
  let p: InMemoryDataProvider;
  let cycleId: string;
  let scope: string;
  beforeEach(() => {
    p = new InMemoryDataProvider();
    cycleId = liveCycleId(p);
    scope = subjectScope(p, cycleId);
  });

  it("exposes a backsolved suggestion with per-cut working and guard-rails", () => {
    const m = p.getBoundaries(cycleId, scope)!;
    expect(m.suggestion).toBeTruthy();
    expect(m.suggestion.cuts.length).toBe(m.levels.length - 1);
    expect(m.suggestion.perCut.length).toBe(m.levels.length - 1);
    // Guard-rails are the policy bounds for a per-subject scope.
    expect(m.guardrails).toEqual({
      floorPct: POLICY_GUARDRAILS.floorPct,
      ceilingPct: POLICY_GUARDRAILS.ceilingPct,
    });
    // Every suggested cut respects the policy bounds.
    for (const c of m.suggestion.cuts) {
      expect(c).toBeGreaterThanOrEqual(POLICY_GUARDRAILS.floorPct);
      expect(c).toBeLessThanOrEqual(POLICY_GUARDRAILS.ceilingPct);
    }
    // Per-cut working reports both target and achieved.
    for (const pc of m.suggestion.perCut) {
      expect(pc.targetPct).toBeGreaterThanOrEqual(0);
      expect(pc.achievedCount).toBeGreaterThanOrEqual(0);
    }
    // maxRaw is a positive subject total so the UI can render raw alongside %.
    expect(m.maxRaw).toBeGreaterThan(0);
  });

  it("the overall award scope is exempt from the per-subject guard-rails", () => {
    const m = p.getBoundaries(cycleId, "overall")!;
    expect(m.isAward).toBe(true);
    expect(m.guardrails).toEqual({ floorPct: 0, ceilingPct: 100 });
    expect(m.d3Warning.applicable).toBe(false);
  });
});

describe("suggest / reset round-trip", () => {
  let p: InMemoryDataProvider;
  let cycleId: string;
  let scope: string;
  beforeEach(() => {
    p = new InMemoryDataProvider();
    cycleId = liveCycleId(p);
    scope = subjectScope(p, cycleId);
  });

  it("suggest adopts the backsolve as editable cuts + snapshot", () => {
    const before = p.getBoundaries(cycleId, scope)!;
    p.setBoundary(cycleId, scope, { suggest: true });
    const after = p.getBoundaries(cycleId, scope)!;
    expect(after.mode).toBe("cuts");
    expect(after.suggestedCuts).toEqual(before.suggestion.cuts);
    expect(after.cuts).toEqual(before.suggestion.cuts);
  });

  it("editing a cut marks it edited and live-updates the band %s", () => {
    p.setBoundary(cycleId, scope, { suggest: true });
    const m0 = p.getBoundaries(cycleId, scope)!;
    const snapshot = m0.suggestedCuts!;
    // Move the top cut up by a clear margin (kept within bounds + ordering).
    const newTop = Math.min(POLICY_GUARDRAILS.ceilingPct, (snapshot[0] ?? 50) + 3);
    p.setBoundary(cycleId, scope, { cutIndex: 0, cutValue: newTop });
    const m1 = p.getBoundaries(cycleId, scope)!;
    // Snapshot is unchanged → the cut now differs from its suggestion (edited).
    expect(m1.suggestedCuts).toEqual(snapshot);
    expect(m1.cuts[0]).not.toBe(snapshot[0]);
    // Raising the Outstanding cut cannot increase its band size.
    expect(m1.bands[0]!.students).toBeLessThanOrEqual(m0.bands[0]!.students);
    // Band %s recompute live and still sum to ~100.
    const sumPct = m1.bands.reduce((a, b) => a + b.pct, 0);
    expect(Math.round(sumPct)).toBe(100);
  });

  it("reset-to-suggestion restores every cut", () => {
    p.setBoundary(cycleId, scope, { suggest: true });
    const snapshot = p.getBoundaries(cycleId, scope)!.suggestedCuts!;
    p.setBoundary(cycleId, scope, { cutIndex: 0, cutValue: (snapshot[0] ?? 50) + 2 });
    p.setBoundary(cycleId, scope, { resetToSuggestion: true });
    expect(p.getBoundaries(cycleId, scope)!.cuts).toEqual(snapshot);
  });

  it("changing a target re-suggests different cuts", () => {
    p.setBoundary(cycleId, scope, { targets: [5, 10, 30] });
    const a = p.getBoundaries(cycleId, scope)!.suggestion.cuts;
    p.setBoundary(cycleId, scope, { targets: [20, 30, 40] });
    const b = p.getBoundaries(cycleId, scope)!.suggestion.cuts;
    // A more selective top target should not produce a lower top cut.
    expect(a[0]).toBeGreaterThanOrEqual(b[0]!);
  });
});

describe("½-D3 warning", () => {
  it("is surfaced on per-subject scopes and never throws", () => {
    const p = new InMemoryDataProvider();
    const cycleId = liveCycleId(p);
    const scope = subjectScope(p, cycleId);
    const m = p.getBoundaries(cycleId, scope)!;
    expect(typeof m.d3Warning.consistent).toBe("boolean");
    expect(m.d3Warning.note.length).toBeGreaterThan(0);
    // The suggestion carries its own ½-D3 evaluation too.
    expect(typeof m.suggestion.d3.consistent).toBe("boolean");
  });
});
