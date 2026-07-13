/**
 * Static fixtures for the admin/analytics areas. Members, roles and the prior
 * cycles here are MOCK (clearly labelled in the UI) — there is no real auth or
 * cross-cycle history yet. The item-quality thresholds are the engine's REAL
 * active rating rules (display-only), mirroring `lib/engine/stats.ts`.
 */
import type {
  AuditEntry,
  Member,
  QualityThresholdRow,
} from "./types";

/**
 * No mock/seed members. The real Users & access roster comes from
 * `auth.users ⋈ memberships` via the `list_members` RPC (see supabase-provider);
 * the in-memory demo/test provider simply starts with an empty roster.
 */
export function defaultMembers(): Member[] {
  return [];
}

/** No seeded audit actors (the previous fixtures were mock accounts). The audit
 *  log starts empty and fills from real actions. */
export function seedAuditEntries(_cycleId: string): AuditEntry[] {
  return [];
}

/** The engine's REAL active rating thresholds (see lib/engine/stats.ts) — display-only. */
export const QUALITY_THRESHOLDS: QualityThresholdRow[] = [
  { metric: "p-value (difficulty)", good: "0.30 – 0.85", review: "0.20–0.30 / 0.85–0.90", flag: "< 0.20 / > 0.90" },
  { metric: "Item-total correlation", good: "≥ 0.30", review: "0.10 – 0.30", flag: "< 0.10 / undefined" },
  { metric: "Point-biserial", good: "≥ 0.30", review: "0.10 – 0.30", flag: "< 0.10 / undefined" },
  { metric: "Discrimination", good: "≥ 0.30", review: "0.10 – 0.30", flag: "< 0.10" },
];

// --- Analytics: MOCK prior cycles (no real history yet) ----------------------
// Only the *live* cycle's aggregates are real; these priors are illustrative.
export const ANALYTICS_CYCLE_LABELS = ["May 25", "Nov 25", "Jan 26", "May 26"];
/** Full cycle names (parallel to ANALYTICS_CYCLE_LABELS) for explicit labelling. */
export const ANALYTICS_CYCLE_NAMES = ["May 2025", "November 2025", "January 2026", "May 2026"];

export interface MockPrior {
  label: string;
  participants: number;
  cohortMean: number;
  median: number;
  sd: number;
  itemsScored: number;
  itemsExcluded: number;
  meanQuality: number;
  /** award-distribution percentages keyed by award level. */
  awardDist: Record<string, number>;
  /** per-assessment cohort mean, keyed by assessment id. */
  byAssessment: Record<string, number>;
}

/** Mock priors for the three sittings before the live cycle (oldest → newest). */
export function mockPriors(awardLevels: string[], assessmentIds: string[]): MockPrior[] {
  const award = (a: number, b: number, c: number, d: number): Record<string, number> =>
    Object.fromEntries(awardLevels.map((lvl, i) => [lvl, [a, b, c, d][i] ?? 0]));
  const per = (vals: number[]): Record<string, number> =>
    Object.fromEntries(assessmentIds.map((id, i) => [id, vals[i % vals.length] ?? 0]));
  return [
    { label: "May 25", participants: 15, cohortMean: 44.1, median: 45, sd: 12.4, itemsScored: 188, itemsExcluded: 6, meanQuality: 62, awardDist: award(6, 18, 40, 36), byAssessment: per([42, 47, 41, 52, 55]) },
    { label: "Nov 25", participants: 16, cohortMean: 45.6, median: 46, sd: 12.9, itemsScored: 190, itemsExcluded: 5, meanQuality: 66, awardDist: award(8, 21, 39, 32), byAssessment: per([44, 48, 43, 53, 57]) },
    { label: "Jan 26", participants: 17, cohortMean: 46.4, median: 47, sd: 13.2, itemsScored: 191, itemsExcluded: 4, meanQuality: 68, awardDist: award(9, 24, 34, 33), byAssessment: per([45, 49, 44, 54, 58]) },
  ];
}
