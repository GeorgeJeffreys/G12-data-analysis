/**
 * Domain types for the computation engine (Section 8 of the spec).
 *
 * These are deliberately framework-free and decoupled from the database row
 * shapes so the engine can be implemented in TypeScript today and replaced by a
 * Python service later with zero changes to callers. Callers map their data
 * into these inputs and read these outputs; nothing here depends on Supabase,
 * Next.js or SheetJS.
 */

export type QualityRating = "Good" | "Review" | "Flag";

/** One participant's score on one item, tagged with its assessment. */
export interface ResponseRecord {
  participantId: string;
  itemId: string;
  assessmentId: string;
  /** Numeric score for this response. Dichotomous items are 0/1. */
  score: number;
}

/** Optional item metadata, used to enrich stats output and to roll up. */
export interface ItemMeta {
  itemId: string;
  assessmentId: string;
  wording?: string | null;
  majorElement?: string | null;
  subElement?: string | null;
  demandLevel?: string | null;
  /** Maximum attainable score for the item. Defaults to 1 (dichotomous MCQ). */
  maxScore?: number;
}

/** The four psychometric statistics plus ratings for a single item. */
export interface ItemStat {
  itemId: string;
  assessmentId: string;
  /** Number of participants who answered this item. */
  n: number;
  /** Difficulty: mean item score. */
  pValue: number;
  pRating: QualityRating;
  /** Corrected item-total correlation (item vs total of the OTHER items). */
  itemTotal: number | null;
  itRating: QualityRating;
  /** Point-biserial correlation (item vs the full total, including the item). */
  pointBiserial: number | null;
  pbRating: QualityRating;
  /** Upper-minus-lower discrimination on ~33% groups. */
  discrimination: number;
  discRating: QualityRating;
  /** Worst-of-four summary rating. */
  overallReview: QualityRating;
  /** Optional carried-through metadata. */
  wording?: string | null;
  majorElement?: string | null;
  subElement?: string | null;
  demandLevel?: string | null;
  engineVersion: string;
}

/** Per-participant, per-assessment score on the retained (non-excluded) items. */
export interface ParticipantScore {
  participantId: string;
  assessmentId: string;
  /** Sum of scores on retained items the participant answered. */
  raw: number;
  /** raw / max-attainable on retained items answered, as a percentage. */
  pct: number;
  /** Count of retained items the participant answered. */
  itemsSeen: number;
}

export interface AssessmentRollup {
  assessmentId: string;
  participants: number;
  meanRaw: number;
  meanPct: number;
}

/** Mean item score for a group (major element or demand level) of items. */
export interface GroupMean {
  assessmentId: string;
  key: string;
  meanScore: number;
  items: number;
}

export interface DistributionBin {
  /** Inclusive lower bound of the bucket, in percent. */
  from: number;
  /** Exclusive upper bound of the bucket, in percent (100 bucket is inclusive). */
  to: number;
  count: number;
}

export interface RollUp {
  byAssessment: AssessmentRollup[];
  byMajorElement: GroupMean[];
  byDemandLevel: GroupMean[];
  /** Overall histogram of participant percentages across all assessments. */
  distribution: DistributionBin[];
}

export interface RollUpInput {
  participantScores: ParticipantScore[];
  responses: ResponseRecord[];
  items: ItemMeta[];
  /** Items excluded from scoring; defaults to none. */
  excludedItemIds?: string[];
}

/**
 * A single (participant, item) response excluded for that one student only — a
 * technical fault on that question for that student. Removing it drops the
 * response from BOTH the student's score AND that item's cohort statistics, so a
 * glitched response can't skew the cohort psychometrics.
 */
export interface PerStudentExclusion {
  participantId: string;
  itemId: string;
}

export interface ItemStatsInput {
  responses: ResponseRecord[];
  items?: ItemMeta[];
  /** Responses to drop per-student before computing item stats. */
  perStudentExcluded?: PerStudentExclusion[];
}

// --- Ingest contract (Section 8: ingestAndClean) ----------------------------
// Re-exported from the ingest module so the engine interface is complete.
export type { CleanResponse, ValidationReport, RawExportRow } from "@/lib/ingest/types";

import type { CleanResponse, ValidationReport, RawExportRow } from "@/lib/ingest/types";

export interface IngestResult {
  cleanedResponses: CleanResponse[];
  validationReport: ValidationReport;
}

export type RawExport = RawExportRow[];
