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
  grade: string;
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
  histogram: number[]; // 51 two-point bins (0..100), participant counts
  cuts: { A: number; B: number; C: number; D: number };
  targets: { A: number; B: number; C: number; D: number };
  bands: GradeBandRow[];
  stats: { mean: number; median: number; sd: number; itemsScored: number; excluded: number };
  n: number;
  locked: boolean;
}

export interface GradeMatrixRow {
  id: string;
  label: string;
  grades: Record<string, string>;
  overall: string;
}

export interface GradesModel {
  cycleId: string;
  assessments: AssessmentRef[];
  rows: GradeMatrixRow[];
  distribution: { grade: string; count: number }[];
  locked: boolean;
  canLock: boolean;
}

export type DuplicateStrategy = "keep_latest" | "keep_first" | "exclude";
