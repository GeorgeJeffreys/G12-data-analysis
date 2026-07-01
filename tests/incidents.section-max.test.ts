/**
 * Section max = the engine's SCORED denominator, never a naïve sum of raw item
 * maxes. These lock: the assessment basis reads the engine's ParticipantScore.max
 * verbatim; the major-element basis excludes max-0 stimulus items and cohort-
 * excluded items; and resolveSectionMax picks the right basis (0 when absent).
 */
import { describe, it, expect } from "vitest";
import {
  assessmentSectionMax,
  majorElementSectionMax,
  resolveSectionMax,
} from "@/lib/incidents/section-max";
import type { ItemMeta, ParticipantScore, ResponseRecord } from "@/lib/engine/types";

const score = (assessmentId: string, max: number): ParticipantScore => ({
  participantId: "p1",
  assessmentId,
  mcq: 0,
  essay: 0,
  alterations: 0,
  raw: 0,
  max,
  pct: 0,
  itemsSeen: 0,
});

describe("assessmentSectionMax", () => {
  it("returns the engine's scored max for the assessment", () => {
    const scores = [score("a1", 40), score("a2", 25)];
    expect(assessmentSectionMax(scores, "a1")).toBe(40);
    expect(assessmentSectionMax(scores, "a2")).toBe(25);
  });
  it("null when the assessment has no scored rows", () => {
    expect(assessmentSectionMax([score("a1", 40)], "zzz")).toBeNull();
  });
});

describe("majorElementSectionMax — engine retained-denominator rule", () => {
  const items: ItemMeta[] = [
    { itemId: "i1", assessmentId: "a1", majorElement: "Number", maxScore: 1 },
    { itemId: "i2", assessmentId: "a1", majorElement: "Number", maxScore: 2 },
    { itemId: "i3", assessmentId: "a1", majorElement: "Number", maxScore: 0 }, // stimulus (max-0) — excluded from denom
    { itemId: "i4", assessmentId: "a1", majorElement: "Algebra", maxScore: 1 }, // different element
    { itemId: "i5", assessmentId: "a2", majorElement: "Number", maxScore: 5 }, // different assessment
  ];
  const responses: ResponseRecord[] = [
    { participantId: "p1", itemId: "i1", assessmentId: "a1", score: 1 },
    { participantId: "p1", itemId: "i2", assessmentId: "a1", score: 2 },
    { participantId: "p1", itemId: "i3", assessmentId: "a1", score: 0 },
    { participantId: "p1", itemId: "i4", assessmentId: "a1", score: 1 },
  ];

  it("sums retained item max within (assessment, element); max-0 items add 0", () => {
    // i1 (1) + i2 (2) + i3 (0) = 3 for Number on a1
    expect(majorElementSectionMax(responses, items, "a1", "Number")).toBe(3);
  });

  it("drops cohort-excluded items from the denominator", () => {
    expect(majorElementSectionMax(responses, items, "a1", "Number", ["i2"])).toBe(1);
  });

  it("ignores items that never appear in the responses", () => {
    // i5 belongs to a2 and isn't in a1's responses → not counted for a1
    expect(majorElementSectionMax(responses, items, "a1", "Algebra")).toBe(1);
  });
});

describe("resolveSectionMax", () => {
  const pct = { kind: "pct_section" as const, percent: 10, basis: "assessment" as const };
  it("picks the assessment denominator by default", () => {
    expect(resolveSectionMax(pct, { assessment: 40, majorElement: 3 })).toBe(40);
  });
  it("picks the major-element denominator when the formula asks for it", () => {
    expect(resolveSectionMax({ ...pct, basis: "major_element" }, { assessment: 40, majorElement: 3 })).toBe(3);
  });
  it("returns 0 for a non-pct formula or a missing denominator", () => {
    expect(resolveSectionMax({ kind: "fixed", marks: 1 }, { assessment: 40 })).toBe(0);
    expect(resolveSectionMax(pct, {})).toBe(0);
  });
});
