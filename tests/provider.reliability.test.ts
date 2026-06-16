/**
 * Provider read-model for Cronbach's α (getReliability). Confirms the cycle's
 * reliability surfaces the engine groups with resolved subject names, an
 * overall-exam row, per-subject rows, and honest small-sample flags at n≈18.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

const CYCLE = "may-2026";

describe("getReliability read-model", () => {
  const provider = new InMemoryDataProvider();
  const model = provider.getReliability(CYCLE)!;

  it("returns an overall-exam row and one row per subject", () => {
    expect(model).not.toBeNull();
    expect(model.overall.level).toBe("overall");
    expect(model.overall.assessmentId).toBeNull();
    expect(model.overall.k).toBeGreaterThan(150); // ~193 usable items
    const subjects = model.rows.filter((r) => r.level === "subject");
    expect(subjects.length).toBe(5);
    // subject rows carry the real assessment name (not the raw id) as the label
    for (const s of subjects) {
      expect(s.assessmentName).toBeTruthy();
      expect(s.label).toBe(s.assessmentName);
    }
  });

  it("flags the small cohort and reports k and n on every group", () => {
    expect(model.participants).toBe(18);
    expect(model.overall.smallSample).toBe(true); // n ≈ 18 < 30
    for (const r of model.rows) {
      expect(Number.isInteger(r.k)).toBe(true);
      expect(Number.isInteger(r.n)).toBe(true);
      // k<2 groups must be n/a; otherwise α is a number (possibly negative)
      if (r.k < 2) expect(r.alpha).toBeNull();
      if (r.alpha === null) expect(r.note).toBeTruthy();
    }
  });

  it("omits context α (no context tags in this data) but provides demand groups", () => {
    expect(model.rows.some((r) => r.level === "context")).toBe(false);
    expect(model.rows.some((r) => r.level === "demandLevel")).toBe(true);
    expect(model.rows.some((r) => r.level === "subElement")).toBe(true);
  });

  it("drops cohort-excluded items from the usable set (overall k decreases)", () => {
    const before = provider.getReliability(CYCLE)!.overall.k;
    // exclude one real item from the first assessment
    const cycle = provider.getCycle(CYCLE)!;
    const firstAssessment = cycle.assessments[0]!;
    const review = provider.getReview(CYCLE, firstAssessment.id)!;
    provider.setItemExcluded(CYCLE, firstAssessment.id, review.items[0]!.id, true, "test");
    const after = provider.getReliability(CYCLE)!.overall.k;
    expect(after).toBe(before - 1);
  });
});
