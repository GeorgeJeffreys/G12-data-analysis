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
import { getEngine } from "@/lib/engine";
import type { ItemMeta, ResponseRecord } from "@/lib/engine";

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

  // ── Task 2: a Clean change must propagate to every downstream computation ──

  it("removing the test participant at Clean drops them from grades + the cohort count", () => {
    const { p, cycleId } = setup();
    const cyc = p.getCycle(cycleId)!;
    // The canonical case is the test/staff account: cleaned out of EVERY subject.
    // Pick a participant present in every subject so removing them everywhere drops
    // them from the cohort entirely (not just one subject's scores).
    const present = cyc.assessments.map((a) => new Set(p.getNaiveScores(cycleId, a.id)!.students.map((s) => s.id)));
    const victim = [...present[0]!].find((id) => present.every((set) => set.has(id)))!;

    const gradesBefore = p.getGrades(cycleId)!;
    const relBefore = p.getReliability(cycleId)!;
    expect(gradesBefore.rows.some((r) => r.id === victim)).toBe(true);

    for (const a of cyc.assessments) p.setCleanRemoval(cycleId, a.id, { rows: [victim] }, true);

    const gradesAfter = p.getGrades(cycleId)!;
    const relAfter = p.getReliability(cycleId)!;
    // Grades drop the row (no blank shell), counts everywhere reflect the cleaned cohort.
    expect(gradesAfter.rows.length).toBe(gradesBefore.rows.length - 1);
    expect(gradesAfter.rows.some((r) => r.id === victim)).toBe(false);
    expect(relAfter.participants).toBe(relBefore.participants - 1);
    expect(p.getCycle(cycleId)!.participants).toBe(cyc.participants - 1);

    // Removed from only-some subjects ≠ cohort removal: revert one subject and the
    // participant returns to the cohort-wide views (still blank in the others).
    p.clearCleanRemovals(cycleId, cyc.assessments[0]!.id);
    expect(p.getGrades(cycleId)!.rows.some((r) => r.id === victim)).toBe(true);
    expect(p.getCycle(cycleId)!.participants).toBe(cyc.participants);
  });

  it("recomputes Cronbach's α over the cleaned cohort for a subject (incl. Math)", () => {
    const { p, cycleId } = setup();
    // Applicable Math is the first subject — the one reported as showing no α.
    const math = p.getCycle(cycleId)!.assessments[0]!.id;
    const subjBefore = p.getReliability(cycleId)!.rows.find((r) => r.level === "subject" && r.assessmentId === math)!;
    // Remove a COMPLETE-CASE participant (answered every Math item) so the α group
    // — which is over complete cases — provably recomputes over a smaller cohort.
    const completeCase = p.getRawData(cycleId, math)!.rows.find((r) => r.cells.every((c) => c !== null))!.id;

    p.setCleanRemoval(cycleId, math, { rows: [completeCase] }, true);

    const subjAfter = p.getReliability(cycleId)!.rows.find((r) => r.level === "subject" && r.assessmentId === math)!;
    expect(subjAfter.n).toBe(subjBefore.n - 1); // α recomputed over the cleaned set
    expect(subjAfter.alpha).not.toBeNull(); // Math still computes once cleaned data flows
    expect(subjAfter.alpha).not.toBe(subjBefore.alpha);
  });

  it("an undefined α reports a reason instead of vanishing — and clean restores it", () => {
    // The mechanism behind 'Math shows no α': a stray staff-only column (or the
    // test account's responses) leaves every real student incomplete for the
    // subject group → zero complete cases → α undefined. The engine surfaces a
    // REASON (never an omitted row); cleaning the stray input restores a real α.
    const engine = getEngine();
    const A = "MATH";
    const meta = (id: string): ItemMeta => ({ itemId: id, assessmentId: A, majorElement: null, subElement: null, demandLevel: null, maxScore: 1 });
    const items = ["q1", "q2", "q3", "qX"].map(meta);
    const rec = (pid: string, it: string, s: number): ResponseRecord => ({ participantId: pid, itemId: it, assessmentId: A, score: s });
    const responses: ResponseRecord[] = [];
    const real: Record<string, number[]> = { S1: [1, 1, 0], S2: [1, 0, 0], S3: [0, 1, 1] };
    for (const [pid, sc] of Object.entries(real)) ["q1", "q2", "q3"].forEach((it, j) => responses.push(rec(pid, it, sc[j]!)));
    // The test account is the ONLY one answering the stray column qX.
    ["q1", "q2", "q3", "qX"].forEach((it) => responses.push(rec("T", it, 1)));

    const uncleaned = engine.computeReliability({ responses, items }).groups.find((g) => g.level === "subject")!;
    expect(uncleaned.alpha).toBeNull();
    expect(uncleaned.note).toBeTruthy(); // a reason, not a silent omission

    // Clean the stray column (folds into the engine's exclusion path) → α computes.
    const cleaned = engine.computeReliability({
      responses: responses.filter((r) => r.itemId !== "qX"),
      items: items.filter((i) => i.itemId !== "qX"),
    }).groups.find((g) => g.level === "subject")!;
    expect(cleaned.alpha).not.toBeNull();
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
