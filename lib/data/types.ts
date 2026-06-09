/**
 * Read-model and action types exposed by the DataProvider to the UI. Components
 * depend only on these — never on the engine, ingest, export modules or Supabase
 * directly. The Supabase-backed provider will implement the same interface.
 */

import type { QualityRating } from "@/lib/engine";
import type { ValidationReport } from "@/lib/ingest/types";
import type { SeedPreview } from "./seed-types";

export type Role = "lead_admin" | "reviewer" | "viewer";

export interface CurrentUser {
  id: string;
  name: string;
  initials: string;
  role: Role;
}

export const PIPELINE = [
  "Ingest",
  "Validate",
  "Review",
  "Score",
  "Boundaries",
  "Grades",
  "Export",
] as const;
export type PipelineStage = (typeof PIPELINE)[number];

export interface CycleSummary {
  id: string;
  name: string;
  stageIndex: number;
  stageLabel: string;
  stepsDone: number;
  participants: number;
  assessments: number;
  lastActivity: string;
  locked: boolean;
  live: boolean;
  mock: boolean;
}

export interface AssessmentRef {
  id: string;
  name: string;
  shortName: string;
  rtl: boolean;
  itemCount: number;
  excludedCount: number;
  stageIndex: number;
}

export interface CycleDetail {
  id: string;
  name: string;
  participants: number;
  assessmentCount: number;
  startedAt: string;
  stageIndex: number;
  locked: boolean;
  mock: boolean;
  doNext: { title: string; body: string; href: string; cta: string };
  assessments: AssessmentRef[];
}

export interface IngestModel {
  cycleId: string;
  fileName: string;
  fileSizeMB: number;
  uploadedAgo: string;
  report: ValidationReport;
  preview: SeedPreview;
  duplicates: number;
  canContinue: boolean;
}

export interface ItemRow {
  id: string;
  wording: string | null;
  major: string | null;
  sub: string | null;
  demand: string | null;
  pValue: number;
  itemTotal: number | null;
  pointBiserial: number | null;
  discrimination: number;
  overallReview: QualityRating;
  qualityIndex: number;
  excluded: boolean;
  reason: string | null;
}

export interface BreakItem {
  k: string;
  v: number;
}

export interface ReviewModel {
  assessment: AssessmentRef;
  assessments: AssessmentRef[];
  kpis: { items: number; excluded: number; medianDifficulty: number; cohortMean: number };
  items: ItemRow[];
  distribution: number[];
  cohortMean: number;
  cohortSd: number;
  byElement: BreakItem[];
  byDemand: BreakItem[];
}

export interface GradeBandRow {
  /** Named level (e.g. "Exceeds expectations" or "Distinction award"). */
  level: string;
  /** Star string for performance bands; null for award bands. */
  stars: string | null;
  /** Minimum score for this band; null for the lowest (remainder) band. */
  cut: number | null;
  students: number;
  pct: number;
}

export type BoundaryMode = "cuts" | "pct";

export interface BoundaryScopeRef {
  id: string;
  label: string;
}

export interface BoundaryModel {
  cycleId: string;
  scope: string;
  scopeLabel: string;
  scopes: BoundaryScopeRef[];
  mode: BoundaryMode;
  /** True when the scope is the overall award (different vocabulary). */
  isAward: boolean;
  histogram: number[]; // 51 two-point bins (0..100), participant counts
  /** Levels, best → lowest (length L). */
  levels: string[];
  /** Cut-points, length L−1: cuts[i] is the min score for levels[i]. */
  cuts: number[];
  /** Cohort-% targets for the top L−1 bands (pct mode). */
  targets: number[];
  bands: GradeBandRow[];
  stats: { mean: number; median: number; sd: number; itemsScored: number; excluded: number };
  n: number;
  locked: boolean;
}

export interface GradeCell {
  level: string;
  stars: string;
}

export interface GradeMatrixRow {
  id: string;
  label: string;
  /** Per-assessment performance level + stars, keyed by assessment id. */
  grades: Record<string, GradeCell>;
  /** Overall award level. */
  award: string;
}

export interface GradesModel {
  cycleId: string;
  assessments: AssessmentRef[];
  rows: GradeMatrixRow[];
  /** Distribution over the award levels. */
  distribution: { level: string; count: number }[];
  awardLevels: string[];
  /** Performance level → stars, for the matrix legend. */
  starMap: Record<string, string>;
  performanceLevels: string[];
  locked: boolean;
  canLock: boolean;
}

export type DuplicateStrategy = "keep_latest" | "keep_first" | "exclude";

// --- Settings → grading defaults --------------------------------------------
export interface GradingDefaultsModel {
  performanceLevels: string[];
  starMap: Record<string, string>;
  awardLevels: string[];
  performanceCuts: number[];
  awardCuts: number[];
  /** True when the award-derivation rule is still the unverified placeholder. */
  awardRuleUnconfirmed: boolean;
}
