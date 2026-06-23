/**
 * Shape of the generated seed (`seed.generated.json`), produced by
 * `scripts/build-seed.mts` by running the real ingest + engine over
 * `data/sample_qm_export.xlsx`. The in-memory DataProvider reads this; no
 * database is involved in this build.
 *
 * Everything here is genuine computed output except where a field is marked
 * `mock` (prior cycles, which have no data source yet).
 */

import type { QualityRating } from "@/lib/engine";
import type { SpeededResult, TimingResult } from "@/lib/diagnostics";
import type { ValidationReport } from "@/lib/ingest/types";

/** One multiple-choice answer option for a question (from the QM export). */
export interface SeedAnswerOption {
  /** Display label for the choice — A, B, C… in presented order. */
  label: string;
  /** Cleaned option text (HTML/entities stripped). */
  text: string;
  /** True when this option is (one of) the correct answer(s). */
  correct: boolean;
}

export interface SeedItem {
  id: string;
  wording: string | null;
  major: string | null;
  sub: string | null;
  demand: string | null;
  maxScore: number;
  /**
   * The question's multiple-choice answer options, from the QM export
   * (`QuestionPossibleAnswers` / `QuestionCorrectAnswers`). Optional — only the
   * generated demo seed carries these; live/DB-hydrated items leave it absent.
   */
  options?: SeedAnswerOption[] | null;
  /** Participants who answered (engine n) and were presented the item. */
  participantsAnswered: number;
  participantsPresented: number;
  avgResponseTime: number | null;
  // engine statistics
  pValue: number;
  pRating: QualityRating;
  itemTotal: number | null;
  itRating: QualityRating;
  pointBiserial: number | null;
  pbRating: QualityRating;
  discrimination: number;
  discRating: QualityRating;
  overallReview: QualityRating;
  /** Derived 0–100 quality index (transparent composite of the four ratings). */
  qualityIndex: number;
}

export interface SeedResponse {
  p: string; // participant id
  i: string; // item id
  s: number; // score
}

export interface SeedAssessment {
  id: string;
  name: string;
  shortName: string;
  rtl: boolean;
  stageIndex: number;
  items: SeedItem[];
  responses: SeedResponse[];
}

export interface SeedParticipant {
  /** Stable internal key (pseudonym in the demo seed; row UUID on live data). */
  id: string;
  /** Display name (full name on live data; "Student NN" in the de-identified demo). */
  label: string;
  /** Human Student ID for display (qm_participant_id on live data). Falls back to `id`. */
  studentId?: string;
}

export interface SeedPreview {
  headers: string[];
  rows: (string | number | null)[][];
}

/** Speededness & timing diagnostics for one group (Overall or a major element). */
export interface SeedDiagGroup {
  key: string;
  speeded: SpeededResult;
  timing: TimingResult;
}
/** Diagnostics for one assessment: an Overall group followed by per-element groups. */
export interface SeedAssessmentDiagnostics {
  assessmentId: string;
  assessmentName: string;
  groups: SeedDiagGroup[];
}

export interface SeedLiveCycle {
  id: string;
  name: string;
  region: string;
  startedAt: string;
  lastActivity: string;
  stageIndex: number;
  fileName: string;
  fileSizeMB: number;
  uploadedAgo: string;
  validation: ValidationReport;
  preview: SeedPreview;
  duplicates: number;
  participants: SeedParticipant[];
  assessments: SeedAssessment[];
  /** Informational speededness/timing diagnostics, computed at build time. */
  diagnostics: SeedAssessmentDiagnostics[];
}

export interface SeedPriorCycle {
  id: string;
  name: string;
  stageIndex: number;
  stepsDone: number;
  participants: number;
  assessments: number;
  lastActivity: string;
  locked: boolean;
  /** Always true — prior cycles have no real data source yet. */
  mock: boolean;
}

export interface Seed {
  generatedAt: string;
  engineVersion: string;
  liveCycle: SeedLiveCycle;
  priorCycles: SeedPriorCycle[];
}
