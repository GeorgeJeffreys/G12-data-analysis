/**
 * Award-rule tests — the deterministic Layer-2 award lookup and the per-student
 * D3-majority cap (Standard-Setting Policy Stance v1.0). This is the logic that
 * decides real students' awards, so every clause and edge case from the spec has
 * a named test here:
 *
 *   - each award tier (Distinction / Advanced / Secondary / No Award);
 *   - the fall-through cases (highest → lowest, stop at first match);
 *   - a Distinction-pattern student denied by the D3 cap (falls to Advanced);
 *   - the dynamic D3 threshold for 5/6/7 available items;
 *   - correct-not-attempted; and the half/majority boundary.
 */

import { describe, it, expect } from "vitest";
import {
  deriveAward,
  qualifiesForDistinctionByLevels,
  d3MajorityThreshold,
  passesD3Majority,
  DEFAULT_SCORING_CONFIG,
  performanceLabels,
  awardLabels,
} from "@/lib/engine";

const LEVELS = performanceLabels(DEFAULT_SCORING_CONFIG); // [Outstanding, Exceeds, Meets, Doesn't-yet-meet]
const AWARDS = awardLabels(DEFAULT_SCORING_CONFIG); // [Distinction, Advanced, Secondary, No Award]
const [OUT, EXC, MEET, NONE] = LEVELS as [string, string, string, string];
const [DISTINCTION, ADVANCED, SECONDARY, NO_AWARD] = AWARDS as [string, string, string, string];

const cfg = { performanceLevels: LEVELS, awardLevels: AWARDS };
const award = (subjectLevels: string[], d3Pass = true) =>
  deriveAward({ subjectLevels, d3Pass }, cfg).award;

describe("award rule — Layer 2 level-combination lookup", () => {
  describe("Distinction (★★★ in ≥3 AND ≥★ in the rest)", () => {
    it("3 Outstanding + 2 Meets-or-better, D3 passed → Distinction", () => {
      expect(award([OUT, OUT, OUT, MEET, EXC])).toBe(DISTINCTION);
    });
    it("all five Outstanding, D3 passed → Distinction", () => {
      expect(award([OUT, OUT, OUT, OUT, OUT])).toBe(DISTINCTION);
    });
    it("exactly 3 Outstanding + 2 bare Meets, D3 passed → Distinction", () => {
      expect(award([OUT, OUT, OUT, MEET, MEET])).toBe(DISTINCTION);
    });
    it("only 2 Outstanding → not Distinction (falls through)", () => {
      // 2 Outstanding + 3 Exceeds → ★★-or-better in 5 ≥ 3 → Advanced
      expect(award([OUT, OUT, EXC, EXC, EXC])).toBe(ADVANCED);
    });
    it("3 Outstanding but a no-star remaining subject → fails ≥Meets clause, falls through", () => {
      // 3 Outstanding + 1 Meets + 1 no-star: not Distinction.
      // Exceeds-or-better = 3 (the Outstandings) ≥ 3 → Advanced.
      expect(award([OUT, OUT, OUT, MEET, NONE])).toBe(ADVANCED);
    });
  });

  describe("Advanced (★★ Exceeds in ≥3)", () => {
    it("3 Exceeds + 2 lower → Advanced", () => {
      expect(award([EXC, EXC, EXC, MEET, NONE])).toBe(ADVANCED);
    });
    it("2 Outstanding + 1 Exceeds (3 at ★★-or-better) → Advanced", () => {
      expect(award([OUT, OUT, EXC, MEET, MEET])).toBe(ADVANCED);
    });
    it("only 2 at Exceeds-or-better → not Advanced (falls through to Secondary)", () => {
      expect(award([EXC, EXC, MEET, MEET, MEET])).toBe(SECONDARY);
    });
  });

  describe("Secondary (★ Meets in ≥4)", () => {
    it("4 Meets-or-better → Secondary", () => {
      expect(award([MEET, MEET, MEET, MEET, NONE])).toBe(SECONDARY);
    });
    it("mixed but ≥4 starred and <3 Exceeds → Secondary", () => {
      expect(award([EXC, MEET, MEET, MEET, NONE])).toBe(SECONDARY);
    });
    it("only 3 starred → not Secondary (No Award)", () => {
      expect(award([MEET, MEET, MEET, NONE, NONE])).toBe(NO_AWARD);
    });
  });

  describe("No Award (no-star in ≥2 / ★-or-better in ≤3)", () => {
    it("2 no-star subjects with no qualifying higher tier → No Award", () => {
      // 2 Exceeds + 1 Meets + 2 no-star: Exceeds-or-better = 2 (<3), starred = 3
      // (<4) → no tier matches → No Award.
      expect(award([EXC, EXC, MEET, NONE, NONE])).toBe(NO_AWARD);
    });
    it("3 Outstanding but 2 no-star still reaches Advanced via the ordered rule", () => {
      // The ordered evaluation catches Advanced (3 at ★★-or-better) before the
      // No-Award gloss; the explicit tiers win, by spec.
      expect(award([OUT, OUT, OUT, NONE, NONE])).toBe(ADVANCED);
    });
    it("all no-star → No Award", () => {
      expect(award([NONE, NONE, NONE, NONE, NONE])).toBe(NO_AWARD);
    });
    it("unknown/blank subject levels rank as the lowest band", () => {
      expect(award(["", "", "", "", ""])).toBe(NO_AWARD);
    });
  });

  describe("D3 cap denies a Distinction-pattern student", () => {
    it("3 Outstanding pattern but D3 failed → not Distinction, falls to Advanced", () => {
      const out = deriveAward({ subjectLevels: [OUT, OUT, OUT, MEET, MEET], d3Pass: false }, cfg);
      expect(out.award).toBe(ADVANCED);
      expect(out.d3Capped).toBe(true);
    });
    it("the same pattern with D3 passed IS Distinction (and not flagged capped)", () => {
      const out = deriveAward({ subjectLevels: [OUT, OUT, OUT, MEET, MEET], d3Pass: true }, cfg);
      expect(out.award).toBe(DISTINCTION);
      expect(out.d3Capped).toBe(false);
    });
    it("a non-Distinction pattern is never flagged d3Capped, regardless of d3Pass", () => {
      const out = deriveAward({ subjectLevels: [EXC, EXC, EXC, MEET, MEET], d3Pass: false }, cfg);
      expect(out.award).toBe(ADVANCED);
      expect(out.d3Capped).toBe(false);
    });
  });

  describe("qualifiesForDistinctionByLevels (who is in line)", () => {
    it("true for ≥3 Outstanding with the rest ≥ Meets", () => {
      expect(qualifiesForDistinctionByLevels([OUT, OUT, OUT, MEET, EXC], LEVELS)).toBe(true);
    });
    it("false when a remaining subject is no-star", () => {
      expect(qualifiesForDistinctionByLevels([OUT, OUT, OUT, MEET, NONE], LEVELS)).toBe(false);
    });
    it("false with only 2 Outstanding", () => {
      expect(qualifiesForDistinctionByLevels([OUT, OUT, EXC, EXC, EXC], LEVELS)).toBe(false);
    });
  });
});

describe("D3-majority rule (Layer 1b, per-student cap)", () => {
  describe("dynamic threshold = strictly more than half of available", () => {
    it("7 available → 4", () => expect(d3MajorityThreshold(7)).toBe(4));
    it("6 available → 4", () => expect(d3MajorityThreshold(6)).toBe(4));
    it("5 available → 3", () => expect(d3MajorityThreshold(5)).toBe(3));
    it("0 available → 0 (no D3 items, vacuous)", () => expect(d3MajorityThreshold(0)).toBe(0));
  });

  describe("correct-not-attempted, measured against available-not-attempted", () => {
    it("3 correct of 3 attempted still FAILS when 7 are available (need 4)", () => {
      expect(passesD3Majority(3, 7)).toBe(false);
    });
    it("4 correct of 7 available passes", () => {
      expect(passesD3Majority(4, 7)).toBe(true);
    });
  });

  describe("boundary cases", () => {
    it("exactly half correct fails (3 of 6 → need 4)", () => {
      expect(passesD3Majority(3, 6)).toBe(false);
    });
    it("majority correct passes (4 of 6)", () => {
      expect(passesD3Majority(4, 6)).toBe(true);
    });
    it("an exam with no D3 items cannot deny anyone", () => {
      expect(passesD3Majority(0, 0)).toBe(true);
    });
  });
});
