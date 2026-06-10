/**
 * Types for the Questionmark ingest + validation pipeline (Sections 5 & 10).
 */

import type { DemandLevel } from "@/lib/types/database";

/** A raw row from the Questionmark export (xlsx `in` sheet or csv). */
export type RawExportRow = Record<string, unknown>;

/** A cleaned, MCQ-only, encoding-repaired response in long format. */
export interface CleanResponse {
  assessmentName: string;
  qmQuestionId: string;
  qmParticipantId: string;
  participantPseudonym: string;
  wording: string | null;
  majorElement: string | null;
  subElement: string | null;
  demandLevel: DemandLevel | null;
  questionType: string;
  maxScore: number;
  answerGiven: string | null;
  answerScore: number;
  responseTime: number | null;
  resultStatus: string | null;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface ValidationCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  count?: number;
}

export interface ValidationReport {
  /** True when no check hard-failed. Warnings do not block. */
  passed: boolean;
  checks: ValidationCheck[];
  stats: {
    rawRows: number;
    mcqRows: number;
    droppedSurveyRows: number;
    droppedNonMcqRows: number;
    assessments: number;
    participants: number;
    items: number;
  };
}

export interface IngestOptions {
  /** Preferred sheet name for xlsx files. Defaults to "in". */
  sheetName?: string;
}
