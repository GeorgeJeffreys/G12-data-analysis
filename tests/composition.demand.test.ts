/**
 * Per-demand-level (D1/D2/D3) score breakdown on the score-composition read-model.
 * Mirrors the "Overall Scores by Demand Level" sheet of MCQ_Overall_Score_Analysis:
 * each student's retained-MCQ score, rolled up by demand tag. This is additive
 * reporting only — the per-demand scores must reconcile with the already-computed
 * MCQ total, never changing scoring.
 */

import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

const CYCLE = "may-2026";

describe("per-demand-level score breakdown (composition)", () => {
  const provider = new InMemoryDataProvider();
  const comp = provider.getComposition(CYCLE)!;

  it("every subject carries a fixed-order D1/D2/D3 breakdown of demand-tagged items", () => {
    const order = ["D1", "D2", "D3"];
    let sawSplit = 0;
    for (const st of comp.students) {
      for (const subj of st.subjects) {
        expect(Array.isArray(subj.byDemand)).toBe(true);
        // only D1/D2/D3, in canonical order
        const labels = subj.byDemand.map((d) => d.demand);
        expect(labels).toEqual(order.filter((d) => labels.includes(d)));
        for (const d of subj.byDemand) {
          expect(["D1", "D2", "D3"]).toContain(d.demand);
          expect(d.max).toBeGreaterThan(0);
          expect(d.score).toBeGreaterThanOrEqual(0);
          expect(d.score).toBeLessThanOrEqual(d.max);
        }
        if (subj.byDemand.length > 0) sawSplit += 1;
      }
    }
    expect(sawSplit).toBeGreaterThan(0);
  });

  it("the per-demand scores never exceed the subject's MCQ total (additive rollup)", () => {
    for (const st of comp.students) {
      for (const subj of st.subjects) {
        const summed = subj.byDemand.reduce((t, d) => t + d.score, 0);
        // demand-tagged items are a subset of the retained MCQ items
        expect(summed).toBeLessThanOrEqual(subj.mcq + 1e-9);
      }
    }
  });
});
