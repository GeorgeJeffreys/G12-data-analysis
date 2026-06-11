/**
 * Scoring-components tests (Part 1 of the scoring rebuild). The subject total is
 * mcq (retained) + essay + alterations, scored against a max of retained-item
 * count + (essay max when the subject has an essay).
 *
 * Also pins that removing the old per-student-exclusion path leaves item stats
 * untouched — the parity gate (tests/engine.parity.test.ts) stays 177/177.
 */
import { describe, it, expect } from "vitest";
import { getEngine } from "@/lib/engine";
import type { ResponseRecord } from "@/lib/engine";
import { loadParityFixtures } from "./fixtures";

const engine = getEngine();
const fixtures = loadParityFixtures();

function responsesFor(name: string): ResponseRecord[] {
  return fixtures[name]!.responses.map((r) => ({
    participantId: r.student,
    itemId: String(r.qid),
    assessmentId: name,
    score: r.score,
  }));
}

describe("subject total = MCQ + essay + alterations", () => {
  const ASSESSMENT = "Applicable Math";
  const responses = responsesFor(ASSESSMENT);
  const itemCount = fixtures[ASSESSMENT]!.items.length;

  it("MCQ-only (no essay, no alterations) scores out of the retained item count", () => {
    const scores = engine.computeScores(responses, []);
    for (const s of scores) {
      expect(s.essay).toBe(0);
      expect(s.alterations).toBe(0);
      expect(s.raw).toBe(s.mcq);
      expect(s.max).toBe(itemCount); // every participant sat every item in the fixture
      expect(s.pct).toBeCloseTo((s.mcq / itemCount) * 100, 6);
    }
  });

  it("an essay subject sums to a /(items+20) total", () => {
    const essaySubject = ASSESSMENT;
    const student = responses[0]!.participantId;
    const scores = engine.computeScores(responses, [], {
      essayAssessmentIds: [essaySubject],
      essayMax: 20,
      essayMarks: [{ participantId: student, assessmentId: essaySubject, mark: 15 }],
    });
    const s = scores.find((x) => x.participantId === student)!;
    expect(s.max).toBe(itemCount + 20);
    expect(s.essay).toBe(15);
    expect(s.raw).toBe(s.mcq + 15);
    expect(s.pct).toBeCloseTo(((s.mcq + 15) / (itemCount + 20)) * 100, 1);

    // a student without an essay mark still gets the /(items+20) max, essay 0
    const other = scores.find((x) => x.participantId !== student)!;
    expect(other.max).toBe(itemCount + 20);
    expect(other.essay).toBe(0);
  });

  it("an alteration of +n / −n moves a student's subject total and percentage", () => {
    const student = responses[0]!.participantId;
    const base = engine.computeScores(responses, []).find((s) => s.participantId === student)!;

    const plus = engine
      .computeScores(responses, [], { alterations: [{ participantId: student, assessmentId: ASSESSMENT, marks: 3 }] })
      .find((s) => s.participantId === student)!;
    expect(plus.alterations).toBe(3);
    expect(plus.raw).toBe(base.raw + 3);
    expect(plus.pct).toBeGreaterThan(base.pct);

    const minus = engine
      .computeScores(responses, [], { alterations: [{ participantId: student, assessmentId: ASSESSMENT, marks: -2 }] })
      .find((s) => s.participantId === student)!;
    expect(minus.alterations).toBe(-2);
    expect(minus.raw).toBe(base.raw - 2);
    expect(minus.pct).toBeLessThan(base.pct);

    // alterations only move the targeted student
    const untouched = engine
      .computeScores(responses, [], { alterations: [{ participantId: student, assessmentId: ASSESSMENT, marks: 3 }] })
      .find((s) => s.participantId !== student)!;
    const untouchedBase = engine.computeScores(responses, []).find((s) => s.participantId === untouched.participantId)!;
    expect(untouched.raw).toBe(untouchedBase.raw);
  });
});

describe("removing per-student exclusion leaves item stats unchanged", () => {
  it("computeItemStats is byte-identical with no per-student input (parity-safe)", () => {
    // The old API took a perStudentExcluded set; the empty path was a no-op.
    // Re-running with the current (no-exclusion) API must reproduce the fixtures.
    for (const name of Object.keys(fixtures)) {
      const stats = engine.computeItemStats({ responses: responsesFor(name) });
      const byItem = new Map(stats.map((s) => [s.itemId, s]));
      for (const item of fixtures[name]!.items) {
        const stat = byItem.get(String(item.qid))!;
        expect(stat.pRating).toBe(item.published.p_rating);
        expect(stat.overallReview).toBe(item.published.overall_review);
      }
    }
  });
});
