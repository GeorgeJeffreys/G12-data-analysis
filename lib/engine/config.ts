/**
 * ScoringConfig — the configuration the deterministic scoring core reads.
 *
 * Everything the engine used to hardcode about *judgement* (as opposed to the
 * verified maths) now lives here, so it can be edited in Settings and actually
 * change scoring:
 *
 *   1. Item-quality thresholds — the Good/Review/Flag bands for the four
 *      psychometric statistics (p-value, item-total, point-biserial,
 *      discrimination). `computeItemStats` reads these instead of hardcoded
 *      constants.
 *   2. Performance levels — the ordered, per-assessment levels (best → lowest),
 *      each with a `label` and a report `stars` mapping. The count is **not
 *      fixed**: the engine handles N levels.
 *   3. Award levels — the ordered, overall awards (best → lowest), each with a
 *      `label`. Again **N awards, not fixed at four**.
 *   4. Default cut-points reference the level/award sets above by position
 *      (length = levels − 1; the lowest level is the implicit remainder). The
 *      *live* per-cycle cut-points live with the boundary state; these are the
 *      defaults a new scope starts from.
 *
 * ## Parity guarantee (read before editing the defaults)
 *
 * `DEFAULT_SCORING_CONFIG` reproduces the engine's previous hardcoded behaviour
 * exactly. The parity test (`tests/engine.parity.test.ts`) runs against this
 * default, so it stays byte-identical (177/177). Changing a default value here
 * would move the parity baseline — don't, unless the published statistics
 * themselves change. Non-default configs are exercised by
 * `tests/engine.config.test.ts`.
 *
 * This module is framework-free and has no dependencies beyond the engine's own
 * domain types, so it travels with the engine across the Python swap.
 */

import type { QualityRating } from "./types";

/** Good/Review/Flag bands for the p-value (a two-sided difficulty band). */
export interface PValueThresholds {
  /** p < flagBelow → Flag (too hard). */
  flagBelow: number;
  /** p < reviewBelow → Review (hard). */
  reviewBelow: number;
  /** p ≤ goodUpTo → Good. */
  goodUpTo: number;
  /** p ≤ reviewUpTo → Review (easy); above → Flag (too easy). */
  reviewUpTo: number;
}

/** Good/Review/Flag bands for a correlation-type statistic (one-sided). */
export interface CorrelationThresholds {
  /** value < flagBelow, or undefined (zero variance), → Flag. */
  flagBelow: number;
  /** value < reviewBelow → Review; at or above → Good. */
  reviewBelow: number;
}

export interface QualityThresholds {
  pValue: PValueThresholds;
  itemTotal: CorrelationThresholds;
  pointBiserial: CorrelationThresholds;
  discrimination: CorrelationThresholds;
}

/** One performance level: a label plus the report star string derived from it. */
export interface PerformanceLevelDef {
  label: string;
  stars: string;
}

/** One overall award level: a label. */
export interface AwardLevelDef {
  label: string;
}

export interface ScoringConfig {
  /** Item-quality Good/Review/Flag thresholds. */
  quality: QualityThresholds;
  /** Per-assessment performance levels, best → lowest (length L). */
  performanceLevels: PerformanceLevelDef[];
  /** Overall award levels, best → lowest (length M). */
  awardLevels: AwardLevelDef[];
  /** Default per-assessment cut-points (length L−1), min score per non-lowest level. */
  performanceCuts: number[];
  /** Default overall-award cut-points (length M−1). */
  awardCuts: number[];
}

/**
 * The default config — reproduces the engine's previous hardcoded behaviour
 * exactly. The parity test pins the maths against this; treat the values as the
 * verified baseline, not as editable knobs.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  quality: {
    // p-value: <0.20 Flag · <0.30 Review · ≤0.85 Good · ≤0.90 Review · else Flag
    pValue: { flagBelow: 0.2, reviewBelow: 0.3, goodUpTo: 0.85, reviewUpTo: 0.9 },
    // item-total / point-biserial / discrimination:
    //   undefined → Flag · <0.10 Flag · <0.30 Review · else Good
    itemTotal: { flagBelow: 0.1, reviewBelow: 0.3 },
    pointBiserial: { flagBelow: 0.1, reviewBelow: 0.3 },
    discrimination: { flagBelow: 0.1, reviewBelow: 0.3 },
  },
  performanceLevels: [
    { label: "Outstanding performance", stars: "***" },
    { label: "Exceeds expectations", stars: "**" },
    { label: "Meets expectations", stars: "*" },
    { label: "Doesn't yet meet expectations", stars: "" },
  ],
  awardLevels: [
    { label: "Distinction award" },
    { label: "Advanced achievement award" },
    { label: "Secondary achievement award" },
    { label: "No Award" },
  ],
  performanceCuts: [78, 58, 40], // Outstanding / Exceeds / Meets
  awardCuts: [75, 55, 35], // Distinction / Advanced / Secondary
};

/** A fresh, deeply-cloned copy of the default config (safe to mutate). */
export function defaultScoringConfig(): ScoringConfig {
  return {
    quality: {
      pValue: { ...DEFAULT_SCORING_CONFIG.quality.pValue },
      itemTotal: { ...DEFAULT_SCORING_CONFIG.quality.itemTotal },
      pointBiserial: { ...DEFAULT_SCORING_CONFIG.quality.pointBiserial },
      discrimination: { ...DEFAULT_SCORING_CONFIG.quality.discrimination },
    },
    performanceLevels: DEFAULT_SCORING_CONFIG.performanceLevels.map((l) => ({ ...l })),
    awardLevels: DEFAULT_SCORING_CONFIG.awardLevels.map((l) => ({ ...l })),
    performanceCuts: [...DEFAULT_SCORING_CONFIG.performanceCuts],
    awardCuts: [...DEFAULT_SCORING_CONFIG.awardCuts],
  };
}

// --- rating (item quality) ---------------------------------------------------

/** Rating for the p-value (difficulty), a two-sided band, read from config. */
export function rateP(p: number, t: PValueThresholds = DEFAULT_SCORING_CONFIG.quality.pValue): QualityRating {
  if (p < t.flagBelow) return "Flag";
  if (p < t.reviewBelow) return "Review";
  if (p <= t.goodUpTo) return "Good";
  if (p <= t.reviewUpTo) return "Review";
  return "Flag";
}

/** Rating for item-total / point-biserial / discrimination, read from config. */
export function rateCorrelation(
  value: number | null,
  t: CorrelationThresholds = DEFAULT_SCORING_CONFIG.quality.itemTotal,
): QualityRating {
  if (value === null || Number.isNaN(value)) return "Flag";
  if (value < t.flagBelow) return "Flag";
  if (value < t.reviewBelow) return "Review";
  return "Good";
}

// --- classification (score → level / award) ----------------------------------

/**
 * Classify a score into a level from the configured ordered set. `labels` is
 * best → lowest (length L); `cuts` is length L−1, where `cuts[i]` is the minimum
 * score for `labels[i]`. The lowest level is the implicit remainder. No level
 * names or counts are hardcoded — both come from the configured set.
 */
export function classifyByCuts(score: number, labels: readonly string[], cuts: readonly number[]): string {
  for (let i = 0; i < cuts.length; i++) {
    if (score >= (cuts[i] ?? 0)) return labels[i] ?? labels[labels.length - 1] ?? "";
  }
  return labels[labels.length - 1] ?? "";
}

/** Convenience: the ordered performance-level labels from a config. */
export function performanceLabels(cfg: ScoringConfig): string[] {
  return cfg.performanceLevels.map((l) => l.label);
}

/** Convenience: the ordered award-level labels from a config. */
export function awardLabels(cfg: ScoringConfig): string[] {
  return cfg.awardLevels.map((l) => l.label);
}

/** Convenience: the level → stars map from a config. */
export function starMapOf(cfg: ScoringConfig): Record<string, string> {
  return Object.fromEntries(cfg.performanceLevels.map((l) => [l.label, l.stars]));
}
