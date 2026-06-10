/**
 * Inputs for the Excel exports (Section 9). These are decoupled from the
 * database rows so any caller can assemble them from engine output + decisions.
 */

import type { ItemStat, ParticipantScore, RollUp } from "@/lib/engine";

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
}

/** Convenience inputs for the assembler that builds `ItemAnalysisInput`. */
export interface AssembleItemAnalysisArgs {
  cycleName: string;
  assessments: AssessmentRef[];
  stats: ItemStat[];
  facts: ItemResponseFact[];
  reviews?: Record<string, ItemReviewDecision>;
}

// --- Score analysis & grades (unchanged) ------------------------------------

export interface ScoreAnalysisInput {
  assessments: AssessmentRef[];
  participants: ParticipantRef[];
  scores: ParticipantScore[];
  rollUp?: RollUp;
}

export interface GradeRecord {
  participantId: string;
  /** assessment id, or "overall". */
  scope: string;
  gradeLabel: string | null;
  score: number | null;
}

export interface GradesInput {
  assessments: AssessmentRef[];
  participants: ParticipantRef[];
  grades: GradeRecord[];
}
