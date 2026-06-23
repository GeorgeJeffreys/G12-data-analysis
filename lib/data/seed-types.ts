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

export interface SeedItem {
  id: string;
  wording: string | null;
  major: string | null;
  sub: string | null;
  demand: string | null;
  maxScore: number;
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
  /**
   * Whether the participant actually attempted the item. Omitted (treated as
   * answered) for the common case; set to `false` only when the item was
   * presented but left blank. Read as `answered = r.a !== false`. Used for the
   * display-only "% of D3 questions answered" per-student metric.
   */
  a?: boolean;
}

/** A participant whose sitting of this assessment finished with a technical-fault status. */
export interface SeedTechnicalIncident {
  /** participant id */
  p: string;
  /** the raw result_status flag, e.g. 'Finished Abnormally' / 'Time Limit Exceeded'. */
  status: string;
}

export interface SeedAssessment {
  id: string;
  name: string;
  shortName: string;
  rtl: boolean;
  stageIndex: number;
  items: SeedItem[];
  responses: SeedResponse[];
  /**
   * Participants whose sitting of this assessment finished with a technical-fault
   * result status (non-normal). Display-only — feeds the per-student technical-
   * incident count; never affects scoring. Absent/empty when all finished OK.
   */
  technicalIncidents?: SeedTechnicalIncident[];
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
  /**
   * The three Questionmark CSVs recognised at ingest (by columns). Optional so
   * legacy seeds / generated data without it still load; the provider defaults the
   * absent kinds to null.
   */
  files?: { items: string | null; assessments: string | null; topics: string | null };
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
