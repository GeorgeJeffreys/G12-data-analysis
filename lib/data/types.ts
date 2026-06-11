/**
 * Read-model and action types exposed by the DataProvider to the UI. Components
 * depend only on these — never on the engine, ingest, export modules or Supabase
 * directly. The Supabase-backed provider will implement the same interface.
 */

import type { QualityRating } from "@/lib/engine";
import type { SpeededResult, TimingResult } from "@/lib/diagnostics";
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
  "Adjustments",
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

/** Optional technical-errors spreadsheet attached at ingest (never gates progress). */
export interface TechnicalErrorsUpload {
  uploaded: boolean;
  fileName: string | null;
  incidentCount: number;
  matchedCount: number;
  preview: { headers: string[]; rows: (string | number | null)[][] };
  /** True when populated from the labelled sample fixture rather than a real file. */
  sample: boolean;
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
  technicalErrors: TechnicalErrorsUpload;
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

// --- Essay marks (optional upload at Ingest; English/Arabic only) ------------
export interface EssaySubjectRef {
  assessmentId: string;
  /** Subject code in the file (AFL / ESL). */
  code: string;
  name: string;
  /** Students with an essay mark for this subject. */
  count: number;
}
export interface EssayStudentMark {
  participantId: string;
  name: string;
  /** assessmentId → essay mark out of 20 (averaged across the student's essays). */
  marks: Record<string, number>;
  /** How many essays were averaged into each subject mark (assessmentId → n). */
  essayCounts: Record<string, number>;
}
export interface EssayMarksModel {
  cycleId: string;
  uploaded: boolean;
  sample: boolean;
  fileName: string | null;
  subjects: EssaySubjectRef[];
  students: EssayStudentMark[];
  /** Distinct file ParticipantIDs that matched a roster student. */
  matchedCount: number;
  /** File ParticipantIDs that did not match any roster student. */
  unmatchedIds: string[];
  preview: { headers: string[]; rows: (string | number | null)[][] };
}

// --- Adjustments: incident triage → alterations ------------------------------
export interface AdjustmentIncident {
  id: string;
  source: "incident_log" | "complaint";
  /** Free-text context straight from the file. */
  studentName: string;
  exam: string | null;
  issueType: string | null;
  actionTaken: string | null;
  questionsAffected: string | null;
  staff: string | null;
  email: string | null;
  school: string | null;
  description: string | null;
  /** Non-binding suggestions (never auto-applied). */
  suggestedStudentId: string | null;
  suggestedSubjectId: string | null;
  /** Decision (null applyTo = still in the queue). */
  applyTo: "student" | "subject" | "none" | null;
  studentId: string | null;
  subjectId: string | null;
  marks: number;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}
export interface AdjustmentsModel {
  cycleId: string;
  uploaded: boolean;
  sample: boolean;
  fileName: string | null;
  incidents: AdjustmentIncident[];
  /** Roster for the student typeahead. */
  roster: { id: string; name: string }[];
  /** Subjects for the subject picker. */
  subjects: { id: string; name: string; code: string | null }[];
  counts: { incidents: number; decided: number; awaiting: number; alterations: number };
  /** Net alteration marks applied per subject (assessmentId → net marks). */
  netBySubject: Record<string, number>;
}

// --- Diagnostics (speededness & timing — informational) ----------------------
export interface DiagnosticsGroup {
  /** "Overall" or a major-element name. */
  key: string;
  speeded: SpeededResult;
  timing: TimingResult;
}
export interface DiagnosticsAssessment {
  assessmentId: string;
  assessmentName: string;
  shortName: string;
  groups: DiagnosticsGroup[];
}
export interface DiagnosticsModel {
  cycleId: string;
  assessments: DiagnosticsAssessment[];
}

// --- Mark composition (MCQ + Essay + Alterations = subject total) ------------
export interface SubjectComposition {
  assessmentId: string;
  name: string;
  hasEssay: boolean;
  mcq: number;
  essay: number;
  alterations: number;
  total: number;
  max: number;
  pct: number;
}
export interface StudentComposition {
  participantId: string;
  name: string;
  subjects: SubjectComposition[];
  overall: { total: number; max: number; pct: number };
}
export interface CompositionModel {
  cycleId: string;
  subjects: { id: string; name: string; hasEssay: boolean }[];
  students: StudentComposition[];
}

// --- Performance report (Students_Performance_Report export) -----------------
export interface PerfElementResult {
  /** Overall performance level for the subject. */
  level: string;
  /** Major element → performance level. */
  elements: Record<string, string>;
}
export interface PerfReportStudent {
  participantId: string;
  name: string;
  award: string;
  /** Keyed by assessmentId. */
  subjects: Record<string, PerfElementResult>;
}
export interface PerfReportSubject {
  assessmentId: string;
  name: string;
  majorElements: string[];
}
export interface PerfReportSummarySubject {
  label: string;
  assessmentId: string | null;
}
export interface PerformanceReportModel {
  cycleName: string;
  performanceLevels: string[];
  awardLevels: string[];
  subjects: PerfReportSubject[];
  summarySubjects: PerfReportSummarySubject[];
  students: PerfReportStudent[];
  awardDistribution: { level: string; count: number; pct: number }[];
}

/** Full per-question deep-dive for the Item review right panel. */
export interface ItemDetailModel {
  id: string;
  qLabel: string;
  wording: string | null;
  major: string | null;
  sub: string | null;
  demand: string | null;
  excluded: boolean;
  reason: string | null;
  /** Participants who answered (engine n) and were presented the item. */
  answered: number;
  presented: number;
  notAnswered: number;
  pValue: number;
  pRating: QualityRating;
  itemTotal: number | null;
  itRating: QualityRating;
  pointBiserial: number | null;
  pbRating: QualityRating;
  discrimination: number;
  discRating: QualityRating;
  overallReview: QualityRating;
  qualityIndex: number;
  /** Discrimination upper/lower groups (top/bottom ~third by rest-total). */
  groups: { size: number; upperMean: number; lowerMean: number };
  /**
   * Outcome distribution for this dichotomous item — the Questionmark score
   * export carries only correct/incorrect (not the chosen option), so this is the
   * honest response breakdown, not a fabricated per-option A/B/C/D split.
   */
  outcome: { correct: number; incorrect: number; notAnswered: number };
  /** Plain-language reasoning for each statistic's Good/Review/Flag rating. */
  reasons: { p: string; it: string; pb: string; disc: string; overall: string };
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

// --- Document generation (Student Summary from locked grades) ----------------
export interface SubjectResult {
  /** Canonical template slot S1..S5. */
  slot: string;
  /** The suite assessment mapped to this slot (by alias). */
  assessment: string;
  level: string;
  stars: string;
}

export interface StudentSummary {
  /** Maps to the {{RESULTID}} token. */
  participantId: string;
  name: string;
  /** Overall award level. */
  award: string;
  /** Per-subject performance level + stars, in canonical S1..S5 order. */
  subjects: SubjectResult[];
}

export interface DocSettings {
  cycleName: string;
  testCentre: string;
  examDate: string;
  issueDate: string;
}

export interface DocumentsModel {
  cycleId: string;
  /** Document generation is only available once grades are locked. */
  locked: boolean;
  students: StudentSummary[];
  settings: DocSettings;
  /** Canonical slot → assessment mapping for display. */
  subjectOrder: { slot: string; assessment: string }[];
}

// --- Users & access (Settings) ----------------------------------------------
export type MemberStatus = "active" | "invited";

export interface Member {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  status: MemberStatus;
  lastActive: string;
  /** True for the mocked signed-in user. */
  isCurrent: boolean;
}

export interface MembersModel {
  members: Member[];
  roles: { id: string; name: string }[];
}

// --- Roles & permissions ----------------------------------------------------
export interface Capability {
  id: string;
  group: string;
  label: string;
}

export interface RoleDef {
  id: string;
  name: string;
  isLead: boolean;
  memberCount: number;
}

export interface RolesModel {
  roles: RoleDef[];
  /** Capabilities grouped for the grid, in display order. */
  groups: { group: string; capabilities: Capability[] }[];
  /** matrix[roleId][capabilityId] = granted. */
  matrix: Record<string, Record<string, boolean>>;
}

// --- Audit log --------------------------------------------------------------
export type AuditType =
  | "exclude"
  | "boundary"
  | "lock"
  | "reopen"
  | "export"
  | "document"
  | "upload"
  | "cycle"
  | "validate"
  /** Per-student technical exclusion / keep, and Distinction-safeguard caps & overrides. */
  | "student"
  | "safeguard"
  /** Workspace settings: quality thresholds, grading vocabulary, roles. */
  | "config";

export interface AuditEntry {
  id: string;
  /** ISO timestamp. */
  ts: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  type: AuditType;
  action: string;
  detail: string;
  cycleId: string | null;
  /** True for the seeded illustrative entries (not from this session's actions). */
  seeded: boolean;
}

export interface AuditModel {
  entries: AuditEntry[];
  total: number;
}

export type AuditFilter = "all" | "exclude" | "boundary" | "lock" | "export";

// --- Analytics (Settings/Analytics area) ------------------------------------
export interface TrendKpi {
  label: string;
  value: string;
  delta: string;
  points: number[];
}

export interface AssessmentTrend {
  name: string;
  points: number[];
  now: string;
  delta: string;
}

export interface AnalyticsTrends {
  /** Cycle labels oldest → newest (the last is the real live cycle). */
  cycleLabels: string[];
  kpis: TrendKpi[];
  byAssessment: AssessmentTrend[];
  /** Award-distribution percentages per cycle (oldest → newest). */
  awardOverTime: { label: string; dist: Record<string, number> }[];
  awardLevels: string[];
  /** True when prior cycles are mock (no real history). */
  priorsAreMock: boolean;
}

export interface CompareColumn {
  cycle: string;
  mock: boolean;
  metrics: Record<string, string>;
  dist: Record<string, number>;
}

export interface AnalyticsCompare {
  metrics: { key: string; label: string }[];
  columns: CompareColumn[];
  awardLevels: string[];
  priorsAreMock: boolean;
}

// --- Configuration (Settings) -----------------------------------------------
export interface QualityThresholdRow {
  metric: string;
  good: string;
  review: string;
  flag: string;
}

export interface RetentionConfig {
  archiveAfterYears: number;
  deleteRawAfterArchive: boolean;
  keepAuditIndefinitely: boolean;
}

export interface BrandingConfig {
  accent: string;
  logoName: string;
  defaultCertificateTemplate: string;
}

export interface ConfigModel {
  /** The engine's active rating thresholds (read-only — they drive item ratings). */
  thresholds: QualityThresholdRow[];
  retention: RetentionConfig;
  branding: BrandingConfig;
  safeguard: SafeguardConfig;
}

// --- New cycle --------------------------------------------------------------
export interface NewCycleAssessment {
  id: string;
  name: string;
  rtl: boolean;
  included: boolean;
  fileName: string | null;
}

export interface NewCycleModel {
  defaultName: string;
  sittingDate: string;
  assessments: NewCycleAssessment[];
}

export interface CreateCycleInput {
  name: string;
  sittingDate: string;
  assessmentIds: string[];
}

// --- Per-student technical exclusions (Student review step) ------------------
export type IncidentDecision = "excluded" | "kept" | null;

export interface TechnicalIncident {
  id: string;
  studentId: string;
  studentName: string;
  assessmentId: string;
  assessmentName: string;
  itemId: string | null; // null when the row couldn't be matched to a real item
  questionLabel: string;
  demand: string | null;
  wording: string | null;
  rtl: boolean;
  error: string;
  decision: IncidentDecision;
  reason: string | null;
  by: string | null;
  at: string | null;
}

export interface StudentReviewModel {
  cycleId: string;
  uploaded: boolean;
  sample: boolean;
  fileName: string | null;
  incidents: TechnicalIncident[];
  counts: { incidents: number; excluded: number; kept: number; awaiting: number; students: number };
}

// --- Distinction safeguard (grading stage) ----------------------------------
export type SafeguardResult = "pass" | "capped" | "override";

export interface DistinctionCandidate {
  id: string;
  name: string;
  topDifficultyAnswered: number;
  meets: boolean;
  provisionalAward: string;
  cappedAward: string;
  result: SafeguardResult;
  overrideReason: string | null;
  overrideBy: string | null;
}

export interface DistinctionSafeguardModel {
  cycleId: string;
  threshold: number;
  topDifficultyDemand: string;
  topDifficultyPool: number;
  scope: string;
  scopes: { id: string; label: string }[];
  topAward: string;
  cappedTo: string;
  candidates: DistinctionCandidate[];
  counts: { inLine: number; meet: number; capped: number; overridden: number };
  canOverride: boolean;
  /** // CONFIRM: "answered" is treated as attempted (a non-blank response), not "answered correctly". */
  attemptedNote: string;
}

// --- Safeguard configuration (Settings → Configuration) ----------------------
export interface SafeguardConfig {
  distinctionThreshold: number;
  topDifficultyDemand: string;
  demandLevels: string[];
}
