/**
 * DataProvider — the repository interface every screen talks to. This is the
 * swap point for persistence, mirroring the discipline used for the computation
 * engine.
 *
 * ## Swap point (read before wiring Supabase)
 *
 * The UI imports only this interface and the read-model types in `./types`. The
 * current implementation, `InMemoryDataProvider`, seeds itself from genuine
 * engine output (`seed.generated.json`) and keeps decisions (exclusions,
 * boundaries, locks) in memory — they reset on reload. To go live:
 *   1. Implement `DataProvider` with a class backed by Supabase (queries +
 *      the SECURITY DEFINER RPCs from migration 0001), mapping rows to the same
 *      read models.
 *   2. Provide it through `DataProviderContext` instead of the in-memory one.
 * No screen or component changes — only the provider does.
 */

import type {
  AnalyticsCompare,
  AnalyticsTrends,
  AuditFilter,
  AuditModel,
  BoundaryMode,
  ConfigModel,
  CreateCycleInput,
  CurrentUser,
  CycleDetail,
  CycleSummary,
  DocSettings,
  DocumentsModel,
  DuplicateStrategy,
  GradesModel,
  GradingDefaultsModel,
  IngestModel,
  MembersModel,
  NewCycleModel,
  PerformanceReportModel,
  RetentionConfig,
  ReviewModel,
  ItemDetailModel,
  RolesModel,
  BoundaryModel,
  BrandingConfig,
  StudentReviewModel,
  DistinctionSafeguardModel,
  EssayMarksModel,
  AdjustmentsModel,
  CompositionModel,
  IncidentDecision,
} from "./types";
import type { GradingConfig } from "./grading";
import type { ScoringConfig, QualityThresholds } from "@/lib/engine";

/** One row of the optional technical-errors spreadsheet (columns: student, question, error). */
export interface TechnicalErrorRow {
  student: string;
  question: string;
  error: string;
}

/** One row of the optional incident log / complaints file (free-text, untriaged). */
export interface IncidentInput {
  source: "incident_log" | "complaint";
  /** Free-text student name from the file. */
  studentName: string;
  /** Exam code (AM/ST/AFL/ESL…) — incident_log only. */
  exam?: string;
  issueType?: string;
  actionTaken?: string;
  questionsAffected?: string;
  staff?: string;
  // complaint-only fields
  email?: string;
  school?: string;
  description?: string;
}

/** A human triage decision recorded against one incident on the Adjustments screen. */
export interface IncidentDecisionInput {
  /** Who the alteration applies to (null = undecided). */
  applyTo: "student" | "subject" | "none";
  /** Roster student id when applyTo === "student". */
  studentId?: string | null;
  /** Subject (assessment) id for the alteration; defaulted from the exam code. */
  subjectId?: string | null;
  /** Raw marks added (+) or subtracted (−). */
  marks?: number;
  reason?: string | null;
}

/** One essay row from the optional essay-marks spreadsheet (one per essay). */
export interface EssayUploadRow {
  /** Real ParticipantID from the file (e.g. A-A-260506). */
  participantId: string;
  /** Subject sheet code: AFL (Arabic 1st Language) or ESL (English 2nd Language). */
  subjectCode: "AFL" | "ESL";
  /** The essay's final mark out of 20 (the TotalScore column). */
  totalScore: number;
}

export interface SetBoundaryInput {
  mode?: BoundaryMode;
  /** Replace the whole cut-point array. */
  cuts?: number[];
  /** Replace the whole target-% array. */
  targets?: number[];
  /** Update a single cut-point (drag / type). */
  cutIndex?: number;
  cutValue?: number;
  /** Update a single target %. */
  targetIndex?: number;
  targetValue?: number;
}

export interface DataProvider {
  // identity / auth (mocked for now)
  getCurrentUser(): CurrentUser;

  // reads
  listCycles(): CycleSummary[];
  getCycle(cycleId: string): CycleDetail | null;
  getIngest(cycleId: string): IngestModel | null;
  getReview(cycleId: string, assessmentId: string): ReviewModel | null;
  /** Full per-question deep-dive for the Item review right panel. */
  getItemDetail(cycleId: string, assessmentId: string, itemId: string): ItemDetailModel | null;
  getBoundaries(cycleId: string, scope: string): BoundaryModel | null;
  getGrades(cycleId: string): GradesModel | null;
  /** Per-student performance + per-element levels for the performance-report export. */
  getPerformanceReport(cycleId: string): PerformanceReportModel | null;
  getGradingDefaults(): GradingDefaultsModel;
  /** Per-student technical exclusions (optional Student-review step). */
  getStudentReview(cycleId: string): StudentReviewModel | null;
  /** Distinction safeguard for one assessment scope (grading stage). */
  getDistinctionSafeguard(cycleId: string, scope?: string): DistinctionSafeguardModel | null;
  /** Student Summary for document generation (only populated once locked). */
  getDocuments(cycleId: string): DocumentsModel | null;

  // settings: users & roles
  getMembers(): MembersModel;
  getRoles(): RolesModel;

  // settings: configuration
  getConfig(): ConfigModel;
  /**
   * The full scoring configuration the engine reads — item-quality thresholds
   * plus the performance/award level definitions and default cut-points. This is
   * the single object the Settings editor (next prompt) will mutate.
   */
  getScoringConfig(): ScoringConfig;

  // audit & analytics
  getAuditLog(cycleId: string | null, filter: AuditFilter, search: string): AuditModel;
  getAnalyticsTrends(): AnalyticsTrends;
  getAnalyticsCompare(): AnalyticsCompare;

  // new cycle
  getNewCycle(): NewCycleModel;

  // writes
  setItemExcluded(
    cycleId: string,
    assessmentId: string,
    itemId: string,
    excluded: boolean,
    reason?: string | null,
  ): void;
  setBoundary(cycleId: string, scope: string, input: SetBoundaryInput): void;
  setGradingDefaults(patch: Partial<GradingConfig>): void;
  /** Edit the engine's item-quality Good/Review/Flag thresholds (Lead/Admin only). */
  setQualityThresholds(patch: Partial<QualityThresholds>): void;
  setDocumentSettings(cycleId: string, patch: Partial<DocSettings>): void;
  resolveDuplicates(cycleId: string, strategy: DuplicateStrategy): void;
  lockCycle(cycleId: string): void;
  unlockCycle(cycleId: string): void;

  // members & roles mutations
  inviteMember(email: string, roleId: string): void;
  setMemberRole(memberId: string, roleId: string): void;
  removeMember(memberId: string): void;
  resendInvite(memberId: string): void;
  createRole(name: string): void;
  renameRole(roleId: string, name: string): void;
  deleteRole(roleId: string): void;
  setCapability(roleId: string, capabilityId: string, granted: boolean): void;

  // per-student technical exclusions (Student review)
  uploadTechnicalErrors(cycleId: string, fileName: string, rows: TechnicalErrorRow[]): void;
  loadSampleTechnicalErrors(cycleId: string): void;
  clearTechnicalErrors(cycleId: string): void;
  setIncidentDecision(cycleId: string, incidentId: string, decision: IncidentDecision, reason?: string | null): void;

  // essay marks (English/Arabic only — optional, non-blocking upload at Ingest)
  getEssayMarks(cycleId: string): EssayMarksModel | null;
  uploadEssayMarks(cycleId: string, fileName: string, rows: EssayUploadRow[]): void;
  loadSampleEssayMarks(cycleId: string): void;
  clearEssayMarks(cycleId: string): void;

  // incident log → alterations triage (Adjustments step)
  getAdjustments(cycleId: string): AdjustmentsModel | null;
  uploadIncidentLog(cycleId: string, fileName: string, rows: IncidentInput[]): void;
  loadSampleIncidentLog(cycleId: string): void;
  clearIncidentLog(cycleId: string): void;
  /** Record (or clear) the human triage decision + alteration for one incident. */
  decideIncident(cycleId: string, incidentId: string, decision: IncidentDecisionInput): void;
  /** Transparent per-student per-subject composition: MCQ + Essay + Alterations = total. */
  getComposition(cycleId: string): CompositionModel | null;

  // distinction safeguard (grading stage)
  confirmDistinctionCaps(cycleId: string): void;
  overrideDistinctionCap(cycleId: string, studentId: string, reason: string): void;
  undoDistinctionOverride(cycleId: string, studentId: string): void;

  // configuration mutations
  setRetention(patch: Partial<RetentionConfig>): void;
  setBranding(patch: Partial<BrandingConfig>): void;
  setSafeguardConfig(patch: { distinctionThreshold?: number; topDifficultyDemand?: string }): void;

  // audit-writing actions (UI-driven export / document generation)
  recordExport(cycleId: string, detail: string): void;
  recordDocuments(cycleId: string, detail: string): void;

  // new-cycle action (mock — no DB)
  createCycle(input: CreateCycleInput): string;

  // reactivity (for useSyncExternalStore)
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}
