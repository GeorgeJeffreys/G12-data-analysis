/**
 * P5 — the "upstream scores verified" gate. `overallAwardsReconcile` re-derives
 * each student's overall award from their best-of-two subject levels and checks it
 * matches the stated award. A well-formed rollup reconciles; a corrupted award
 * (the worst-case "certificate off a wrong score") fails, which blocks official
 * issuance. Pure aggregation — engine parity unaffected.
 */
import { describe, it, expect } from "vitest";
import { overallAwardsReconcile } from "@/lib/data/overall";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

const YEAR = "year-2026";
const MAY = "may-2026";

function model() {
  const p = new InMemoryDataProvider();
  p.lockCycle(MAY);
  const overall = p.getOverallGrades(YEAR)!;
  const args = {
    assessments: overall.assessments,
    performanceLevels: overall.performanceLevels,
    awardLevels: overall.awardLevels,
  };
  return { overall, args };
}

describe("overallAwardsReconcile — exports reconcile to truth", () => {
  it("a well-formed best-of-two rollup reconciles", () => {
    const { overall, args } = model();
    expect(overallAwardsReconcile(overall.rows, args)).toBe(true);
  });

  it("a corrupted overall award fails reconciliation (would block issuance)", () => {
    const { overall, args } = model();
    const rows = overall.rows.map((r, i) =>
      i === 0 ? { ...r, award: r.award === "Distinction" ? "No Award" : "Distinction" } : r,
    );
    expect(overallAwardsReconcile(rows, args)).toBe(false);
  });
});
