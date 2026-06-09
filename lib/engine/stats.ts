/**
 * Item statistics — the transparent TypeScript implementation of the four
 * psychometric measures and their Good/Review/Flag ratings.
 *
 * The maths here was reverse-engineered and verified cell-for-cell against the
 * data scientist's published outputs in `data/parity_fixtures.json`: it
 * reproduces the p-value, corrected item-total correlation, point-biserial
 * correlation and discrimination for all 177 items across the five assessments
 * exactly (see tests/engine.parity.test.ts). This is the parity/trust gate.
 *
 * Verified definitions (dichotomous 0/1 items):
 *   p-value         = mean item score.
 *   item-total      = Pearson(item score, total of the OTHER items)   [corrected]
 *   point-biserial  = Pearson(item score, full total incl. the item)
 *   discrimination  = mean(upper group) - mean(lower group), where the groups
 *                     are the top/bottom g = round(n/3) participants ranked by
 *                     the corrected (item-excluded) total, descending, with ties
 *                     broken by the full total descending.
 *
 * Ratings (verified thresholds):
 *   p-value: <0.20 Flag · <0.30 Review · ≤0.85 Good · ≤0.90 Review · else Flag
 *   item-total / point-biserial / discrimination:
 *           undefined (zero variance) → Flag · <0.10 Flag · <0.30 Review · else Good
 *   overall = worst of the four (Flag > Review > Good).
 */

import type {
  ItemMeta,
  ItemStat,
  QualityRating,
  ResponseRecord,
} from "./types";

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
 * Pearson product-moment correlation. Returns null when either variable has
 * zero variance (the correlation is undefined), which the published pipeline
 * treats as a Flag.
 */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n === 0 || y.length !== n) return null;
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

/** Rating for the p-value (difficulty), a two-sided band. */
export function rateP(p: number): QualityRating {
  if (p < 0.2) return "Flag";
  if (p < 0.3) return "Review";
  if (p <= 0.85) return "Good";
  if (p <= 0.9) return "Review";
  return "Flag";
}

/** Rating for item-total / point-biserial / discrimination. */
export function rateCorrelation(value: number | null): QualityRating {
  if (value === null || Number.isNaN(value)) return "Flag";
  if (value < 0.1) return "Flag";
  if (value < 0.3) return "Review";
  return "Good";
}

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
 * Discrimination index: proportion correct in the upper group minus the lower
 * group, where groups are the top/bottom g = round(n/3) participants ranked by
 * the corrected (item-excluded) total descending, ties broken by full total
 * descending. participantId is a final, result-neutral tiebreak for
 * determinism.
 */
function discrimination(rows: ParticipantRow[]): number {
  const n = rows.length;
  const g = Math.max(1, Math.round(n / 3));
  const ranked = [...rows].sort(
    (a, b) =>
      b.rest - a.rest ||
      b.total - a.total ||
      (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0),
  );
  const upper = ranked.slice(0, g);
  const lower = ranked.slice(n - g);
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
): ItemStat[] {
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
    // Per-participant total within this assessment.
    const totalByParticipant = new Map<string, number>();
    for (const r of recs) {
      totalByParticipant.set(
        r.participantId,
        (totalByParticipant.get(r.participantId) ?? 0) + r.score,
      );
    }

    // Group this assessment's responses by item, preserving first-seen order.
    const byItem = new Map<string, ResponseRecord[]>();
    for (const r of recs) {
      let bucket = byItem.get(r.itemId);
      if (!bucket) {
        bucket = [];
        byItem.set(r.itemId, bucket);
      }
      bucket.push(r);
    }

    for (const [itemId, itemRecs] of byItem) {
      const rows: ParticipantRow[] = itemRecs.map((r) => {
        const total = totalByParticipant.get(r.participantId) ?? r.score;
        return {
          participantId: r.participantId,
          score: r.score,
          total,
          rest: total - r.score,
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

      const pRating = rateP(pValue);
      const itRating = rateCorrelation(itemTotal);
      const pbRating = rateCorrelation(pointBiserial);
      const discRating = rateCorrelation(disc);
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
        majorElement: meta?.majorElement ?? null,
        subElement: meta?.subElement ?? null,
        demandLevel: meta?.demandLevel ?? null,
        engineVersion,
      });
    }
  }

  return out;
}
