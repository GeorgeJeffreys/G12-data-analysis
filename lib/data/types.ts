/**
 * Read-model and action types exposed by the DataProvider to the UI. Components
 * depend only on these — never on the engine, ingest, export modules or Supabase
 * directly. The Supabase-backed provider will implement the same interface.
 */

import type { QualityRating } from "@/lib/engine";
import type { PerCutSuggestion } from "@/lib/engine/cut-scores";
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

// Document/certificate generation is NOT a per-sitting pipeline step: certificates
// and performance reports issue from the cycle/overall best-of-two award
// (app/years/[yearId]/overall/documents), not a single sitting. The per-sitting
// pipeline therefore ends at Grades. (Per-page CSV/Excel data exports remain — they
// are legitimately per-sitting, but they are page actions, not a pipeline stage.)
export const PIPELINE = [
  "Upload",
  "Clean",
  "Raw scores",
  "Question review",
  "Diagnostics",
  "Essay marks",
  "Technical adjustments",
  "Score",
  "Cut scores",
  "Grades",
] as const;
export type PipelineStage = (typeof PIPELINE)[number];

/**
 * A test centre — the top-level scoping dimension (migration 0010). A centre
 * owns its own exam years; each year owns its February + May sittings. Centre is
 * a partition / labelling key only — it never feeds scoring.
 */
export interface TestCentreSummary {
  id: string;
  name: string;
  /** Short tag, e.g. "SHA1". */
  code: string;
  /** Route-safe, e.g. "shatila-1". */
  slug: string;
  active: boolean;
}

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
  /** 0010 — the test centre this sitting belongs to (via its year). */
  testCentreId: string;
  testCentreName: string;
}

/** Which sitting of a year. "overall" is the derived best-of-two view. */
export type SittingKey = "february" | "may";

/**
 * One sitting tile inside a year. A sitting is a full pipeline run (an
 * exam_cycle). When no run exists yet for the slot, `started` is false and
 * `cycleId` is null — the year view offers to start it.
 */
export interface SittingRef {
  sitting: SittingKey;
  /** Display label, e.g. "February" / "May". */
  label: string;
  /** 0010 — the test centre this sitting's year belongs to (for labelling). */
  testCentreName: string;
  /** The exam_cycle id for this sitting, or null when not started. */
  cycleId: string | null;
  cycleName: string | null;
  started: boolean;
  locked: boolean;
  stageLabel: string;
  stepsDone: number;
  participants: number;
  assessments: number;
  lastActivity: string;
  live: boolean;
  mock: boolean;
}

/** One row in the year list (was the cycles list). */
export interface YearSummary {
  id: string;
  name: string;
  /** 0010 — the test centre this year belongs to. */
  testCentreId: string;
  testCentreName: string;
  february: SittingRef;
  may: SittingRef;
  /** Distinct participants across the year's sittings (max of the two). */
  participants: number;
  lastActivity: string;
  /** True when one of the sittings is the live (active) run. */
  live: boolean;
  /** True when every sitting in the year is mock decoration. */
  mock: boolean;
}

/** A year opened: its two sittings + the (stubbed) Overall rollup. */
export interface YearDetail {
  id: string;
  name: string;
  /** 0010 — the test centre this year belongs to. */
  testCentreId: string;
  testCentreName: string;
  february: SittingRef;
  may: SittingRef;
  /**
   * Overall is DERIVED (best-of-two by award level, per student per subject) —
   * the rollup lives in `getOverallGrades` / `lib/data/overall.ts`. `ready` is
   * true only once both sittings are locked, which is when an Overall is final.
   */
  overall: { ready: boolean; note: string };
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
  /** 0010 — the test centre this sitting belongs to (via its year). */
  testCentreName: string;
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
  /** Whether a raw exam export has actually been ingested for this cycle. An
   *  empty/draft cycle is the normal starting state — the screen renders an
   *  upload prompt rather than a (meaningless, all-zero) validation report. */
  uploaded: boolean;
  fileName: string;
  fileSizeMB: number;
  uploadedAgo: string;
  /**
   * The three Questionmark CSVs recognised at ingest — what each uploaded file was
   * detected as, by its columns (not its filename). A value is null when that kind
   * wasn't recognised in the upload (e.g. a legacy single-file row, or a re-upload
   * that predates the 3-CSV intake). Drives the per-file recognition display, and
   * the "missing / unrecognised" message, on the Upload step.
   */
  files: { items: string | null; assessments: string | null; topics: string | null };
  report: ValidationReport;
  preview: SeedPreview;
  duplicates: number;
  canContinue: boolean;
  technicalErrors: TechnicalErrorsUpload;
}

// --- Front-of-pipeline: combined upload, raw data, cleaning, naive scores ----
export type CleaningStatus = "pass" | "warn" | "fail";

/** One subject detected when a combined export is split. */
export interface DetectedSubject {
  id: string;
  name: string;
  shortName: string;
  items: number;
  participants: number;
  /** Major element names found in this subject (3–5, never hard-coded). */
  elements: string[];
  rtl: boolean;
  hasEssay: boolean;
  status: "ok" | "warn";
  note: string | null;
}
export interface CombinedSplitModel {
  cycleId: string;
  fileName: string;
  fileSizeMB: number;
  uploadedAgo: string;
  totalItems: number;
  totalParticipants: number;
  subjects: DetectedSubject[];
}

/** Column metadata for the raw spreadsheet view. */
export interface RawColumnMeta {
  id: string;
  qLabel: string;
  major: string | null;
  sub: string | null;
  demand: string | null;
}
/** One participant row in the raw spreadsheet (cells aligned to `columns`). */
export interface RawDataRow {
  id: string;
  studentId: string;
  name: string;
  /** 1 correct · 0 incorrect · null omitted/blank, in column order. */
  cells: (number | null)[];
}
export interface RawElementBreak {
  major: string;
  subs: string[];
  items: number;
}
export interface RawDataModel {
  assessment: AssessmentRef;
  assessments: AssessmentRef[];
  participants: number;
  items: number;
  /** Number of major elements present (varies by subject). */
  elementsCount: number;
  subElementsCount: number;
  demand: { D1: number; D2: number; D3: number };
  byElement: RawElementBreak[];
  columns: RawColumnMeta[];
  rows: RawDataRow[];
}

export interface CleaningCheck {
  id: string;
  status: CleaningStatus;
  title: string;
  detail: string | null;
  count: string | null;
  /** Suggested action label (e.g. "Resolve", "Delete column"); null = informational. */
  action: string | null;
}
export interface DataCleaningModel {
  assessment: AssessmentRef;
  assessments: AssessmentRef[];
  checks: CleaningCheck[];
  counts: { pass: number; warn: number; fail: number };
  rowsBefore: number;
  /** Rows remaining after the current (UI-selected) removals. */
  rowsAfter: number;
  /** True when no must-fix blocker remains. Warnings never block. */
  canProceed: boolean;
  columns: RawColumnMeta[];
  rows: RawDataRow[];
}

export interface NaiveElementCol {
  major: string;
  shortId: string;
  items: number;
}
export interface NaiveStudentRow {
  id: string;
  studentId: string;
  name: string;
  /** Raw correct count per major element. */
  perElement: Record<string, number>;
  raw: number;
  pct: number;
}
export interface NaiveScoresModel {
  assessment: AssessmentRef;
  assessments: AssessmentRef[];
  hasEssay: boolean;
  mcqItems: number;
  totalItems: number;
  cohortAvgPct: number;
  elements: NaiveElementCol[];
  students: NaiveStudentRow[];
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

// --- Reliability (Cronbach's Alpha) — read-only, additive --------------------
export type ReliabilityLevelKey =
  | "overall"
  | "subject"
  | "majorElement"
  | "subElement"
  | "demandLevel"
  | "context";

export interface ReliabilityRow {
  level: ReliabilityLevelKey;
  /** Subject this group belongs to (null for the overall-exam group). */
  assessmentId: string | null;
  assessmentName: string | null;
  key: string;
  /** Display label (subject name for the subject level; tag value otherwise). */
  label: string;
  /** Items in the group. */
  k: number;
  /** Complete-case participant count used for α. */
  n: number;
  /** Cronbach's α, or null when n/a (k<2 / n<2 / no variance). */
  alpha: number | null;
  /** Why α is n/a, when it is. */
  note: string | null;
  /** k below the low-items threshold — α is fragile. */
  lowItems: boolean;
  /** n below the small-sample threshold — α is unstable. */
  smallSample: boolean;
}

export interface ReliabilityModel {
  cycleId: string;
  engineVersion: string;
  participants: number;
  lowItemsThreshold: number;
  smallSampleThreshold: number;
  /** The overall-exam α (all usable items across subjects). */
  overall: ReliabilityRow;
  /** Every α group (including overall); pages filter by level / assessmentId. */
  rows: ReliabilityRow[];
}

// --- Mark composition (MCQ + Essay + Alterations = subject total) ------------
/**
 * A student's MCQ score on the items carrying one demand tag (D1/D2/D3), out of
 * that group's max. A rollup of the already-computed item scores by demand tag —
 * additive reporting only, no change to scoring. Mirrors the "Overall Scores by
 * Demand Level" sheet of the MCQ_Overall_Score_Analysis export.
 */
export interface DemandScore {
  demand: string;
  score: number;
  max: number;
}
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
  /** Retained-MCQ score split by demand level (D1/D2/D3), in fixed order. */
  byDemand: DemandScore[];
  /**
   * Per-subject top-difficulty (D3) correctness — display-only. Of the retained
   * D3 items on THIS subject, how many the student answered correctly (score > 0)
   * out of how many were available. `pct` is null when the subject carries no D3
   * items. This is a reporting breakdown; it does NOT change the D3 majority cap
   * (which stays per-exam aggregate — see open G12 decision #2 in the PR notes).
   */
  d3?: { correct: number; available: number; pct: number | null } | null;
  /**
   * The active manual mark adjustment on this subject, if any — surfaced so the
   * manual delta (already folded into `alterations`) and its reason are visible
   * in the breakdown rather than hidden.
   */
  adjustment?: ManualMarkAdjustment | null;
}
/**
 * Display-only per-student attempt + technical signals, alongside the score
 * composition. Both are aggregations of data already held (demand tags +
 * result-status flags); neither changes any score or grade.
 */
export interface StudentSignals {
  /**
   * The student's engagement with the top-difficulty (D3) items: how many of the
   * D3 items presented to them (across all subjects) they actually attempted.
   * `pct` is null when the student had no D3 items.
   */
  d3: { attempted: number; available: number; pct: number | null };
  /** Number of the student's sittings flagged with a technical result status. */
  incidents: number;
}
export interface StudentComposition {
  participantId: string;
  name: string;
  subjects: SubjectComposition[];
  overall: { total: number; max: number; pct: number };
  /** Display-only attempt/technical signals (D3-answered share + incident count). */
  signals: StudentSignals;
}
export interface CompositionModel {
  cycleId: string;
  subjects: { id: string; name: string; shortName: string; hasEssay: boolean }[];
  students: StudentComposition[];
}

// --- Performance report (Students_Performance_Report export) -----------------
export interface PerfElementResult {
  /** Overall performance level for the subject. */
  level: string;
  /** Major element → performance level. */
  elements: Record<string, string>;
  /** Major element → (sub-element → performance level). Finer-grained breakdown. */
  subElements: Record<string, Record<string, string>>;
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
  /** Major element → its ordered sub-elements (the construct structure, read from data). */
  subElements: Record<string, string[]>;
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

/**
 * Cohort-level ½-D3 sanity check on the Outstanding cut (Wave 3b Part 3).
 * A WARNING, not a hard clamp — and the precise "cut implies ½-D3" rule is
 * flagged as a methodology nuance for human confirmation (see cut-scores.ts).
 */
export interface D3HalfWarning {
  /** False when the subject has no D3 items or no Outstanding-band students. */
  applicable: boolean;
  /** True when no Outstanding student cleared the cut without ≥ ½ D3 correct. */
  consistent: boolean;
  d3Total: number;
  halfThreshold: number;
  outstandingCount: number;
  belowHalf: number;
  /** Human copy describing the (confirmation-pending) interpretation. */
  note: string;
}

/**
 * The backsolved suggestion derived from the current target distribution — the
 * "what the targets imply" working, shown honestly with target-vs-achieved.
 */
export interface BoundarySuggestion {
  /** Suggested cuts after guard-rails, length L−1. */
  cuts: number[];
  /** Per-cut working (distribution value, clamp, tie, target-vs-achieved). */
  perCut: PerCutSuggestion[];
  /** Targets the suggestion was solved from. */
  targets: number[];
  /** ½-D3 sanity check against the suggested Outstanding cut. */
  d3: D3HalfWarning;
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
  /** Policy hard bounds (percent of subject max). */
  guardrails: { floorPct: number; ceilingPct: number };
  /** Subject total max (raw marks) — lets the UI show raw cut alongside %. */
  maxRaw: number;
  /** Backsolved suggestion from the CURRENT targets (recomputed every read). */
  suggestion: BoundarySuggestion;
  /**
   * Committed suggestion snapshot, per cut. When a cut equals its snapshot it is
   * "suggested"; when it differs the user has "edited" it. null until a
   * suggestion has been adopted as the editable starting point.
   */
  suggestedCuts: number[] | null;
  /** ½-D3 warning evaluated against the EFFECTIVE (current) Outstanding cut. */
  d3Warning: D3HalfWarning;
}

/**
 * A manual, audited mark adjustment on one student's subject. The delta flows
 * through the existing Alterations input the scoring engine consumes (never by
 * touching item-stats or engine logic), so the grade recomputes through the full
 * path — including the D3 distinction safeguard. Surfaced in the score breakdown
 * so the change (and its reason) is never hidden; reversible via its `id`.
 */
export interface ManualMarkAdjustment {
  /** Stable id, for reversal. */
  id: string;
  participantId: string;
  assessmentId: string;
  /** Subject raw mark before the adjustment (the base, excluding this delta). */
  oldMark: number;
  /** Subject raw mark after the adjustment. */
  newMark: number;
  /** newMark − oldMark — the signed delta fed to the engine as an alteration. */
  delta: number;
  /** Required reason for the override (audited). */
  reason: string;
  /** Actor who made the adjustment (resolved server-side). */
  by: string;
  /** ISO timestamp. */
  ts: string;
}

export interface GradeCell {
  level: string;
  stars: string;
  /**
   * True when the subject score is within the configurable borderline band
   * (percentage points) below the cut for the next grade up — the student just
   * missed it, and a small upward mark adjustment would change the grade.
   */
  marginal?: boolean;
  /** Raw marks needed to reach the next grade up (present when `marginal`). */
  marksToNext?: number;
  /** Percentage points below the next grade-up cut (present when `marginal`). */
  pctToNext?: number;
  /** The next grade up's performance level (for the marginal marker tooltip). */
  nextLevel?: string;
  /** The active manual mark adjustment on this subject cell, if any. */
  adjustment?: ManualMarkAdjustment | null;
}

export interface GradeMatrixRow {
  /** Stable internal key. */
  id: string;
  /** Human Student ID for display (the real ID on live data; pseudonym in the demo). */
  studentId: string;
  label: string;
  /** Per-assessment performance level + stars, keyed by assessment id. */
  grades: Record<string, GradeCell>;
  /** Overall award level. */
  award: string;
  /**
   * Present only when the student's level pattern qualified for Distinction but
   * the D3-majority cap denied it — the visible "why" (e.g. 3/7 correct, majority
   * 4 in the named subject). Null/absent otherwise.
   */
  distinctionCap?: {
    /** Short subject name of the exam that failed the majority. */
    subject: string;
    /** D3 items answered correctly on that exam. */
    correct: number;
    /** D3 items available on that exam. */
    available: number;
    /** The majority threshold (strictly more than half of available). */
    majority: number;
  } | null;
  /** Overall raw score across all subjects (MCQ + essay + alterations). */
  overallRaw: number;
  /** Maximum attainable overall score. */
  overallMax: number;
  /** Overall percentage = overallRaw / overallMax × 100. */
  overallPct: number;
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

// --- Overall (best-of-two across the year's two sittings) --------------------
/** Which sitting a chosen per-subject result came from. */
export type OverallSource = "february" | "may";

/**
 * One subject cell in the Overall (best-of-two) view: the HIGHER of the two
 * sittings' performance levels, with provenance (which sitting it came from) and
 * the raw per-sitting levels for transparency. The comparison is by performance
 * level RANK (best → lowest), never by raw score.
 */
export interface OverallGradeCell {
  /** The chosen (higher) performance level. */
  level: string;
  stars: string;
  /** Which sitting supplied the chosen level (the visible Feb/May tag). */
  source: OverallSource;
  /** Level recorded in the February sitting (null = no February result). */
  februaryLevel: string | null;
  /** Level recorded in the May sitting (null = no May result). */
  mayLevel: string | null;
}

export interface OverallGradeRow {
  /** Stable key — the human Student ID, which matches across the two sittings. */
  id: string;
  studentId: string;
  label: string;
  /** Best-of-two per assessment id. */
  grades: Record<string, OverallGradeCell>;
  /**
   * Overall award DERIVED from the best-of-two per-subject levels via the
   * existing award-derivation rule. The per-sitting D3 safeguard is NOT re-run at
   * the Overall level (each sitting's award is already signed-off, safeguard-checked).
   */
  award: string;
  /** Whether the student appeared in each sitting. */
  inFebruary: boolean;
  inMay: boolean;
}

export interface OverallGradesModel {
  yearId: string;
  yearName: string;
  /** Subjects (union across the two sittings — uses the populated sitting's refs). */
  assessments: AssessmentRef[];
  rows: OverallGradeRow[];
  /** Distribution over the award levels (derived overall awards). */
  distribution: { level: string; count: number }[];
  awardLevels: string[];
  starMap: Record<string, string>;
  performanceLevels: string[];
  february: { cycleId: string | null; cycleName: string | null } | null;
  may: { cycleId: string | null; cycleName: string | null } | null;
  /** True when both sittings are locked (signed off) — Overall is final / certifiable. */
  ready: boolean;
  /** Alias of `ready`: certificates issue only from a signed-off Overall. */
  locked: boolean;
  /**
   * True when the February sitting is DEMO data synthesized from the May cohort.
   * In this build only the live (May) sitting carries real grades and live
   * Supabase is unreachable, so the February baseline is generated locally to
   * exercise the best-of-two rollup. With real two-sitting data this is false.
   */
  demo: boolean;
  note: string;
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

/** One sub-element's achieved level within a major element (unofficial report). */
export interface UnofficialSubElement {
  sub: string;
  level: string;
  stars: string;
}
/** One major element's achieved level + its sub-elements (unofficial report). */
export interface UnofficialElement {
  major: string;
  level: string;
  stars: string;
  subs: UnofficialSubElement[];
}
/** One subject's element/sub-element breakdown for the unofficial diagnostic report. */
export interface UnofficialSubject {
  slot: string;
  assessment: string;
  level: string;
  stars: string;
  elements: UnofficialElement[];
}

export interface StudentSummary {
  /** Maps to the {{RESULTID}} token. */
  participantId: string;
  name: string;
  /** Overall award level. */
  award: string;
  /** Per-subject performance level + stars, in canonical S1..S5 order. */
  subjects: SubjectResult[];
  /**
   * Per-subject major-element / sub-element breakdown for the UNOFFICIAL
   * diagnostic report (richer than the official certificate/performance report).
   * Populated only when grades are locked. Marked clearly as unofficial in the UI.
   */
  unofficial?: UnofficialSubject[];
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
/** How to format a KPI's per-cycle `points` value when the selected cycle changes. */
export type KpiFormat = "int" | "intComma" | "pct";

export interface TrendKpi {
  label: string;
  value: string;
  delta: string;
  points: number[];
  /** Format hint so any selected cycle's point can be rendered consistently. */
  format: KpiFormat;
}

export interface AssessmentTrend {
  name: string;
  points: number[];
  now: string;
  delta: string;
}

export interface AnalyticsTrends {
  /** Short cycle labels oldest → newest (the last is the real live cycle). */
  cycleLabels: string[];
  /** Full cycle names, parallel to `cycleLabels` (for explicit labelling + the selector). */
  cycleNames: string[];
  /** Index of the current (live) cycle within the arrays — the default selection. */
  currentIndex: number;
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

// --- Compare cycles (Analytics › Compare cycles) ----------------------------
// A side-by-side comparison of two-or-more NAMED cycles across the subjects,
// grouped into Exam info · Question statistics · Usable items. Read-only: every
// figure is an already-computed output read from the provider (no recompute).
// The live cycle's metrics are REAL; prior cycles are clearly-labelled MOCK
// (there is no real cross-cycle history yet), mirroring Trends/Compare.

/** One selectable cycle in the picker. */
export interface CompareCycleRef {
  id: string;
  /** Explicit cycle name, e.g. "May 2026" (never "this/last"). */
  name: string;
  mock: boolean;
  live: boolean;
}

/** One raw-score cut between two adjacent performance levels. */
export interface CompareCut {
  /** e.g. "Meets expectations → Exceeds expectations". */
  name: string;
  /** Raw-mark threshold, or null when unavailable for this cycle. */
  value: number | null;
}

/** Per-subject metrics for a single cycle. `null` = unavailable for this cycle. */
export interface CompareSubjectMetrics {
  participants: number | null;
  /** Cohort mean score, % of available marks. */
  scoreMean: number | null;
  scoreMedian: number | null;
  /** Subject total (raw marks) — lets cut-scores render against a max. */
  scoreMax: number | null;
  /** Average p-value (difficulty, 0..1). */
  avgPValue: number | null;
  /** Average point-biserial (discrimination). */
  avgPointBiserial: number | null;
  /** Cronbach's α (from the reliability/Wave-4 output); null if unavailable. */
  alpha: number | null;
  itemsUsable: number | null;
  itemsRemoved: number | null;
  /** Raw cut-scores, best→lowest transitions (length performanceLevels − 1). */
  cuts: CompareCut[];
  /** Performance-level counts, keyed by level label; null if unavailable. */
  perfCounts: Record<string, number> | null;
  /** Share (%) reaching at least "Meets expectations" (pass-or-above). */
  passOrAbove: number | null;
}

/** All metrics for one selected cycle. */
export interface CompareCycleData extends CompareCycleRef {
  /** Sum of per-subject candidate counts (participation total). */
  participantsTotal: number | null;
  /** Mean of per-subject cohort means (%). */
  avgScoreAllSubjects: number | null;
  /** Candidates earning any award (i.e. not the lowest "No Award" band). */
  passOrAboveCount: number | null;
  avgPValue: number | null;
  avgAlpha: number | null;
  /** Overall award distribution, keyed by award level → candidate count. */
  awardDist: Record<string, number>;
  /** Per-subject metrics, keyed by assessment id. */
  subjects: Record<string, CompareSubjectMetrics>;
}

export interface CompareCyclesModel {
  /** Every selectable cycle, newest → oldest. */
  available: CompareCycleRef[];
  /** The chosen cycle ids, oldest → newest. */
  selectedIds: string[];
  /** The chosen cycles' data, parallel to `selectedIds` (oldest → newest). */
  cycles: CompareCycleData[];
  /** The subjects compared (live cycle's assessments). */
  subjects: { id: string; short: string; full: string }[];
  /** Overall award levels, best → lowest (confirmed vocabulary). */
  awardLevels: string[];
  /** Per-subject performance levels, best → lowest (confirmed vocabulary). */
  performanceLevels: string[];
  /** True when any selected cycle is mock (drives the mock banner). */
  anyMock: boolean;
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

/**
 * Borderline (marginal) flagging band — a workspace config value the engine reads
 * when flagging students just below a grade boundary. `bandPct` is the symmetric
 * ±% window (percentage points) around each threshold; the flag fires for the
 * just-below side, feeding the mark-adjustment workflow. Grade-bearing input:
 * editing it re-flags through the full grade recompute (incl. the D3 safeguard).
 */
export interface BorderlineConfig {
  /** Borderline band, in percentage points. Bounds enforced server-side. */
  bandPct: number;
}

export interface ConfigModel {
  /** The engine's active rating thresholds (read-only — they drive item ratings). */
  thresholds: QualityThresholdRow[];
  retention: RetentionConfig;
  branding: BrandingConfig;
  safeguard: SafeguardConfig;
  /** The configurable borderline (marginal) flagging band (percentage points). */
  borderline: BorderlineConfig;
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
  /** 0010 — active test centres to choose from (the sitting is created under one). */
  testCentres: TestCentreSummary[];
  /** Pre-selected centre (first active centre), or null when none exist yet. */
  defaultTestCentreId: string | null;
}

export interface CreateCycleInput {
  name: string;
  sittingDate: string;
  assessmentIds: string[];
  /** 0010 — the test centre to create this sitting (and its year) under. */
  testCentreId: string;
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
  /** D3 items answered correctly on the selected exam scope. */
  topDifficultyCorrect: number;
  /** D3 items available on the selected exam scope (after exclusions). */
  topDifficultyAvailable: number;
  /** Majority threshold for the selected scope (strictly more than half of available). */
  majority: number;
  /** Whether the student cleared the majority on the selected scope. */
  meets: boolean;
  provisionalAward: string;
  cappedAward: string;
  result: SafeguardResult;
  /** The visible "why" when capped (the failing exam's working); null otherwise. */
  capReason: string | null;
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
  /** Explains the D3 metric: correct (not attempts) vs the dynamic majority of available. */
  attemptedNote: string;
}

// --- Safeguard configuration (Settings → Configuration) ----------------------
export interface SafeguardConfig {
  /**
   * Which demand level counts as "top-difficulty" (D3) for the per-student
   * Distinction safeguard. This genuinely drives the engine — the safeguard reads
   * the D3 pool from this demand level. The *threshold* is NOT a fixed count: it
   * is the dynamic majority of the available D3 items on each exam (see
   * `d3MajorityThreshold` / `passesD3Majority`), so there is no editable "minimum
   * questions" knob.
   */
  topDifficultyDemand: string;
  demandLevels: string[];
}
