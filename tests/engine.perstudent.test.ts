/**
 * Per-student exclusion tests (the deliberate engine extension). A per-student
 * exclusion removes one (participant, item) response from BOTH that student's
 * score AND that item's cohort statistics. The no-exclusion case must be
 * identical to the baseline (so parity stays green).
 */
import { describe, it, expect } from "vitest";
import { getEngine } from "@/lib/engine";
import type { PerStudentExclusion, ResponseRecord } from "@/lib/engine";
import { loadParityFixtures } from "./fixtures";

const engine = getEngine();
const fixtures = loadParityFixtures();
const ASSESSMENT = "Applicable Math";

function responsesFor(name: string): ResponseRecord[] {
  return fixtures[name]!.responses.map((r) => ({
    participantId: r.student,
    itemId: String(r.qid),
    assessmentId: name,
    score: r.score,
  }));
}

const responses = responsesFor(ASSESSMENT);

describe("per-student exclusion — scoring", () => {
  it("an empty exclusion set leaves every score unchanged (parity-safe)", () => {
    const base = engine.computeScores(responses, []);
    const withEmpty = engine.computeScores(responses, [], []);
    expect(withEmpty).toEqual(base);
  });

  it("drops the excluded item from only that student's score", () => {
    // Find a (student, item) the student answered correctly (score 1).
    const correct = fixtures[ASSESSMENT]!.responses.find((r) => r.score === 1)!;
    const student = correct.student;
    const item = String(correct.qid);

    const base = engine.computeScores(responses, []);
    const excl: PerStudentExclusion[] = [{ participantId: student, itemId: item }];
    const after = engine.computeScores(responses, [], excl);

    const baseByP = new Map(base.map((s) => [s.participantId, s]));
    const afterByP = new Map(after.map((s) => [s.participantId, s]));

    const b = baseByP.get(student)!;
    const a = afterByP.get(student)!;
    // The student lost one (correct) item: raw −1, itemsSeen −1.
    expect(a.itemsSeen).toBe(b.itemsSeen - 1);
    expect(a.raw).toBe(b.raw - 1);

    // Everyone else is identical.
    for (const [pid, bs] of baseByP) {
      if (pid === student) continue;
      expect(afterByP.get(pid)).toEqual(bs);
    }
  });
});

describe("per-student exclusion — item statistics", () => {
  it("an empty exclusion set reproduces the baseline item stats (parity-safe)", () => {
    const base = engine.computeItemStats({ responses });
    const withEmpty = engine.computeItemStats({ responses, perStudentExcluded: [] });
    expect(withEmpty).toEqual(base);
  });

  it("drops the glitched response from that item's cohort stats", () => {
    const correct = fixtures[ASSESSMENT]!.responses.find((r) => r.score === 1)!;
    const student = correct.student;
    const item = String(correct.qid);

    const base = engine.computeItemStats({ responses });
    const after = engine.computeItemStats({
      responses,
      perStudentExcluded: [{ participantId: student, itemId: item }],
    });

    const baseItem = base.find((s) => s.itemId === item)!;
    const afterItem = after.find((s) => s.itemId === item)!;

    // The item now has one fewer respondent and a recomputed p-value.
    expect(afterItem.n).toBe(baseItem.n - 1);
    expect(afterItem.pValue).not.toBe(baseItem.pValue);

    // Items the excluded student didn't touch on are unaffected in n.
    const otherUnchanged = base.every((b) => {
      const a = after.find((x) => x.itemId === b.itemId)!;
      return b.itemId === item ? true : a.n === b.n;
    });
    expect(otherUnchanged).toBe(true);
  });
});
