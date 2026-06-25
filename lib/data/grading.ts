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

/**
 * Borderline (marginal) flagging band — the configurable default (single source
 * of truth for the placeholder; the live value is a Settings config value).
 *
 * A student's subject score is flagged "borderline" when it sits within this many
 * **percentage points** below the cut score for the next grade up — i.e. they
 * just missed it, and a small upward mark adjustment would change the grade.
 * Flagging by percentage (rather than raw item count) is fairer across subjects
 * with different item totals, and is symmetric about the threshold in % space.
 *
 * This is a PLACEHOLDER of ±2% pending G12's policy value — it is editable in
 * Settings › Configuration, and the engine reads the live value, not this default.
 */
export const DEFAULT_BORDERLINE_BAND_PCT: number = 2;

/** Sensible bounds for the borderline band (percentage points). Enforced client-
 *  side, in the provider setter, AND server-side in `set_workspace_setting`. */
export const BORDERLINE_BAND_MIN: number = 0;
export const BORDERLINE_BAND_MAX: number = 20;

/** True when `pct` is a valid borderline band (numeric, within bounds). */
export function isValidBorderlineBand(pct: number): boolean {
  return Number.isFinite(pct) && pct >= BORDERLINE_BAND_MIN && pct <= BORDERLINE_BAND_MAX;
}

/** Clamp an incoming band to the valid range (defensive — invalid → default). */
export function clampBorderlineBand(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_BORDERLINE_BAND_PCT;
  return Math.min(BORDERLINE_BAND_MAX, Math.max(BORDERLINE_BAND_MIN, pct));
}

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

// The overall award is now the CONFIRMED Layer-2 rule: a deterministic lookup
// from the pattern of the five subject performance levels, plus the per-student
// D3-majority cap (see `lib/engine/award.ts` / `deriveAward`). It is NOT a cut on
// an overall score. These award cut-points remain only as defaults for the
// vestigial "overall" boundary scope; they no longer derive the award.
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

/**
 * @deprecated The overall award is no longer a cut on an overall score. Use the
 * engine's `deriveAward` (Layer-2 level-combination rule + D3 cap). Retained only
 * so the configurable award cut-points still type-check for the boundary scope.
 */
export function awardFor(score: number, awardLevels: string[], awardCuts: number[]): string {
  return classify(score, awardLevels, awardCuts);
}
