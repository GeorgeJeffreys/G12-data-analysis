/**
 * Grade vocabulary (Part A). The real named levels from the production output,
 * replacing the A–E placeholder used in the batch-1 screens.
 *
 *  - Per-assessment performance level (best → lowest): four bands → three cuts.
 *  - Overall award level (best → lowest): a separate four-band classification.
 *
 * The authoritative *defaults* for the vocabulary (labels, star mapping and
 * default cut-points) now live in the engine's `ScoringConfig`
 * (`@/lib/engine/config`) — the single source the scoring core reads. The
 * constants below are derived from it so there is exactly one definition; the
 * labels, star mapping and cut-points stay configurable through Settings →
 * Grading defaults (see GradingConfig), so nothing downstream hardcodes the band
 * names or thresholds.
 */

import {
  DEFAULT_SCORING_CONFIG,
  classifyByCuts,
  awardLabels,
  performanceLabels,
  starMapOf,
} from "@/lib/engine/config";

export const PERFORMANCE_LEVELS = performanceLabels(DEFAULT_SCORING_CONFIG);

export const AWARD_LEVELS = awardLabels(DEFAULT_SCORING_CONFIG);

/** Star mapping used in the performance reports (derived from level, never typed). */
export const DEFAULT_STAR_MAP: Record<string, string> = starMapOf(DEFAULT_SCORING_CONFIG);

/** Compact labels for tight UI (matrix pills, chart bands). */
export const AWARD_SHORT: Record<string, string> = {
  "Distinction award": "Distinction",
  "Advanced achievement award": "Advanced",
  "Secondary achievement award": "Secondary",
  "No Award": "No Award",
};

// Default cut-points = minimum score (percent) for each non-lowest band, top →
// bottom. Length is (levels − 1). These thresholds are placeholders and fully
// configurable; the *vocabulary* is what's authoritative here.
export const DEFAULT_PERFORMANCE_CUTS = [...DEFAULT_SCORING_CONFIG.performanceCuts]; // Outstanding / Exceeds / Meets
export const DEFAULT_PERFORMANCE_TARGETS = [15, 30, 35]; // cohort % for the top three bands

// CONFIRM: the real overall-award derivation rule is NOT in the source files.
// This default classifies the overall score into the four award levels using
// configurable cut-points (mirroring per-assessment banding). It is a
// placeholder rule, not a verified one — confirm with the assessment team.
export const DEFAULT_AWARD_CUTS = [...DEFAULT_SCORING_CONFIG.awardCuts]; // Distinction / Advanced / Secondary
export const DEFAULT_AWARD_TARGETS = [10, 25, 35];

export interface GradingConfig {
  /** Performance levels, best → lowest (length L). */
  performanceLevels: string[];
  /** Star string per performance level. */
  starMap: Record<string, string>;
  /** Award levels, best → lowest (length L). */
  awardLevels: string[];
  /** Default per-assessment cut-points (length L−1, min score per non-lowest band). */
  performanceCuts: number[];
  /** Default overall-award cut-points (length L−1). */
  awardCuts: number[];
}

export function defaultGradingConfig(): GradingConfig {
  return {
    performanceLevels: [...PERFORMANCE_LEVELS],
    starMap: { ...DEFAULT_STAR_MAP },
    awardLevels: [...AWARD_LEVELS],
    performanceCuts: [...DEFAULT_PERFORMANCE_CUTS],
    awardCuts: [...DEFAULT_AWARD_CUTS],
  };
}

/**
 * Classify a score into a level. `levels` is best → lowest (length L);
 * `cuts` is length L−1, where cuts[i] is the minimum score for levels[i]. The
 * lowest level is the implicit remainder.
 */
export function classify(score: number, levels: string[], cuts: number[]): string {
  return classifyByCuts(score, levels, cuts);
}

export function starsFor(level: string, starMap: Record<string, string>): string {
  return starMap[level] ?? "";
}

/** Overall award from an overall score (CONFIRM: placeholder rule — see above). */
export function awardFor(score: number, awardLevels: string[], awardCuts: number[]): string {
  return classify(score, awardLevels, awardCuts);
}
