/**
 * Suggested cut-scores — backsolve provisional per-subject cut-points from a
 * target band distribution, then apply the policy numeric guard-rails.
 *
 * Source of truth: the confirmed logic spec (Standard-Setting Policy Stance
 * v1.0). Slide 14 fixes the hard numeric guard-rails (floor 25% / ceiling 90%
 * of a subject's total max); the indicative band ranges seed the default
 * target distribution.
 *
 * This module is PURE and DETERMINISTIC. It CONSUMES a per-subject score
 * distribution + target proportions and PRODUCES suggested cut-points. It does
 * NOT compute raw scores or item statistics, so engine parity is unaffected.
 *
 * Everything works in PERCENT space (0..100), matching the rest of the boundary
 * model: a "cut" is the minimum percent-of-max to be IN a level (score ≥ cut =
 * in the level), and the guard-rails (≥ 25% / ≤ 90% of subject max) map directly
 * onto it. Callers that want a raw cut-score multiply by the subject's max.
 *
 * LANE NOTE (Wave 3b): this is the cut-score lane only. It does NOT derive the
 * overall award and does NOT apply a per-student Distinction cap — both belong
 * to Wave 3a. The ½-D3 logic here is a COHORT-LEVEL sanity check on the
 * Outstanding cut, surfaced as a warning, never a silent clamp.
 */

/** Hard numeric guard-rails (percent of subject total max). Policy slide 14. */
export interface GuardrailBounds {
  /** Floor: a cut may not sit below this % of max. */
  floorPct: number;
  /** Ceiling: a cut may not sit above this % of max. */
  ceilingPct: number;
}

export const POLICY_GUARDRAILS: GuardrailBounds = { floorPct: 25, ceilingPct: 90 };

/**
 * Policy indicative band ranges (percent of cohort), best → lowest:
 *   ★★★ Outstanding 10–20%, ★★ Exceeds 15–25%, ★ Meets 40–60%, no-star 5–20%.
 * The default target distribution uses the midpoint of each of the top three
 * bands (the lowest band is always the remainder).
 */
export const POLICY_BAND_RANGES: { min: number; max: number }[] = [
  { min: 10, max: 20 }, // ★★★ Outstanding
  { min: 15, max: 25 }, // ★★ Exceeds
  { min: 40, max: 60 }, // ★ Meets
  { min: 5, max: 20 }, // no-star Doesn't-meet
];

/** Midpoint default for the top three bands → [15, 20, 50]. */
export const DEFAULT_POLICY_TARGETS: number[] = POLICY_BAND_RANGES.slice(0, 3).map(
  (r) => Math.round((r.min + r.max) / 2),
);

/** Per-cut working: how a single suggested cut was arrived at. */
export interface PerCutSuggestion {
  /** Index in the cut array (0 = the top band's cut, e.g. Outstanding). */
  index: number;
  /** Distribution-suggested cut BEFORE guard-rails (percent). */
  distributionCut: number;
  /** Final suggested cut AFTER guard-rails (percent). */
  cut: number;
  /** Target % for the band this cut opens (band[index]). */
  targetPct: number;
  /** Target student count for that band (rounded), for reference. */
  targetCount: number;
  /** Nearest-achievable band % given the final cut. */
  achievedPct: number;
  /** Nearest-achievable band student count given the final cut. */
  achievedCount: number;
  /**
   * Guard-rail clamp, when the distribution value fell outside [floor, ceiling]
   * (or the monotonic-order repair moved it). `from`/`to` are percents.
   */
  clamp: { from: number; to: number; bound: "floor" | "ceiling" | "order" } | null;
  /**
   * Tie clump: ≥ 2 students sit on exactly the cut score AND that clump forced
   * the band size off its target (a finer cut is impossible without splitting
   * students who share a raw score). Surfaced so the panel sees the gap.
   */
  tie: { atScore: number; count: number } | null;
}

export interface BacksolveResult {
  /** Final suggested cuts (post guard-rail, monotonic non-increasing), length L−1. */
  cuts: number[];
  /** Distribution-suggested cuts BEFORE guard-rails, length L−1. */
  distributionCuts: number[];
  /** Per-cut working, aligned to `cuts`. */
  perCut: PerCutSuggestion[];
  /** Achieved % per band, top → lowest (length L; the last is the remainder). */
  bandPctAchieved: number[];
  /** Achieved student counts per band, top → lowest (length L). */
  bandCountAchieved: number[];
  /** Cohort size used. */
  n: number;
}

/** Build the integer-resolution histogram + cumulative-from-top accessor. */
function cohortCounts(scoresPct: number[]): {
  counts: number[];
  atOrAbove: (cut: number) => number;
  n: number;
} {
  const counts = new Array(101).fill(0) as number[];
  for (const p of scoresPct) {
    const ci = Math.max(0, Math.min(100, Math.round(p)));
    counts[ci] = (counts[ci] ?? 0) + 1;
  }
  const atAbove = new Array(102).fill(0) as number[];
  for (let s = 100; s >= 0; s--) atAbove[s] = atAbove[s + 1]! + counts[s]!;
  const atOrAbove = (cut: number) => atAbove[Math.max(0, Math.min(100, Math.round(cut)))]!;
  return { counts, atOrAbove, n: scoresPct.length };
}

/**
 * Find the integer cut (percent) whose cumulative-from-top count is closest to
 * `want`. TIE RULE (stated + consistent): when two adjacent cut positions are
 * equidistant from the target, prefer the HIGHER cut — i.e. the more selective
 * boundary, the smaller band. Students sharing a raw score always move together
 * (a cut can never split a clump), which is why exact targets are rarely hit at
 * small cohort sizes.
 */
function nearestCut(want: number, atOrAbove: (cut: number) => number): number {
  let best = 0;
  let bestDist = Infinity;
  // Scan low → high; use `<=` on the higher score so equidistant ties resolve to
  // the higher (more selective) cut.
  for (let s = 0; s <= 100; s++) {
    const d = Math.abs(atOrAbove(s) - want);
    if (d <= bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/**
 * Backsolve per-subject cut-points from a target distribution, then clamp to the
 * policy guard-rails. `targets` are the cohort-% for the top L−1 bands
 * (top → bottom); the lowest band is the remainder. Returns the suggested cuts
 * plus the honest target-vs-achieved working for each cut.
 */
export function backsolveCuts(
  scoresPct: number[],
  targets: number[],
  bounds: GuardrailBounds = POLICY_GUARDRAILS,
): BacksolveResult {
  const { counts, atOrAbove, n } = cohortCounts(scoresPct);
  const L = targets.length + 1; // bands incl. the remainder

  // 1) Distribution cuts from cumulative-from-top targets.
  const distributionCuts: number[] = [];
  let cumPct = 0;
  for (let i = 0; i < targets.length; i++) {
    cumPct += Number(targets[i]) || 0;
    const want = (cumPct / 100) * n;
    distributionCuts.push(nearestCut(want, atOrAbove));
  }

  // 2) Guard-rails: clamp each cut into [floor, ceiling]; then repair the
  //    monotonic (strictly-descending intent, ties allowed) order so a raised
  //    floor on a lower band never overtakes a higher band's cut.
  const floor = Math.round(bounds.floorPct);
  const ceil = Math.round(bounds.ceilingPct);
  const cuts: number[] = [];
  const clamps: PerCutSuggestion["clamp"][] = [];
  for (let i = 0; i < distributionCuts.length; i++) {
    const raw = distributionCuts[i]!;
    let v = raw;
    let clamp: PerCutSuggestion["clamp"] = null;
    if (v < floor) {
      clamp = { from: raw, to: floor, bound: "floor" };
      v = floor;
    } else if (v > ceil) {
      clamp = { from: raw, to: ceil, bound: "ceiling" };
      v = ceil;
    }
    // Order repair: cut[i] must not exceed cut[i-1] (top band has the highest cut).
    if (i > 0 && v > cuts[i - 1]!) {
      const before = v;
      v = cuts[i - 1]!;
      if (!clamp) clamp = { from: before, to: v, bound: "order" };
      else clamp = { from: clamp.from, to: v, bound: clamp.bound };
    }
    cuts.push(v);
    clamps.push(clamp);
  }

  // 3) Achieved band sizes from the FINAL cuts.
  const bandCountAchieved: number[] = [];
  for (let i = 0; i < L; i++) {
    let students: number;
    if (i === 0) students = atOrAbove(cuts[0] ?? 0);
    else if (i === L - 1) students = n - atOrAbove(cuts[i - 1] ?? 0);
    else students = atOrAbove(cuts[i] ?? 0) - atOrAbove(cuts[i - 1] ?? 0);
    bandCountAchieved.push(students);
  }
  const bandPctAchieved = bandCountAchieved.map((c) => (n ? (c / n) * 100 : 0));

  // 4) Per-cut working incl. tie detection. The clump on a cut score belongs to
  //    that cut's band (score ≥ cut = in the band). A tie is flagged when ≥ 2
  //    students share the cut score AND the band missed its rounded target — the
  //    clump is what pushed it off.
  const perCut: PerCutSuggestion[] = cuts.map((cut, i) => {
    const targetPct = Number(targets[i]) || 0;
    const targetCount = Math.round((targetPct / 100) * n);
    const achievedCount = bandCountAchieved[i]!;
    const clumpAt = Math.max(0, Math.min(100, Math.round(cut)));
    const clumpCount = counts[clumpAt] ?? 0;
    const tie =
      clumpCount >= 2 && achievedCount !== targetCount
        ? { atScore: clumpAt, count: clumpCount }
        : null;
    return {
      index: i,
      distributionCut: distributionCuts[i]!,
      cut,
      targetPct,
      targetCount,
      achievedPct: bandPctAchieved[i]!,
      achievedCount,
      clamp: clamps[i]!,
      tie,
    };
  });

  return { cuts, distributionCuts, perCut, bandPctAchieved, bandCountAchieved, n };
}

/**
 * Cohort-level ½-D3 sanity check on the Outstanding cut.
 *
 * Policy requires the Outstanding cut to be high enough that clearing it implies
 * a student got ≥ ½ of the D3 (top-difficulty) items correct. This is the
 * COHORT-level check (a warning), NOT the per-student hard cap — that cap is
 * Wave 3a's per-student Distinction safeguard.
 *
 * CONFIRM — contested methodology nuance: the exact reading of "cut implies ½-D3"
 * is not nailed down in the source. The interpretation implemented here is the
 * most defensible literal one: look at the students who actually CLEAR the
 * Outstanding cut and ask whether they all reached ≥ ½ of the D3 items correct.
 * If any cleared the cut WITHOUT ≥ ½ D3 correct, the cut is "reachable without
 * the D3 evidence" and we warn. The exact threshold (≥ ½ → ceil(D3/2)) and
 * whether "correct" means full marks are flagged for human confirmation rather
 * than baked into a hard rule. Surface, don't enforce.
 */
export interface D3HalfCheckResult {
  /** Number of D3 (top-difficulty) items in the subject. */
  d3Total: number;
  /** ≥ ½ threshold used = ceil(d3Total / 2). */
  halfThreshold: number;
  /** Students at/above the Outstanding cut. */
  outstandingCount: number;
  /** Of those, how many fell short of the ½-D3 threshold. */
  belowHalf: number;
  /** True when every Outstanding student cleared ≥ ½ D3 correct (or no basis to judge). */
  consistent: boolean;
  /** Human copy describing the (flagged-for-confirmation) interpretation. */
  note: string;
}

export function checkOutstandingHalfD3(
  /** D3-correct count for each student who clears the Outstanding cut. */
  outstandingD3Correct: number[],
  /** Total D3 items in the subject. */
  d3Total: number,
): D3HalfCheckResult {
  const halfThreshold = Math.ceil(d3Total / 2);
  const outstandingCount = outstandingD3Correct.length;
  const belowHalf =
    d3Total > 0 ? outstandingD3Correct.filter((c) => c < halfThreshold).length : 0;
  // No D3 items, or no students at the top: nothing to contradict → treat as
  // consistent (the warning only fires on positive evidence of inconsistency).
  const consistent = d3Total === 0 || outstandingCount === 0 || belowHalf === 0;
  const note =
    d3Total === 0
      ? "No D3 (top-difficulty) items in this subject — ½-D3 check not applicable."
      : `Interpretation (CONFIRM): of ${outstandingCount} student(s) clearing the Outstanding cut, ` +
        `${belowHalf} reached fewer than ${halfThreshold}/${d3Total} D3 items correct. ` +
        `The exact "cut implies ½-D3" rule is a methodology nuance — confirm before relying on it.`;
  return { d3Total, halfThreshold, outstandingCount, belowHalf, consistent, note };
}
