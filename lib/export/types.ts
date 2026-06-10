/**
 * Inputs for the Excel exports (Section 9). These are decoupled from the
 * database rows so any caller can assemble them from engine output + decisions.
 */

import type {
  ItemMeta,
  ItemStat,
  PerStudentExclusion,
  ResponseRecord,
} from "@/lib/engine";

export interface AssessmentRef {
  id: string;
  name: string;
}

export interface ParticipantRef {
  id: string;
  /** Display label (the pseudonym — no PII in exports). */
  label: string;
}

export interface ItemReviewDecision {
  exclude: boolean;
  reason?: string | null;
  notes?: string | null;
}

/**
 * One confirmed per-student technical exclusion — a fault on one question for
 * one student that the team chose to exclude. Shared by the Item-analysis and
 * Grades workbooks (both emit the identical sheet from this record).
 */
export interface PerStudentExclusionRecord {
  participantId: string;
  participantName: string;
  assessmentName: string;
  questionId: string;
  questionWording: string | null;
  demandLevel: string | null;
  reason: string;
  decidedBy: string;
  decidedAt: string;
}

/**
 * A minimal response-level fact used to derive the per-item display metrics
 * (presented / answered counts, average response time) that the engine's
 * statistics do not carry. Callers map their cleaned responses to this shape.
 */
export interface ItemResponseFact {
  assessmentId: string;
  itemId: string;
  participantId: string;
  /** True when the participant actually gave an answer to the item. */
  answered: boolean;
  /** Response time in seconds, or null if unknown. */
  responseTime: number | null;
}

// --- Item Analysis (assembled, ready to render) -----------------------------

export interface ItemAnalysisRow {
  stat: ItemStat;
  participantsPresented: number;
  participantsAnswered: number;
  avgResponseTime: number | null;
  notes: string | null;
  exclude: boolean;
  removeReason: string | null;
}

export interface ItemAnalysisBlock {
  id: string;
  name: string;
  participants: number;
  rowsAnalysed: number;
  /** Upper/lower group size for discrimination = round(participants / 3). */
  groupSize: number;
  rows: ItemAnalysisRow[];
}

export interface ItemAnalysisInput {
  cycleName: string;
  blocks: ItemAnalysisBlock[];
  /** Confirmed per-student exclusions — rendered as an extra trailing sheet. */
  perStudentExclusions?: PerStudentExclusionRecord[];
}

/** Convenience inputs for the assembler that builds `ItemAnalysisInput`. */
export interface AssembleItemAnalysisArgs {
  cycleName: string;
  assessments: AssessmentRef[];
  stats: ItemStat[];
  facts: ItemResponseFact[];
  reviews?: Record<string, ItemReviewDecision>;
  perStudentExclusions?: PerStudentExclusionRecord[];
}

// --- Overall score analysis (canonical layout) ------------------------------

/**
 * One RETAINED scored response (cohort-excluded and per-student-excluded
 * responses are already dropped). Carries the item metadata needed for the
 * major-element and demand-level breakdowns.
 */
export interface ScoredItemResponse {
  participantId: string;
  assessmentId: string;
  itemId: string;
  majorElement: string | null;
  demandLevel: string | null;
  /** The participant's score on this item. */
  score: number;
  /** Max attainable for this item (defaults to 1 for dichotomous MCQ). */
  maxScore: number;
}

export interface ScoreAnalysisInput {
  assessments: AssessmentRef[];
  participants: ParticipantRef[];
  /** Retained responses only — both exclusion kinds already removed. */
  scoredResponses: ScoredItemResponse[];
  /** Free-text note recorded on the Summary sheet (which score run produced this). */
  scoreRunNote?: string;
}

/** Convenience inputs to assemble `ScoreAnalysisInput` from engine primitives. */
export interface AssembleScoreAnalysisArgs {
  assessments: AssessmentRef[];
  participants: ParticipantRef[];
  responses: ResponseRecord[];
  items: ItemMeta[];
  /** Cohort-excluded item ids (dropped for everyone). */
  excludedItemIds?: string[];
  /** Per-student (participant, item) exclusions (dropped for that student only). */
  perStudentExcluded?: PerStudentExclusion[];
  scoreRunNote?: string;
}

// --- Grades workbook (canonical layout) -------------------------------------

export interface SubjectColumn {
  /** Stable key, e.g. "ApplicableMath". */
  key: string;
  /** Column-header prefix, e.g. "ApplicableMath" → ApplicableMath_Level etc. */
  prefix: string;
  /** Display label. */
  label: string;
  /** The suite assessment mapped to this canonical subject slot (or null). */
  assessmentId: string | null;
}

export interface StudentGradeRow {
  participantId: string;
  participantName: string;
  /** Per assessmentId → { level, score, pct }. */
  perAssessment: Record<string, { level: string; score: number | null; pct: number | null }>;
  overallAward: string;
  overallPct: number | null;
  capApplied: boolean;
  capReason: string | null;
  capOverridden: boolean;
  overrideReason: string | null;
}

export interface GradeAuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
  entity: string;
  entityId: string;
}

export interface GradesInput {
  cycleName: string;
  participantCount: number;
  assessmentCount: number;
  lockedAt: string | null;
  signedOffBy: string | null;
  /** Award levels, best → lowest. */
  awardLevels: string[];
  /** Performance levels, best → lowest. */
  performanceLevels: string[];
  /** Canonical subject columns, in template order. */
  subjects: SubjectColumn[];
  students: StudentGradeRow[];
  awardDistribution: { level: string; count: number; pct: number }[];
  /** Per-assessment performance-level distribution. */
  performanceDistribution: { assessmentName: string; counts: Record<string, number> }[];
  perStudentExclusions: PerStudentExclusionRecord[];
  audit: GradeAuditEntry[];
}
