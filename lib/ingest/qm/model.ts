/**
 * Canonical data model for the Questionmark 3-export ingest.
 *
 * A `ResultId` = one participant's sitting of one assessment; the three files
 * join on it. The canonical model is the faithful intake artifact: it trusts QM's
 * computed totals, retains every question (no QuestionStatus filtering) and every
 * participant field, excludes surveys, normalises subject-name variants, and tags
 * the sitting. Scoring policy (essay half-weighting, Beta handling, scored max)
 * lives downstream and is deliberately NOT applied here.
 */

/** Which sitting an export belongs to, parsed from the group name / dates. */
export interface Sitting {
  /** Raw token, e.g. "MAY2026". */
  code: string;
  /** Normalised period (matches the DB `sitting_period` enum). */
  period: "february" | "may";
  year: number;
  /** Display label, e.g. "May 2026". */
  label: string;
}

/** A participant, keyed by email — every personal field retained (GDPR: live only). */
export interface QmParticipant {
  /** Lowercased `ResultParticipantName` (the email). The stable cross-subject key. */
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  /** `ResultSpecialField4`. */
  dob: string | null;
  /** `ResultSpecialField5`. */
  gender: string | null;
  /** `ResultParticipantDetails` (e.g. nationality), retained as-is. */
  details: string | null;
  /** Cohort labels seen across this participant's results (`ResultGroupName`). */
  groupNames: string[];
}

/** A distinct question within a subject (item identity + metadata). */
export interface QmItem {
  /** Canonical subject name this item belongs to. */
  subject: string;
  questionId: string;
  questionType: string;
  maxScore: number;
  /** `QuestionStatus` — 'Normal' / 'Beta'. INFORMATIONAL only (never filtered). */
  status: string | null;
  topicName: string | null;
  topicPath: string | null;
  wording: string | null;
}

/** One participant's answer to one question within a result. */
export interface QmItemResponse {
  questionId: string;
  answerGiven: string | null;
  /** Per-item score, trusted from QM (`AnswerScore`). */
  answerScore: number;
  responseTime: number | null;
  questionType: string;
  status: string | null;
}

/** One participant's rollup on one curriculum topic, trusted from QM (Topics.csv). */
export interface QmTopicRollup {
  topicId: string | null;
  name: string;
  path: string | null;
  score: number;
  maximumScore: number;
  percentageScore: number | null;
  questionCount: number;
}

/** One participant-sitting of one assessment (one ResultId). */
export interface QmResult {
  resultId: string;
  /** Canonical subject name (variants normalised). */
  subject: string;
  /** The raw `AssessmentName` before normalisation. */
  rawSubjectName: string;
  participantEmail: string;
  groupName: string | null;
  sitting: Sitting | null;
  /** `ResultStatus` technical flag ('Finished OK' / 'Finished Abnormally' / …). */
  status: string | null;
  /** `ResultAssessmentAttemptNumber` (resit indicator). */
  attemptNumber: number | null;
  /** QM's computed totals — trusted, never recomputed. */
  totalScore: number;
  maximumScore: number;
  percentageScore: number | null;
  scoreband: string | null;
  responses: QmItemResponse[];
  topics: QmTopicRollup[];
}

/** A graded subject (the `G12++ …` assessments; surveys excluded). */
export interface QmSubject {
  /** Canonical name. */
  name: string;
  /** Every raw `AssessmentName` that normalised into this subject. */
  rawNames: string[];
  rtl: boolean;
  /** Distinct questions (by QuestionId). */
  itemCount: number;
  /** Modal QM `ResultMaximumScore` across the subject's results. */
  qmMaximumScore: number;
  /** Number of results (participant-sittings) in this subject. */
  resultCount: number;
  /** Distinct Beta-tagged questions (informational — not excluded here). */
  betaItemCount: number;
}

/** A result whose item-level scores don't reconcile with QM's stated totals. */
export interface ReconcileIssue {
  resultId: string;
  subject: string;
  participantEmail: string;
  /** QM's `ResultMaximumScore`. */
  expectedMax: number;
  /** Σ item `QuestionMaximumScore`. */
  sumItemMax: number;
  /** QM's `ResultTotalScore`. */
  expectedTotal: number;
  /** Σ item `AnswerScore`. */
  sumItemScore: number;
  maxOk: boolean;
  totalOk: boolean;
}

/** Integrity-guard outcome over every graded result. */
export interface IntegrityReport {
  resultsChecked: number;
  reconciled: number;
  issues: ReconcileIssue[];
  /** True when every result reconciles. Non-reconciling results warn, never block. */
  ok: boolean;
}

/** The full canonical model built from the three joined exports. */
export interface CanonicalModel {
  /** Dominant sitting tag for this export (from group names / dates). */
  sitting: Sitting | null;
  subjects: QmSubject[];
  participants: QmParticipant[];
  /** Distinct items across all graded subjects (keyed subject + QuestionId). */
  items: QmItem[];
  /** One per graded participant-sitting. */
  results: QmResult[];
  integrity: IntegrityReport;
  /** Distinct raw assessment names dropped as surveys/UX. */
  excludedSurveys: string[];
  stats: {
    assessmentRows: number;
    itemRows: number;
    topicRows: number;
    gradedResults: number;
    surveyResults: number;
  };
}
