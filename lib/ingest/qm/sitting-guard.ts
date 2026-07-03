/**
 * Whole-sitting persistence guard at the 3-CSV ingest boundary (task 19).
 *
 * A `ResultId` = one participant's sitting of one graded subject. The Assessments
 * export is the authoritative ROSTER (one row per sitting, complete regardless of
 * whether the Items export joined); the cleaned responses are the CELLS. A sitting
 * that is on the roster but whose Items rows failed to attach (e.g. a `ResultId`
 * representation skew between the two exports) persists ZERO responses — and,
 * because it is then absent from BOTH `responses` and `result_totals`, the DB's
 * roster↔responses guard (which only checks `result_totals ⊆ responses`) cannot see
 * it. The sitting silently vanishes and the per-subject count reads low.
 *
 * `normalizeResultId` removes the known representational skews so the join no longer
 * drops these sittings; this guard is the defence-in-depth net that FAILS LOUDLY on
 * any residual (or future) whole-sitting drop, naming the exact `ResultId`(s) so the
 * operator can act instead of shipping a silently-short cohort.
 */

import type { CleanResponse } from "../types";
import type { CanonicalModel } from "./model";

/**
 * Assert every graded sitting the roster expects to score is present in the
 * persisted (cleaned) responses. Throws, naming the dropped `ResultId`(s) and their
 * subject, when a roster sitting of a graded MCQ subject persisted zero responses.
 *
 * "Graded MCQ subject" is inferred from the cleaned responses themselves — a subject
 * that produced ≥1 cleaned MCQ response — so a subject with no MCQ items (essay-only)
 * or a held-out re-sit form never trips it. A sitting is expected only when it
 * actually CARRIES joined MCQ item rows on the canonical roster (`res.responses`
 * contains a Multiple-Choice answer): a roster row whose Items are genuinely absent
 * (an abandoned / never-answered sitting) has nothing to persist and is NOT flagged —
 * only a sitting whose MCQ answers exist yet failed to reach the persisted set is.
 */
export function assertAllGradedSittingsPersisted(
  canonical: CanonicalModel,
  graded: readonly CleanResponse[],
): void {
  // Subjects that produced at least one cleaned MCQ response = the graded MCQ
  // subjects actually being scored (essay-only subjects / held-out re-sit forms
  // contribute no cleaned rows and are therefore not in this set).
  const gradedMcqSubjects = new Set<string>();
  const persistedSittings = new Set<string>();
  for (const r of graded) {
    gradedMcqSubjects.add(r.assessmentName);
    if (r.qmResultId) persistedSittings.add(r.qmResultId);
  }

  const resitNames = new Set(canonical.resitForms.map((f) => f.name));

  const dropped: { resultId: string; subject: string; email: string }[] = [];
  for (const res of canonical.results) {
    if (!gradedMcqSubjects.has(res.subject)) continue; // not a graded MCQ subject
    if (resitNames.has(res.subject)) continue; // intentionally held-out re-sit form
    // The sitting must actually carry MCQ answers on the roster — a roster row with
    // no joined MCQ items is an abandoned / never-answered sitting, nothing to drop.
    const hasMcqAnswers = res.responses.some((r) => r.questionType === "Multiple Choice");
    if (!hasMcqAnswers) continue;
    if (persistedSittings.has(res.resultId)) continue; // present — good
    dropped.push({ resultId: res.resultId, subject: res.subject, email: res.participantEmail });
  }

  if (dropped.length > 0) {
    const sample = dropped
      .slice(0, 6)
      .map((d) => `${d.resultId} (${d.subject}${d.email ? `, ${d.email}` : ""})`)
      .join("; ");
    throw new Error(
      `whole-sitting drop at ingest: ${dropped.length} sitting(s) carry MCQ answers on the ` +
        `Assessments roster but persisted zero cleaned responses, so they would vanish silently ` +
        `(absent from both responses and result_totals, where the DB roster guard cannot see ` +
        `them): ${sample}. Their answers did not reach the scored set — check the ResultId join / ` +
        `MCQ filtering rather than dropping the sitting.`,
    );
  }
}
