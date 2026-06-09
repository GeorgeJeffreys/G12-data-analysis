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
}

export interface ItemAnalysisInput {
  assessments: AssessmentRef[];
  /** Engine-computed item statistics (carry assessmentId + metadata). */
  stats: ItemStat[];
  /** Current exclusion decision per item id (human gate 1). */
  reviews?: Record<string, ItemReviewDecision>;
}

export interface ScoreAnalysisInput {
  assessments: AssessmentRef[];
  participants: ParticipantRef[];
  /** Engine-computed per-participant, per-assessment scores. */
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
