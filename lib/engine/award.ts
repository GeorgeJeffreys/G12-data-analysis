/**
 * Award derivation — the deterministic Layer-2 rule (Standard-Setting Policy
 * Stance v1.0) plus the per-student D3-majority cap (Layer 1b).
 *
 * This module is the single source of truth for **what award a student receives
 * given the pattern of their five subject performance levels**. It replaces the
 * long-standing `// CONFIRM:` placeholder that derived the award from a cut on an
 * overall score. It decides real students' awards — every clause below mirrors
 * the confirmed spec exactly and is pinned by named tests
 * (`tests/engine.award.test.ts`).
 *
 * Two layers (the engine only owns Layer 2 + the D3 cap; Layer 1 — score →
 * per-subject level — is `classifyByCuts`):
 *
 *   Layer 1  score → one of four per-subject performance levels via 3 cut-scores.
 *   Layer 2  the pattern of the five subject levels → one overall award, by the
 *            deterministic lookup in `deriveAward` (NOT a cut on an overall score).
 *
 * Framework-free, no dependencies — it travels with the engine across the Python
 * swap, exactly like `config.ts`.
 */

// --- D3-majority rule (Layer 1b, per-student cap) ----------------------------

/**
 * The number of D3 items a student must answer **correctly** to clear the
 * majority bar, given how many D3 items are **available** on the exam.
 *
 * "Majority of available" = strictly more than half of the D3 items that exist
 * (recomputed per exam after any item exclusions). Examples from the spec:
 *   7 available → 4 ·  6 available → 4 ·  5 available → 3.
 * With no D3 items the bar is 0 (vacuously satisfied).
 */
export function d3MajorityThreshold(available: number): number {
  if (available <= 0) return 0;
  return Math.floor(available / 2) + 1;
}

/**
 * Does a student clear the D3 majority? It is **correct answers** (not attempts)
 * measured against **total available D3 items** (not the number attempted). An
 * exam with no D3 items cannot deny anyone, so it passes vacuously.
 */
export function passesD3Majority(correct: number, available: number): boolean {
  if (available <= 0) return true;
  return correct >= d3MajorityThreshold(available);
}

// --- Award rule (Layer 2) ----------------------------------------------------

export interface AwardRuleConfig {
  /** Per-subject performance levels, best → lowest (length L; the canonical set has 4). */
  performanceLevels: readonly string[];
  /** Overall award levels, best → lowest. The rule expects four tiers, by position:
   *  [0] Distinction · [1] Advanced · [2] Secondary · [3] No Award. */
  awardLevels: readonly string[];
}

export interface AwardInput {
  /** One per-subject performance-level label per subject (typically five). */
  subjectLevels: readonly string[];
  /**
   * Whether the student cleared the per-student D3-majority cap (Layer 1b),
   * across every exam that carries D3 items. A Lead override is folded in by the
   * caller (an overridden student passes). Defaults to true (no D3 data → no cap).
   */
  d3Pass?: boolean;
}

/** The counts the decision is made on, surfaced for diagnostics / the working. */
export interface AwardCounts {
  /** Subjects at the top level (★★★ Outstanding). */
  outstanding: number;
  /** Subjects at ★★ Exceeds or better. */
  exceedsOrBetter: number;
  /** Subjects at ★ Meets or better (i.e. any starred level — not the lowest band). */
  meetsOrBetter: number;
  /** Total subjects considered. */
  total: number;
}

export interface AwardOutcome {
  /** The awarded level label (from `awardLevels`). */
  award: string;
  /**
   * True when the level pattern qualified for Distinction but the D3 cap denied
   * it, so the award fell through to a lower tier. Drives the visible "why".
   */
  d3Capped: boolean;
  counts: AwardCounts;
}

/**
 * Rank a performance-level label within the configured set (0 = best). Anything
 * unrecognised or blank (e.g. a subject the student did not sit) ranks as the
 * lowest band — conservatively failing the "≥ Meets" clauses.
 */
function rankOf(level: string, levels: readonly string[]): number {
  const i = levels.indexOf(level);
  return i < 0 ? Math.max(0, levels.length - 1) : i;
}

/**
 * Derive the overall award from the pattern of subject performance levels, plus
 * the per-student D3 cap. Evaluated **highest → lowest, stop at first match**:
 *
 *   1. Distinction — ★★★ Outstanding in ≥3 subjects AND ≥★ Meets in every
 *      remaining subject AND the student passes the D3 cap. A Distinction-pattern
 *      student who fails the D3 majority is NOT Distinction and falls through.
 *   2. Advanced    — ★★ Exceeds in ≥3 subjects.
 *   3. Secondary   — ★ Meets in ≥4 subjects.
 *   4. No Award    — otherwise.
 *
 * The Distinction conjunction is self-consistent: a no-star in any subject fails
 * the "≥★ in the rest" clause, so the student falls through with no extra
 * tie-break. Award tiers are read positionally from `awardLevels` (the canonical
 * four), so the vocabulary stays configurable.
 */
export function deriveAward(input: AwardInput, cfg: AwardRuleConfig): AwardOutcome {
  const { performanceLevels: levels, awardLevels: awards } = cfg;
  const L = levels.length;
  // Anchored mapping for the canonical 4-level set (and any L≥2):
  //   Outstanding      = rank 0           (top)
  //   Exceeds-or-better = rank ≤ 1        (top two)
  //   Meets-or-better   = rank ≤ L−2      (any starred level — not the lowest band)
  const ranks = input.subjectLevels.map((l) => rankOf(l, levels));
  const total = ranks.length;
  const outstanding = ranks.filter((r) => r === 0).length;
  const exceedsOrBetter = ranks.filter((r) => r <= 1).length;
  const meetsOrBetter = ranks.filter((r) => r <= L - 2).length;
  const counts: AwardCounts = { outstanding, exceedsOrBetter, meetsOrBetter, total };

  const d3Pass = input.d3Pass ?? true;
  // "≥★ Meets in every remaining subject" — with ≥3 Outstanding this is exactly
  // "every subject is at least Meets" (no subject in the lowest band).
  const distinctionPattern = outstanding >= 3 && meetsOrBetter === total;

  const distinction = awards[0] ?? "";
  const advanced = awards[1] ?? distinction;
  const secondary = awards[2] ?? advanced;
  const noAward = awards[3] ?? secondary;

  let award: string;
  if (distinctionPattern && d3Pass) award = distinction;
  else if (exceedsOrBetter >= 3) award = advanced;
  else if (meetsOrBetter >= 4) award = secondary;
  else award = noAward;

  return { award, d3Capped: distinctionPattern && !d3Pass, counts };
}

/**
 * Does this level pattern qualify for Distinction on the levels alone (ignoring
 * the D3 cap)? Used to decide who is "in line for Distinction" — the candidates
 * the D3 safeguard then checks.
 */
export function qualifiesForDistinctionByLevels(
  subjectLevels: readonly string[],
  levels: readonly string[],
): boolean {
  const L = levels.length;
  const ranks = subjectLevels.map((l) => rankOf(l, levels));
  const outstanding = ranks.filter((r) => r === 0).length;
  const meetsOrBetter = ranks.filter((r) => r <= L - 2).length;
  return outstanding >= 3 && meetsOrBetter === ranks.length;
}
