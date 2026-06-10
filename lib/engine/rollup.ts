/**
 * Roll-ups for the dashboards: per-assessment summaries, mean score by major
 * element and by demand level, and a cohort distribution.
 *
 * Note on the interface (Section 8): the spec sketches `rollUp(participantScores)`,
 * but the by-major-element and by-demand-level breakdowns require item-level
 * scores and item metadata that participant totals do not carry. So `rollUp`
 * additionally takes the responses and item metadata. This is documented as a
 * deliberate, minor divergence in ARCHITECTURE.md.
 */

import { round } from "./stats";
import type {
  AssessmentRollup,
  DistributionBin,
  GroupMean,
  RollUp,
  RollUpInput,
} from "./types";

/** Build a 10-bucket (0–10, 10–20 … 90–100) histogram of percentages. */
function histogram(percentages: number[]): DistributionBin[] {
  const bins: DistributionBin[] = [];
  for (let i = 0; i < 10; i++) {
    bins.push({ from: i * 10, to: (i + 1) * 10, count: 0 });
  }
  for (const pct of percentages) {
    const clamped = Math.max(0, Math.min(100, pct));
    const idx = clamped === 100 ? 9 : Math.floor(clamped / 10);
    (bins[idx] as DistributionBin).count += 1;
  }
  return bins;
}

export function rollUp(input: RollUpInput): RollUp {
  const { participantScores, responses, items, excludedItemIds = [] } = input;
  const excluded = new Set(excludedItemIds);
  const metaByItem = new Map(items.map((it) => [it.itemId, it]));

  // --- by assessment --------------------------------------------------------
  const perAssessment = new Map<string, { rawSum: number; pctSum: number; count: number }>();
  for (const s of participantScores) {
    let e = perAssessment.get(s.assessmentId);
    if (!e) {
      e = { rawSum: 0, pctSum: 0, count: 0 };
      perAssessment.set(s.assessmentId, e);
    }
    e.rawSum += s.raw;
    e.pctSum += s.pct;
    e.count += 1;
  }
  const byAssessment: AssessmentRollup[] = [];
  for (const [assessmentId, e] of perAssessment) {
    byAssessment.push({
      assessmentId,
      participants: e.count,
      meanRaw: e.count > 0 ? round(e.rawSum / e.count, 3) : 0,
      meanPct: e.count > 0 ? round(e.pctSum / e.count, 2) : 0,
    });
  }

  // --- by major element / demand level (mean item score over retained items) -
  const groupMean = (keyOf: (itemId: string) => string | null | undefined): GroupMean[] => {
    const acc = new Map<string, { assessmentId: string; key: string; sum: number; n: number; items: Set<string> }>();
    for (const r of responses) {
      if (excluded.has(r.itemId)) continue;
      const key = keyOf(r.itemId);
      if (key == null || key === "") continue;
      const mapKey = `${r.assessmentId} ${key}`;
      let e = acc.get(mapKey);
      if (!e) {
        e = { assessmentId: r.assessmentId, key, sum: 0, n: 0, items: new Set() };
        acc.set(mapKey, e);
      }
      e.sum += r.score;
      e.n += 1;
      e.items.add(r.itemId);
    }
    const out: GroupMean[] = [];
    for (const e of acc.values()) {
      out.push({
        assessmentId: e.assessmentId,
        key: e.key,
        meanScore: e.n > 0 ? round(e.sum / e.n, 3) : 0,
        items: e.items.size,
      });
    }
    return out;
  };

  const byMajorElement = groupMean((itemId) => metaByItem.get(itemId)?.majorElement);
  const byDemandLevel = groupMean((itemId) => metaByItem.get(itemId)?.demandLevel);

  // --- overall distribution of participant percentages ----------------------
  const distribution = histogram(participantScores.map((s) => s.pct));

  return { byAssessment, byMajorElement, byDemandLevel, distribution };
}
