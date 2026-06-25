/**
 * Ingest pipeline entry points.
 *
 * `ingestAndClean` is the engine-facing contract (Section 8): given a parsed raw
 * export it returns the cleaned MCQ responses and a validation report. The file
 * parsing step (`parseExport`) is kept separate so the engine boundary stays
 * data-only and easy to unit-test.
 */

import { normalizeResponses } from "./normalize";
import { validate } from "./validate";
import type { CleanResponse, RawExportRow, ValidationReport } from "./types";

export { parseExport } from "./parse";
export type { ParseResult } from "./parse";
export {
  normalizeResponses,
  parseDemandLevel,
  parseItemSet,
  deriveElements,
  isSurveyAssessment,
  normalizeRemoveColumnHeader,
  stripHtml,
  MCQ_QUESTION_TYPE,
} from "./normalize";
export { validate } from "./validate";
export { repairText, repairValue, looksLikeMojibake } from "./repair";
export {
  splitBySubject,
  summarizeSubject,
  summarizeSubjects,
  mergeRawExports,
} from "./split";
export type { SubjectSummary, SubjectElementSummary } from "./split";
export type * from "./types";

// 3-CSV Questionmark ingest (Items + Assessments + Topics → canonical model).
export {
  ingestThreeExports,
  buildCanonicalModel,
  buildCanonicalModelFromTables,
  detectThreeExports,
  detectKind,
  DetectionError,
  parseCsv,
  normalizeSubjectName,
  parseSitting,
} from "./qm";
export type {
  ThreeExportIngest,
  NamedInput,
  QmFileKind,
  CanonicalModel,
  QmSubject,
  QmParticipant,
  QmItem,
  QmResult,
  QmTopicRollup,
  Sitting,
  IntegrityReport,
  ReconcileIssue,
} from "./qm";

export interface IngestAndCleanResult {
  cleanedResponses: CleanResponse[];
  validationReport: ValidationReport;
}

/** Section 8 `ingestAndClean(rawExport)` — clean + validate already-parsed rows. */
export function ingestAndClean(
  rawExport: readonly RawExportRow[],
): IngestAndCleanResult {
  const { clean, droppedSurveyRows, droppedNonMcqRows } =
    normalizeResponses(rawExport);
  const validationReport = validate(
    rawExport,
    clean,
    droppedSurveyRows,
    droppedNonMcqRows,
  );
  return { cleanedResponses: clean, validationReport };
}
