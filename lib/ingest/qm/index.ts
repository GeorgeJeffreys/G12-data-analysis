/**
 * Public entry point for the Questionmark 3-export ingest (Items + Assessments +
 * Topics). Detects each file by header signature, builds the canonical model
 * (joined on ResultId), and — via the bridge — also produces the engine-facing
 * `CleanResponse[]` + validation report the rest of the pipeline already consumes.
 */

import { normalizeResponses } from "../normalize";
import { validate } from "../validate";
import type { CleanResponse, ValidationReport } from "../types";
import { detectThreeExports, type NamedInput } from "./detect";
import { buildCanonicalModelFromTables } from "./canonical";
import { toCombinedRows } from "./bridge";
import type { CanonicalModel } from "./model";

export { parseCsv } from "./csv";
export type { CsvTable } from "./csv";
export { detectKind, detectThreeExports, DetectionError } from "./detect";
export type { QmFileKind, NamedInput, DetectionResult } from "./detect";
export {
  buildCanonicalModel,
  buildCanonicalModelFromTables,
  normalizeSubjectName,
  parseSitting,
} from "./canonical";
export { toCombinedRows } from "./bridge";
export type * from "./model";

export interface ThreeExportIngest {
  /** The faithful intake artifact (subjects, participants, items, results, topics). */
  canonical: CanonicalModel;
  /** Engine-facing long-format MCQ responses (unchanged contract). */
  cleanedResponses: CleanResponse[];
  /** Validation report, with the QM reconciliation + sitting checks appended. */
  validationReport: ValidationReport;
}

/**
 * Append the 3-CSV-specific checks (QM totals reconciliation, surveys excluded,
 * sitting captured) onto the legacy validation report. Reconciliation failures
 * WARN — they flag malformed exports without hard-blocking ingest.
 */
function augmentReport(report: ValidationReport, model: CanonicalModel): ValidationReport {
  const checks = [...report.checks];
  const { integrity } = model;

  checks.push({
    id: "qm_reconciliation",
    label: "QM totals reconcile with item scores",
    status: integrity.ok ? "pass" : "warn",
    detail: integrity.ok
      ? `All ${integrity.resultsChecked} results reconcile (ResultMaximumScore = Σ item max; ResultTotalScore = Σ AnswerScore).`
      : `${integrity.issues.length} of ${integrity.resultsChecked} results don't reconcile with QM's stated totals — review the export for malformed rows.`,
    count: integrity.issues.length,
  });

  checks.push({
    id: "surveys_excluded",
    label: "Surveys / UX assessments excluded",
    status: "pass",
    detail:
      model.excludedSurveys.length > 0
        ? `Excluded ${model.excludedSurveys.length} survey/UX assessment(s): ${model.excludedSurveys.join(", ")}.`
        : "No survey/UX assessments present.",
    count: model.excludedSurveys.length,
  });

  checks.push({
    id: "sitting",
    label: "Sitting tag captured",
    status: model.sitting ? "pass" : "warn",
    detail: model.sitting
      ? `Tagged as the ${model.sitting.label} sitting (from group names / dates).`
      : "Could not determine the sitting from group names — tag it manually.",
  });

  // Reconciliation/sitting are warnings, never blockers — `passed` is unchanged
  // unless the legacy gates already hard-failed.
  const passed = checks.every((c) => c.status !== "fail");
  return { ...report, checks, passed };
}

export function ingestThreeExports(files: readonly NamedInput[]): ThreeExportIngest {
  const { items, assessments, topics } = detectThreeExports(files);
  const canonical = buildCanonicalModelFromTables(items, assessments, topics);
  const combined = toCombinedRows(items, assessments);
  const { clean, droppedSurveyRows, droppedNonMcqRows } = normalizeResponses(combined);
  const validationReport = validate(combined, clean, droppedSurveyRows, droppedNonMcqRows);
  return {
    canonical,
    cleanedResponses: clean,
    validationReport: augmentReport(validationReport, canonical),
  };
}
