/**
 * Public entry point for the Questionmark 3-export ingest (Items + Assessments +
 * Topics). Detects each file by header signature, builds the canonical model
 * (joined on ResultId), and — via the bridge — also produces the engine-facing
 * `CleanResponse[]` + validation report the rest of the pipeline already consumes.
 */

import { normalizeResponses } from "../normalize";
import { validate } from "../validate";
import { assertParticipantIdentityIntact, assertResponsesAttachToRoster } from "../split";
import type { CleanResponse, ValidationReport } from "../types";
import { detectThreeExports, type NamedInput, type QmFileKind } from "./detect";
import { buildCanonicalModelFromTables, resolveAssessmentIdentities } from "./canonical";
import { toCombinedRows } from "./bridge";
import type { CanonicalModel } from "./model";

export { parseCsv } from "./csv";
export type { CsvTable } from "./csv";
export { detectKind, detectThreeExports, DetectionError } from "./detect";
export type { QmFileKind, NamedInput, DetectionResult } from "./detect";
export {
  buildCanonicalModel,
  buildCanonicalModelFromTables,
  resolveAssessmentIdentities,
  normalizeSubjectName,
  detectResitForms,
  subjectBaseKey,
  DEFAULT_SUBJECT_ALIASES,
  parseSitting,
} from "./canonical";
export type { SubjectAliasMap } from "./canonical";
export { toCombinedRows } from "./bridge";
export type * from "./model";

export interface ThreeExportIngest {
  /** The faithful intake artifact (subjects, participants, items, results, topics). */
  canonical: CanonicalModel;
  /** Engine-facing long-format MCQ responses (unchanged contract). */
  cleanedResponses: CleanResponse[];
  /** Validation report, with the QM reconciliation + sitting checks appended. */
  validationReport: ValidationReport;
  /**
   * Which uploaded filename was recognised as each export — detected by columns,
   * not filename. The upload UI shows this so the user sees all three CSVs and
   * what each was identified as.
   */
  sources: Record<QmFileKind, string>;
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

  if (model.resitForms.length > 0) {
    checks.push({
      id: "resit_forms",
      label: "Re-sit / alternate forms surfaced (not merged)",
      status: "warn",
      detail: `${model.resitForms.length} re-sit form(s) detected and held out of the graded subjects for review: ${model.resitForms
        .map((f) => `"${f.name}" (${f.participantCount} participant(s), ${f.itemCount} items) — likely a re-sit of "${f.baseName}"`)
        .join("; ")}. Their items are NOT merged into the base subject.`,
      count: model.resitForms.length,
    });
  }

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
  const { items, assessments, topics, sources } = detectThreeExports(files);
  // Resolve participant identity ONCE over the authoritative Assessments roster,
  // then pass the SAME map to BOTH the canonical model (the roster) and the response
  // normaliser (the cells). This is the fix for the ingest attribution failure: the
  // two used to resolve identity independently over different row-sets (Assessments
  // vs Items) and disagreed whenever a code-sharing result appeared in one set but
  // not the other — so a real sitter's responses attached to a different id than
  // their roster row (the "all-dots" rows) and other sitters were dropped.
  const identityByResult = resolveAssessmentIdentities(assessments);
  const canonical = buildCanonicalModelFromTables(items, assessments, topics, identityByResult);
  const combined = toCombinedRows(items, assessments);
  const { clean, droppedSurveyRows, droppedNonMcqRows } = normalizeResponses(combined, identityByResult);
  // Hold re-sit / alternate forms out of the GRADED response set so their items
  // never inflate the base subject's scored set (root cause A). The form's data is
  // retained on `canonical` (results + resitForms) for analyst review.
  const resitNames = new Set(canonical.resitForms.map((f) => f.name));
  const graded = resitNames.size ? clean.filter((r) => !resitNames.has(r.assessmentName)) : clean;
  // Detection-boundary guard: any participant collapse fails loudly here, before
  // the per-subject count is shown on Upload (see assertParticipantIdentityIntact).
  assertParticipantIdentityIntact(graded);
  // Roster↔responses alignment guard (task 16): every response's resolved
  // participant id MUST be one the authoritative roster resolved — a response
  // attached to an id absent from the roster is the attribution failure that
  // surfaced as all-dots rows + dropped sitters. Fails loudly at the earliest point.
  const rosterIds = new Set([...identityByResult.values()].map((r) => r.id));
  assertResponsesAttachToRoster(graded, rosterIds);
  const validationReport = validate(combined, graded, droppedSurveyRows, droppedNonMcqRows);
  return {
    canonical,
    cleanedResponses: graded,
    validationReport: augmentReport(validationReport, canonical),
    sources,
  };
}
