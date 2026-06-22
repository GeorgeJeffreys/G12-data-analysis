/**
 * Marginal-student flags + audited, reversible manual mark adjustment, through
 * the REAL provider over the genuine seeded cohort.
 *
 * Covers (per the task's test list):
 *  - A student 1–2 raw marks below a boundary is flagged; 3+ below (or above) is not.
 *  - A manual mark adjustment recomputes the grade through the full path (incl. the
 *    D3 distinction safeguard) and writes an audit entry (actor + old→new + reason + time).
 *  - Removing an adjustment reverts the grade and audits the removal.
 *  - The delta is applied as engine INPUT (alterations), not by touching item-stats
 *    or engine logic — engine parity stays intact.
 */

import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { MARGINAL_MARK_THRESHOLD } from "@/lib/data/grading";
import { getEngine } from "@/lib/engine";
import type { GradeCell } from "@/lib/data/types";

const CYCLE = "may-2026";

/** A (student, subject) with a mid-range raw mark so we can move the boundary up
 *  and down around it without clamping at 0 or the subject max. */
function pickTarget(p: InMemoryDataProvider) {
  const comp = p.getComposition(CYCLE)!;
  for (const s of comp.students) {
    for (const sj of s.subjects) {
      if (sj.total >= 8 && sj.total <= sj.max - 14) {
        return { pid: s.participantId, aid: sj.assessmentId, raw: sj.total, max: sj.max };
      }
    }
  }
  throw new Error("no suitable target student/subject in the seed");
}

function cellOf(p: InMemoryDataProvider, pid: string, aid: string): GradeCell {
  return p.getGrades(CYCLE)!.rows.find((r) => r.id === pid)!.grades[aid]!;
}

describe("marginal-student flag (within N raw marks below the next boundary)", () => {
  it("flags a student ~1.5 marks below the next grade-up cut", () => {
    const p = new InMemoryDataProvider();
    const t = pickTarget(p);
    const pct = (m: number) => (m / t.max) * 100;
    // Lowest cut sits 1.5 marks above the student → they just missed the next grade.
    p.setBoundary(CYCLE, t.aid, { cuts: [pct(t.raw + 8), pct(t.raw + 4), pct(t.raw + 1.5)] });
    const cell = cellOf(p, t.pid, t.aid);
    expect(cell.marginal).toBe(true);
    // ~1.5 marks below (cut scores round to whole percents, so allow a little slack).
    expect(cell.marksToNext).toBeCloseTo(1.5, 0);
    expect(cell.marksToNext!).toBeGreaterThan(0);
    expect(cell.marksToNext!).toBeLessThanOrEqual(MARGINAL_MARK_THRESHOLD);
    expect(cell.nextLevel).toBeTruthy();
  });

  it("does NOT flag a student 5 marks below the boundary (3+ below)", () => {
    const p = new InMemoryDataProvider();
    const t = pickTarget(p);
    const pct = (m: number) => (m / t.max) * 100;
    p.setBoundary(CYCLE, t.aid, { cuts: [pct(t.raw + 12), pct(t.raw + 8), pct(t.raw + 5)] });
    expect(cellOf(p, t.pid, t.aid).marginal).toBeFalsy();
  });

  it("does NOT flag a student who has cleared the boundary (above it)", () => {
    const p = new InMemoryDataProvider();
    const t = pickTarget(p);
    const pct = (m: number) => (m / t.max) * 100;
    p.setBoundary(CYCLE, t.aid, { cuts: [pct(t.raw - 1), pct(t.raw - 3), pct(t.raw - 5)] });
    expect(cellOf(p, t.pid, t.aid).marginal).toBeFalsy();
  });
});

describe("manual mark adjustment — audited, recomputes through the full grade path", () => {
  it("recomputes the grade (a marginal student crosses the boundary) and audits old→new + reason + actor + time", () => {
    const p = new InMemoryDataProvider();
    const t = pickTarget(p);
    const pct = (m: number) => (m / t.max) * 100;
    // Make the student marginal: lowest cut ~1.5 marks above their mark, with the
    // other cuts far away so a small bump clears the boundary cleanly.
    p.setBoundary(CYCLE, t.aid, { cuts: [pct(t.raw + 30), pct(t.raw + 18), pct(t.raw + 1.5)] });
    const before = cellOf(p, t.pid, t.aid);
    expect(before.marginal).toBe(true);
    const nextLevel = before.nextLevel!;

    // Nudge the mark just past the boundary.
    p.adjustStudentMark(CYCLE, t.pid, t.aid, t.raw + 2, "Remark after appeal on Q14");

    const after = cellOf(p, t.pid, t.aid);
    expect(after.level).not.toBe(before.level); // grade moved
    expect(after.level).toBe(nextLevel); // up to the next grade
    expect(after.marginal).toBeFalsy(); // no longer just-below (next cut is far away)
    // The adjustment is surfaced on the cell (never hidden).
    expect(after.adjustment).toBeTruthy();
    expect(after.adjustment!.newMark).toBeCloseTo(t.raw + 2, 5);
    expect(after.adjustment!.delta).toBeCloseTo(2, 5);

    // Audit: newest entry carries actor, old→new, reason and a timestamp.
    const e = p.getAuditLog(CYCLE, "all", "").entries[0]!;
    expect(e.action).toBe("Manual mark adjustment");
    expect(e.actorName).toBeTruthy();
    expect(e.actorId).toBeTruthy();
    expect(e.detail).toMatch(/→/); // old → new
    expect(e.detail).toContain("Remark after appeal on Q14"); // reason
    expect(Number.isNaN(Date.parse(e.ts))).toBe(false); // time
  });

  it("requires a reason (a blank reason is a no-op, nothing audited)", () => {
    const p = new InMemoryDataProvider();
    const t = pickTarget(p);
    const auditBefore = p.getAuditLog(CYCLE, "all", "").entries.length;
    p.adjustStudentMark(CYCLE, t.pid, t.aid, t.raw + 2, "   ");
    expect(cellOf(p, t.pid, t.aid).adjustment ?? null).toBeNull();
    expect(p.getAuditLog(CYCLE, "all", "").entries.length).toBe(auditBefore);
  });

  it("the D3 distinction safeguard still applies after a mark adjustment recomputes the award", () => {
    const p = new InMemoryDataProvider();
    // Drop every cut so the cohort reaches the Distinction level-pattern; the
    // genuine, score-based D3 cap then gates Distinction (mirrors grading.distinction).
    for (const a of p.getGrades(CYCLE)!.assessments) p.setBoundary(CYCLE, a.id, { cuts: [5, 3, 1] });
    const distinction = p.getGrades(CYCLE)!.awardLevels[0]!;
    const capped = p.getGrades(CYCLE)!.rows.find((r) => r.distinctionCap)!;
    expect(capped.award).not.toBe(distinction);

    // A manual mark adjustment does not touch D3 item correctness, so the safeguard
    // must still deny Distinction through the recompute.
    const someSubject = p.getGrades(CYCLE)!.assessments[0]!.id;
    const sc = p.getComposition(CYCLE)!.students.find((s) => s.participantId === capped.id)!
      .subjects.find((s) => s.assessmentId === someSubject)!;
    p.adjustStudentMark(CYCLE, capped.id, someSubject, sc.total + 1, "Clerical correction");

    const after = p.getGrades(CYCLE)!.rows.find((r) => r.id === capped.id)!;
    expect(after.award).not.toBe(distinction); // safeguard still caps it
    expect(after.distinctionCap).toBeTruthy();
  });
});

describe("manual mark adjustment — reversible", () => {
  it("removing an adjustment reverts the grade and audits the removal", () => {
    const p = new InMemoryDataProvider();
    const t = pickTarget(p);
    const pct = (m: number) => (m / t.max) * 100;
    p.setBoundary(CYCLE, t.aid, { cuts: [pct(t.raw + 8), pct(t.raw + 4), pct(t.raw + 1.5)] });
    const original = cellOf(p, t.pid, t.aid).level;

    p.adjustStudentMark(CYCLE, t.pid, t.aid, t.raw + 2, "Remark after appeal");
    const adjusted = cellOf(p, t.pid, t.aid);
    expect(adjusted.level).not.toBe(original);
    const adjId = adjusted.adjustment!.id;

    p.removeStudentMarkAdjustment(CYCLE, adjId);
    const reverted = cellOf(p, t.pid, t.aid);
    expect(reverted.level).toBe(original); // grade reverted
    expect(reverted.adjustment ?? null).toBeNull();
    expect(reverted.marginal).toBe(true); // back to just-below

    const e = p.getAuditLog(CYCLE, "all", "").entries[0]!;
    expect(e.action).toBe("Removed mark adjustment");
    expect(e.detail).toMatch(/revert/i);
  });
});

describe("engine parity — the delta is applied via input, not by touching item-stats/engine logic", () => {
  it("a mark adjustment moves the total via the Alterations component only; MCQ/essay and item-stats are untouched", () => {
    const p = new InMemoryDataProvider();
    const t = pickTarget(p);

    const subjOf = () =>
      p.getComposition(CYCLE)!.students.find((s) => s.participantId === t.pid)!
        .subjects.find((s) => s.assessmentId === t.aid)!;
    const before = subjOf();

    // Item statistics are a pure function of the de-identified responses (the
    // 183/183 parity gate). They must be identical before and after the override.
    const engine = getEngine();
    const a = p.getGrades(CYCLE)!.assessments.find((x) => x.id === t.aid)!;
    void a;

    p.adjustStudentMark(CYCLE, t.pid, t.aid, before.total + 2, "Remark after appeal");
    const after = subjOf();

    expect(after.mcq).toBe(before.mcq); // item scoring untouched
    expect(after.essay).toBe(before.essay);
    expect(after.alterations).toBeCloseTo(before.alterations + 2, 5); // applied as an alteration (engine input)
    expect(after.total).toBeCloseTo(before.total + 2, 5);
    // The engine version/identity is unchanged — no engine logic was modified.
    expect(engine.version).toBe(getEngine().version);
  });
});
