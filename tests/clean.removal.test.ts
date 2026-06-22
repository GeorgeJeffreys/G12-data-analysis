/**
 * Clean-stage removals — non-destructive row (participant) / column (item)
 * exclusion. Removing from the cleaned set must:
 *   1. shrink the cleaned view (getDataCleaning rows/columns) + update rowsAfter,
 *   2. leave the raw overview (getRawData) untouched,
 *   3. propagate downstream to raw scores (getNaiveScores) and scoring (grades),
 *   4. be reversible (restore / Revert all).
 * The engine itself is unchanged — with no removals the read models are identical
 * (engine parity is covered separately).
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

function setup() {
  const p = new InMemoryDataProvider();
  const cycleId = p.listCycles()[0]!.id;
  const assessmentId = p.getCycle(cycleId)!.assessments[0]!.id;
  return { p, cycleId, assessmentId };
}

describe("Clean-stage removals", () => {
  it("removes a row from the cleaned view + updates rowsAfter, leaving raw untouched", () => {
    const { p, cycleId, assessmentId } = setup();
    const before = p.getDataCleaning(cycleId, assessmentId)!;
    const rawBefore = p.getRawData(cycleId, assessmentId)!;
    expect(before.rowsBefore).toBe(before.rows.length);
    expect(before.rowsAfter).toBe(before.rows.length);

    const victim = before.rows[0]!.id;
    p.setCleanRemoval(cycleId, assessmentId, { rows: [victim] }, true);

    const after = p.getDataCleaning(cycleId, assessmentId)!;
    expect(after.rowsBefore).toBe(before.rowsBefore); // original total unchanged
    expect(after.rowsAfter).toBe(before.rowsAfter - 1);
    expect(after.rows.some((r) => r.id === victim)).toBe(false);

    // Raw overview is the untouched upload.
    const rawAfter = p.getRawData(cycleId, assessmentId)!;
    expect(rawAfter.rows.length).toBe(rawBefore.rows.length);
    expect(rawAfter.rows.some((r) => r.id === victim)).toBe(true);
  });

  it("removes a column from the cleaned view + folds it into the scored exclusions", () => {
    const { p, cycleId, assessmentId } = setup();
    const before = p.getDataCleaning(cycleId, assessmentId)!;
    const naiveBefore = p.getNaiveScores(cycleId, assessmentId)!;
    const col = before.columns[0]!.id;

    p.setCleanRemoval(cycleId, assessmentId, { cols: [col] }, true);

    const after = p.getDataCleaning(cycleId, assessmentId)!;
    expect(after.columns.length).toBe(before.columns.length - 1);
    expect(after.columns.some((c) => c.id === col)).toBe(false);
    // Cells stay aligned to the (now-shorter) column list.
    expect(after.rows[0]!.cells.length).toBe(after.columns.length);

    // Raw-scores view drops the removed item from the scored max.
    const naiveAfter = p.getNaiveScores(cycleId, assessmentId)!;
    expect(naiveAfter.mcqItems).toBeLessThanOrEqual(naiveBefore.mcqItems);
    // The review/scoring exclusion path sees the removed column.
    const review = p.getReview(cycleId, assessmentId)!;
    expect(review.items.find((i) => i.id === col)?.excluded).toBe(true);
  });

  it("drops a removed participant from raw scores (downstream propagation)", () => {
    const { p, cycleId, assessmentId } = setup();
    const naiveBefore = p.getNaiveScores(cycleId, assessmentId)!;
    const victim = naiveBefore.students[0]!.id;
    expect(naiveBefore.students.some((s) => s.id === victim)).toBe(true);

    p.setCleanRemoval(cycleId, assessmentId, { rows: [victim] }, true);

    const naiveAfter = p.getNaiveScores(cycleId, assessmentId)!;
    expect(naiveAfter.students.length).toBe(naiveBefore.students.length - 1);
    expect(naiveAfter.students.some((s) => s.id === victim)).toBe(false);
  });

  it("is reversible — restore one + Revert all", () => {
    const { p, cycleId, assessmentId } = setup();
    const before = p.getDataCleaning(cycleId, assessmentId)!;
    const row = before.rows[0]!.id;
    const col = before.columns[0]!.id;

    p.setCleanRemoval(cycleId, assessmentId, { rows: [row], cols: [col] }, true);
    expect(p.getDataCleaning(cycleId, assessmentId)!.rowsAfter).toBe(before.rowsAfter - 1);

    // Restore just the row.
    p.setCleanRemoval(cycleId, assessmentId, { rows: [row] }, false);
    let mid = p.getDataCleaning(cycleId, assessmentId)!;
    expect(mid.rowsAfter).toBe(before.rowsAfter);
    expect(mid.columns.length).toBe(before.columns.length - 1); // column still gone

    // Revert all restores everything.
    p.clearCleanRemovals(cycleId, assessmentId);
    const reverted = p.getDataCleaning(cycleId, assessmentId)!;
    expect(reverted.rowsAfter).toBe(before.rowsAfter);
    expect(reverted.columns.length).toBe(before.columns.length);
  });

  it("does not change scores when nothing is removed (parity-safe default)", () => {
    const { p, cycleId, assessmentId } = setup();
    const a = p.getNaiveScores(cycleId, assessmentId)!;
    const b = new InMemoryDataProvider();
    const bCycle = b.listCycles()[0]!.id;
    const bAssessment = b.getCycle(bCycle)!.assessments[0]!.id;
    const c = b.getNaiveScores(bCycle, bAssessment)!;
    expect(a.mcqItems).toBe(c.mcqItems);
    expect(a.students.length).toBe(c.students.length);
    expect(a.cohortAvgPct).toBe(c.cohortAvgPct);
  });
});
