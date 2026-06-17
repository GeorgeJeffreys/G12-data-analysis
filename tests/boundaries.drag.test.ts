/**
 * P4 — draggable handles in BOTH boundary modes, synced with the RH table.
 *
 * Core principle: in both modes the histogram handles are draggable AND the
 * right-hand table is an equivalent input — drag or type, kept in two-way sync
 * over the same underlying value. What differs is which quantity drives:
 *   • "Set cut-points": dragging sets the raw cut score directly; counts derive.
 *   • "Set distribution": dragging re-targets the band's share; the existing
 *     Wave 3b backsolver solves the nearest achievable cut and the handle settles
 *     there. STUDENTS is always derived; the lowest band is the remainder.
 *
 * The drag in distribution mode feeds the EXISTING backsolver (it consumes
 * scores; it does not change how raw scores or item stats are computed) — engine
 * parity is covered by engine.parity.test.ts and is unaffected.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

function liveCycleId(p: InMemoryDataProvider): string {
  return p.listCycles()[0]!.id;
}
/** First per-subject (non-overall) scope. */
function subjectScope(p: InMemoryDataProvider, cycleId: string): string {
  const m = p.getBoundaries(cycleId, "overall")!;
  return m.scopes.find((s) => s.id !== "overall")!.id;
}

describe("Set cut-points mode — dragging sets the raw cut and recomputes counts", () => {
  let p: InMemoryDataProvider;
  let cycleId: string;
  let scope: string;
  beforeEach(() => {
    p = new InMemoryDataProvider();
    cycleId = liveCycleId(p);
    scope = subjectScope(p, cycleId);
    p.setBoundary(cycleId, scope, { suggest: true }); // adopt cuts as editable start
  });

  it("a drag (cutIndex/cutValue) sets the raw cut directly and recomputes the band counts", () => {
    const before = p.getBoundaries(cycleId, scope)!;
    const startTop = before.cuts[0]!;
    // Drag the top handle UP a few points (kept within bounds + ordering).
    const target = Math.min(before.guardrails.ceilingPct, startTop + 4);
    p.setBoundary(cycleId, scope, { cutIndex: 0, cutValue: target });
    const after = p.getBoundaries(cycleId, scope)!;
    // The raw cut is set directly to the dragged value (mode "cuts" → user wins).
    expect(after.mode).toBe("cuts");
    expect(after.cuts[0]).toBe(target);
    // Counts recompute live: raising the Outstanding cut cannot grow its band.
    expect(after.bands[0]!.students).toBeLessThanOrEqual(before.bands[0]!.students);
  });

  it("drag ↔ table two-way sync: both edit the same cut value", () => {
    // A drag and a typed table edit go through the same cut field, so committing
    // the same value either way lands on the identical model.
    p.setBoundary(cycleId, scope, { cutIndex: 1, cutValue: 45 }); // "drag"
    const dragged = p.getBoundaries(cycleId, scope)!;
    p.setBoundary(cycleId, scope, { cutIndex: 1, cutValue: 45 }); // "type" same value
    const typed = p.getBoundaries(cycleId, scope)!;
    expect(typed.cuts).toEqual(dragged.cuts);
    expect(typed.cuts[1]).toBe(45);
  });
});

describe("Set distribution mode — dragging re-targets the share and backsolves the cut", () => {
  let p: InMemoryDataProvider;
  let cycleId: string;
  let scope: string;
  beforeEach(() => {
    p = new InMemoryDataProvider();
    cycleId = liveCycleId(p);
    scope = subjectScope(p, cycleId);
    p.setBoundary(cycleId, scope, { mode: "pct", targets: [15, 20, 50] });
  });

  it("dragging a handle re-targets the band share; the handle settles at the backsolved cut", () => {
    const before = p.getBoundaries(cycleId, scope)!;
    // In pct mode the effective cuts ARE the backsolved suggestion (handle settles
    // at the achievable value).
    expect(before.cuts).toEqual(before.suggestion.cuts);
    // Drag the top handle to a higher score → fewer students above it → its
    // target share shrinks, and the handle re-settles on the solved cut.
    const highScore = Math.min(95, (before.cuts[0] ?? 50) + 10);
    p.setBoundary(cycleId, scope, { dragTargetIndex: 0, dragScoreValue: highScore });
    const after = p.getBoundaries(cycleId, scope)!;
    // Still distribution mode; the handle settles at the backsolved cut.
    expect(after.mode).toBe("pct");
    expect(after.cuts).toEqual(after.suggestion.cuts);
    // The dragged band's target share fell (we dragged toward a more selective cut).
    expect(after.targets[0]!).toBeLessThanOrEqual(before.targets[0]!);
    // Counts recompute live: dragging the top handle higher cannot grow its band.
    expect(after.bands[0]!.students).toBeLessThanOrEqual(before.bands[0]!.students);
  });

  it("drag ↔ table two-way sync: a drag and the equivalent typed % land on the same cut", () => {
    // Drag re-targets a band's share; the value it lands on is exactly what the
    // table's % column edits, so typing that share reproduces the same cuts.
    const highScore = Math.min(95, (p.getBoundaries(cycleId, scope)!.cuts[0] ?? 50) + 8);
    p.setBoundary(cycleId, scope, { dragTargetIndex: 0, dragScoreValue: highScore });
    const dragged = p.getBoundaries(cycleId, scope)!;
    const draggedShare = dragged.targets[0]!;
    // Reset and reproduce via a typed table edit of the SAME share.
    p.setBoundary(cycleId, scope, { mode: "pct", targets: [15, 20, 50] });
    p.setBoundary(cycleId, scope, { targetIndex: 0, targetValue: draggedShare });
    const typed = p.getBoundaries(cycleId, scope)!;
    expect(typed.cuts).toEqual(dragged.cuts);
    expect(typed.targets[0]).toBe(draggedShare);
  });

  it("a drag never pushes the lowest band (remainder) below zero", () => {
    // Drag the lowest cut hard toward 0 so its band wants to swell — the
    // remainder is held at ≥ 0 (targets of the upper bands cannot exceed 100).
    p.setBoundary(cycleId, scope, { dragTargetIndex: 2, dragScoreValue: 1 });
    const m = p.getBoundaries(cycleId, scope)!;
    const sum = m.targets.reduce((a, b) => a + (Number(b) || 0), 0);
    expect(sum).toBeLessThanOrEqual(100);
  });
});

describe("Invariants in both modes — lowest band is the remainder, STUDENTS is derived", () => {
  let p: InMemoryDataProvider;
  let cycleId: string;
  let scope: string;
  beforeEach(() => {
    p = new InMemoryDataProvider();
    cycleId = liveCycleId(p);
    scope = subjectScope(p, cycleId);
  });

  for (const mode of ["cuts", "pct"] as const) {
    it(`(${mode}) the lowest band has no cut (remainder) and STUDENTS sums to the cohort`, () => {
      p.setBoundary(cycleId, scope, { mode });
      if (mode === "cuts") p.setBoundary(cycleId, scope, { suggest: true });
      const m = p.getBoundaries(cycleId, scope)!;
      // Lowest band carries no cut — it is the remainder.
      expect(m.bands[m.bands.length - 1]!.cut).toBeNull();
      // STUDENTS is derived: the per-band counts sum to the whole cohort.
      const total = m.bands.reduce((a, b) => a + b.students, 0);
      expect(total).toBe(m.n);
    });
  }
});
