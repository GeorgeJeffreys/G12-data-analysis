/**
 * Item statistics — the transparent TypeScript port of the analyst's validated
 * psychometric notebook (the four measures and their Good/Review/Flag ratings).
 *
 * The formulae below are ported **verbatim** from that notebook — the notebook is
 * the oracle. They are verified cell-for-cell against the analyst's published
 * outputs in `data/parity_fixtures.json`: this reproduces the p-value, corrected
 * item-total correlation, point-biserial correlation and discrimination for every
 * item across the five assessments exactly (see tests/engine.parity.test.ts). That
 * is the parity/trust gate.
 *
 * ## The score matrix (built per assessment, over cleaned MCQ items)
 * rows = students (the stable internal unique id from P-A), cols = QuestionId,
 * value = AnswerScore. Duplicate `(student, QuestionId)` rows are collapsed keeping
 * the **last** row; missing cells are filled with 0.0 (`fillna(0.0)`). Each
 * student's `total` is the row sum over the fillna'd matrix.
 *
 * ## Definitions (dichotomous 0/1 items; identical formulae for 0..1 part-marks)
 *   p-value         = mean of the item's scores across ALL students.
 *   item-total (IT-R)      = Pearson(item score, total EXCLUDING the item)  [corrected]
 *   point-biserial (PT-BIS) = Pearson(item score, full total INCLUDING the item)
 *   discrimination  = mean(upper group) − mean(lower group), where the group size
 *                     is `discriminationGroupSize(n)` and students are ranked
 *                     ASCENDING by (corrected total, full total, id): the lower
 *                     group is the head, the upper group is the tail.
 * IT-R and PT-BIS are defined to TRACK: PT-BIS uses the total including the item,
 * IT-R the total excluding it, so PT-BIS ≥ IT-R and the gap is small and positive
 * (see tests/engine.item-stats.notebook.test.ts).
 *
 * ## Pearson helper
 * Returns NaN (null here) when there are fewer than 3 valid pairs, or when either
 * series has zero variance — both are treated downstream as an undefined
 * correlation (a Flag), never as 0.
 *
 * Ratings (verified default thresholds, now read from `ScoringConfig.quality`):
 *   p-value: <0.20 Flag · <0.30 Review · ≤0.85 Good · ≤0.90 Review · else Flag
 *   item-total / point-biserial / discrimination:
 *           undefined (zero variance) → Flag · <0.10 Flag · <0.30 Review · else Good
 *   overall = worst of the four (Flag > Review > Good).
 * The defaults reproduce the published behaviour exactly (parity gate); a
 * non-default `ScoringConfig` re-rates items per its bands (see ./config).
 */

import type {
  ItemMeta,
  ItemStat,
  QualityRating,
  ResponseRecord,
} from "./types";
import {
  DEFAULT_SCORING_CONFIG,
  rateCorrelation,
  rateP,
  type ScoringConfig,
} from "./config";

const RATING_SEVERITY: Record<QualityRating, number> = {
  Good: 0,
  Review: 1,
  Flag: 2,
};

/** Round to a fixed number of decimals (half-up), avoiding -0. */
export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r;
}

/**
 * Pearson product-moment correlation. Returns null (the analyst's NaN) when there
 * are fewer than 3 valid pairs, or when either variable has zero variance — both
 * mean the correlation is undefined, which the published pipeline treats as a
 * Flag.
 */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n < 3 || y.length !== n) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] as number;
    const yi = y[i] as number;
    sx += xi;
    sy += yi;
    sxx += xi * xi;
    syy += yi * yi;
    sxy += xi * yi;
  }
  const denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (denom === 0) return null;
  return (n * sxy - sx * sy) / denom;
}

// The Good/Review/Flag bands for the four statistics are no longer hardcoded
// here — they come from `ScoringConfig.quality` (see ./config). `rateP` and
// `rateCorrelation` are re-exported for callers that still import them from the
// engine surface; with the default thresholds they behave exactly as before.
export { rateP, rateCorrelation };

/** Worst-of severity across the four per-statistic ratings. */
export function worstRating(ratings: QualityRating[]): QualityRating {
  let worst: QualityRating = "Good";
  for (const r of ratings) {
    if (RATING_SEVERITY[r] > RATING_SEVERITY[worst]) worst = r;
  }
  return worst;
}

interface ParticipantRow {
  participantId: string;
  score: number;
  /** Full total across all of this participant's responses in the assessment. */
  total: number;
  /** Corrected total = total minus this item's score. */
  rest: number;
}

/**
 * Upper/lower group size for the discrimination index, ported verbatim from the
 * analyst's validated notebook:
 *
 *   group_size = max(1, min(n // 2, round(n * 0.33)))
 *   if n >= 9:  group_size = max(3, group_size)
 *
 * For the Applicable Math cohort (n = 15) this resolves to 5 (top 5 vs bottom 5).
 */
export function discriminationGroupSize(n: number): number {
  let g = Math.max(1, Math.min(Math.floor(n / 2), Math.round(n * 0.33)));
  if (n >= 9) g = Math.max(3, g);
  return g;
}

/**
 * Discrimination index: mean item score of the upper group minus the lower group.
 * Students are ranked ASCENDING by (corrected total, full total, id) — exactly as
 * the analyst's notebook does — so the lower group is the head and the upper group
 * is the tail. `id` is a final, result-neutral tiebreak for determinism.
 */
function discrimination(rows: ParticipantRow[]): number {
  const n = rows.length;
  const g = discriminationGroupSize(n);
  const ranked = [...rows].sort(
    (a, b) =>
      a.rest - b.rest ||
      a.total - b.total ||
      (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0),
  );
  const lower = ranked.slice(0, g);
  const upper = ranked.slice(n - g);
  const mean = (group: ParticipantRow[]) =>
    group.reduce((acc, r) => acc + r.score, 0) / group.length;
  return mean(upper) - mean(lower);
}

/**
 * Compute item statistics for a set of responses. Responses are grouped by
 * assessment (the total score is per-assessment); each item's statistics use
 * only the participants who answered that item, with totals taken over each
 * participant's responses within the assessment.
 */
export function computeItemStats(
  responses: readonly ResponseRecord[],
  engineVersion: string,
  items?: readonly ItemMeta[],
  scoringConfig: ScoringConfig = DEFAULT_SCORING_CONFIG,
): ItemStat[] {
  const q = scoringConfig.quality;
  const metaByItem = new Map<string, ItemMeta>();
  if (items) for (const it of items) metaByItem.set(it.itemId, it);

  // Group responses by assessment.
  const byAssessment = new Map<string, ResponseRecord[]>();
  for (const r of responses) {
    let bucket = byAssessment.get(r.assessmentId);
    if (!bucket) {
      bucket = [];
      byAssessment.set(r.assessmentId, bucket);
    }
    bucket.push(r);
  }

  const out: ItemStat[] = [];

  for (const [assessmentId, recs] of byAssessment) {
    // Build the score matrix: rows = students (unique id), cols = QuestionId,
    // value = AnswerScore. Deduplicate (student, item) keeping the LAST row, then
    // fillna(0.0) over the full student × item grid. Student/item order is
    // first-seen (result-neutral; the maths is order-independent and
    // discrimination re-sorts explicitly). This is the analyst's validated matrix.
    const studentOrder: string[] = [];
    const itemOrder: string[] = [];
    const seenStudent = new Set<string>();
    const seenItem = new Set<string>();
    const cell = new Map<string, Map<string, number>>(); // student -> item -> score
    for (const r of recs) {
      if (!seenStudent.has(r.participantId)) {
        seenStudent.add(r.participantId);
        studentOrder.push(r.participantId);
      }
      if (!seenItem.has(r.itemId)) {
        seenItem.add(r.itemId);
        itemOrder.push(r.itemId);
      }
      let row = cell.get(r.participantId);
      if (!row) {
        row = new Map();
        cell.set(r.participantId, row);
      }
      row.set(r.itemId, r.score); // last write wins
    }

    // Per-student total = row sum over the fillna(0) matrix.
    const totalByParticipant = new Map<string, number>();
    for (const student of studentOrder) {
      const row = cell.get(student)!;
      let t = 0;
      for (const itemId of itemOrder) t += row.get(itemId) ?? 0;
      totalByParticipant.set(student, t);
    }

    for (const itemId of itemOrder) {
      const rows: ParticipantRow[] = studentOrder.map((student) => {
        const score = cell.get(student)!.get(itemId) ?? 0; // fillna(0.0)
        const total = totalByParticipant.get(student)!;
        return {
          participantId: student,
          score,
          total,
          rest: total - score,
        };
      });

      const n = rows.length;
      const scores = rows.map((r) => r.score);
      const totals = rows.map((r) => r.total);
      const rests = rows.map((r) => r.rest);

      const pValue = scores.reduce((a, b) => a + b, 0) / n;
      const itemTotal = pearson(scores, rests);
      const pointBiserial = pearson(scores, totals);
      const disc = discrimination(rows);

      const pRating = rateP(pValue, q.pValue);
      const itRating = rateCorrelation(itemTotal, q.itemTotal);
      const pbRating = rateCorrelation(pointBiserial, q.pointBiserial);
      const discRating = rateCorrelation(disc, q.discrimination);
      const overallReview = worstRating([pRating, itRating, pbRating, discRating]);

      const meta = metaByItem.get(itemId);
      out.push({
        itemId,
        assessmentId,
        n,
        pValue: round(pValue, 3),
        pRating,
        itemTotal: itemTotal === null ? null : round(itemTotal, 3),
        itRating,
        pointBiserial: pointBiserial === null ? null : round(pointBiserial, 3),
        pbRating,
        discrimination: round(disc, 3),
        discRating,
        overallReview,
        wording: meta?.wording ?? null,
        majorElement: meta?.majorElement ?? null,
        subElement: meta?.subElement ?? null,
        demandLevel: meta?.demandLevel ?? null,
        engineVersion,
      });
    }
  }

  return out;
}
