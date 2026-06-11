/**
 * ScoringConfig tests — proof that the engine is now config-driven, the
 * companion to the parity gate.
 *
 * The parity test pins the engine to `DEFAULT_SCORING_CONFIG`. These tests prove
 * the *other* direction: that a NON-default config genuinely changes outcomes —
 *   1. a changed quality threshold re-rates an item,
 *   2. an added / removed performance level changes the classification (N levels,
 *      not fixed at four),
 *   3. a changed cut-point moves a score between levels.
 * Together they show the thresholds and level/award sets are real inputs, not
 * decoration, while the default reproduces the published behaviour byte-for-byte.
 */

import { describe, it, expect } from "vitest";
import {
  getEngine,
  classifyByCuts,
  defaultScoringConfig,
  DEFAULT_SCORING_CONFIG,
  type ResponseRecord,
  type ScoringConfig,
} from "@/lib/engine";

const engine = getEngine();

/** Ten participants, one item, five correct → p-value exactly 0.50. */
function halfCorrectResponses(): ResponseRecord[] {
  return Array.from({ length: 10 }, (_, i) => ({
    participantId: `p${i}`,
    itemId: "Q1",
    assessmentId: "A",
    score: i < 5 ? 1 : 0,
  }));
}

describe("ScoringConfig — defaulting is parity-safe", () => {
  it("omitting scoringConfig is identical to passing the default", () => {
    const responses = halfCorrectResponses();
    const implicit = engine.computeItemStats({ responses });
    const explicit = engine.computeItemStats({ responses, scoringConfig: defaultScoringConfig() });
    expect(explicit).toEqual(implicit);
  });
});

describe("ScoringConfig — a changed quality threshold re-rates an item", () => {
  const responses = halfCorrectResponses();

  it("p-value 0.50 is Good by default but Review under a tighter band", () => {
    const def = engine.computeItemStats({ responses })[0]!;
    expect(def.pValue).toBe(0.5);
    expect(def.pRating).toBe("Good");

    // Tighten the 'Good' window so 0.50 now falls in the lower Review band.
    const strict: ScoringConfig = {
      ...defaultScoringConfig(),
      quality: {
        ...DEFAULT_SCORING_CONFIG.quality,
        pValue: { flagBelow: 0.2, reviewBelow: 0.6, goodUpTo: 0.85, reviewUpTo: 0.9 },
      },
    };
    const tightened = engine.computeItemStats({ responses, scoringConfig: strict })[0]!;
    expect(tightened.pRating).toBe("Review");
    // The statistic itself is unchanged — only the rating moved.
    expect(tightened.pValue).toBe(def.pValue);
  });

  it("a changed discrimination band re-rates discrimination independently", () => {
    // Build a clean discrimination signal: top scorers get the item right.
    const responses: ResponseRecord[] = [];
    for (let i = 0; i < 9; i++) {
      const high = i >= 6; // top third
      responses.push({ participantId: `s${i}`, itemId: "Q1", assessmentId: "A", score: high ? 1 : 0 });
      // a filler item so totals separate the groups
      responses.push({ participantId: `s${i}`, itemId: "Q2", assessmentId: "A", score: high ? 1 : 0 });
    }
    const def = engine.computeItemStats({ responses }).find((s) => s.itemId === "Q1")!;
    expect(def.discRating).toBe("Good");

    const strict: ScoringConfig = {
      ...defaultScoringConfig(),
      quality: {
        ...DEFAULT_SCORING_CONFIG.quality,
        // Demand a very high discrimination for 'Good'.
        discrimination: { flagBelow: 0.1, reviewBelow: 1.5 },
      },
    };
    const rerated = engine.computeItemStats({ responses, scoringConfig: strict }).find((s) => s.itemId === "Q1")!;
    expect(rerated.discrimination).toBe(def.discrimination); // statistic unchanged
    expect(rerated.discRating).toBe("Review"); // rating moved
  });
});

describe("ScoringConfig — N performance levels (not fixed at four)", () => {
  const defaultLevels = DEFAULT_SCORING_CONFIG.performanceLevels.map((l) => l.label);
  const defaultCuts = DEFAULT_SCORING_CONFIG.performanceCuts; // [78, 58, 40]

  it("a score classifies into the default four-level set", () => {
    expect(classifyByCuts(80, defaultLevels, defaultCuts)).toBe("Outstanding performance");
    expect(classifyByCuts(60, defaultLevels, defaultCuts)).toBe("Exceeds expectations");
    expect(classifyByCuts(50, defaultLevels, defaultCuts)).toBe("Meets expectations");
    expect(classifyByCuts(10, defaultLevels, defaultCuts)).toBe("Doesn't yet meet expectations");
  });

  it("REMOVING the top level re-classifies a high score (three levels)", () => {
    // Drop 'Outstanding performance'; a score of 80 that was Outstanding now
    // lands in the new top level.
    const levels = ["Exceeds expectations", "Meets expectations", "Doesn't yet meet expectations"];
    const cuts = [58, 40];
    expect(classifyByCuts(80, defaultLevels, defaultCuts)).toBe("Outstanding performance");
    expect(classifyByCuts(80, levels, cuts)).toBe("Exceeds expectations");
  });

  it("ADDING a fifth level introduces a band a score can fall into", () => {
    const levels = [
      "Exceptional",
      "Outstanding performance",
      "Exceeds expectations",
      "Meets expectations",
      "Doesn't yet meet expectations",
    ];
    const cuts = [90, 78, 58, 40]; // four cut-points for five levels
    expect(classifyByCuts(95, levels, cuts)).toBe("Exceptional");
    expect(classifyByCuts(80, levels, cuts)).toBe("Outstanding performance");
    // The engine carries N levels with no hardcoded count.
    expect(levels.length).toBe(5);
  });

  it("award classification works for an N-award set too", () => {
    const awards = DEFAULT_SCORING_CONFIG.awardLevels.map((a) => a.label);
    expect(classifyByCuts(80, awards, DEFAULT_SCORING_CONFIG.awardCuts)).toBe("Distinction award");
    expect(classifyByCuts(10, awards, DEFAULT_SCORING_CONFIG.awardCuts)).toBe("No Award");
  });
});

describe("ScoringConfig — a changed cut-point moves a score between levels", () => {
  const levels = DEFAULT_SCORING_CONFIG.performanceLevels.map((l) => l.label);

  it("raising the 'Exceeds' cut demotes a 60% score", () => {
    expect(classifyByCuts(60, levels, [78, 58, 40])).toBe("Exceeds expectations");
    // Raise the middle cut above 60 — the same score drops a level.
    expect(classifyByCuts(60, levels, [78, 62, 40])).toBe("Meets expectations");
  });
});
