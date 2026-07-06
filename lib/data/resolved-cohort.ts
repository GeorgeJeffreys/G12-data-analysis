/**
 * The ONE canonical resolved-cohort function (task 17 — result-selection).
 *
 * The 15→7 collapse had a second signature beyond the response-attach bug: the
 * cohort was recomputed independently by Upload (the combined-split detector),
 * Clean (the cleaning matrix) and the Data-flow inspector, and those computations
 * could disagree (7 at Upload, 9 at Clean, ~8 in Data flow). Whenever three call
 * sites each re-derive "who sat this subject", a divergence is one refactor away.
 *
 * This module is the single source of truth for per-subject cohort membership at
 * every pipeline stage, read ONCE from the provider's own committed read-models
 * (never a parallel recomputation of the raw file):
 *
 *   detected  — every participant with ≥1 response for the subject, STAFF INCLUDED
 *               (the raw ingest/detection cohort the Upload screen reports:
 *               15/12/12/9/11, 18 distinct across the cycle).
 *   staff     — the staff/test accounts among them (shown struck, never counted).
 *   cleaned   — detected − staff − soft-deleted rows (the post-Clean cohort:
 *               15/11/12/9/10).
 *   matrix    — the participants the students×question pivot actually emitted a row
 *               for (getNaiveScores) — sourcing it from the pivot's OWN output keeps
 *               a matrix-stage drop visible instead of silently balanced.
 *   computed  — students with an engine subject total (getComposition).
 *
 * Upload, Clean and Data-flow all read THIS, so their counts can never diverge
 * again; the ingest-boundary invariant (`assertCohortResolved`) fails loudly if a
 * subject's cleaned cohort ever exceeds its matrix cohort (a cleaned sitter that
 * produced no score row — the response-attach / dropped-sitter signature).
 */

import type { DataProvider } from "./provider";
import { isStaffTestEmail } from "./staff-exclusions";

/** Per-subject cohort membership, as id sets, at each pipeline stage. */
export interface SubjectCohort {
  assessmentId: string;
  name: string;
  /** Every participant id with ≥1 response for the subject (staff included). */
  detected: Set<string>;
  /** Staff/test ids among `detected` (struck through, never counted). */
  staff: Set<string>;
  /** detected − staff − soft-deleted rows (the post-Clean cohort). */
  cleaned: Set<string>;
  /** Participants the score-matrix pivot actually emitted a row for. */
  matrix: Set<string>;
  /** Students with an engine subject total. */
  computed: Set<string>;
}

export interface ResolvedCohort {
  cycleId: string;
  subjects: SubjectCohort[];
  /** Distinct participants across the cycle at detection (staff included). */
  detectedTotal: number;
  /** Distinct participants across the cycle after Clean (staff + soft-deletes out). */
  cleanedTotal: number;
  /** Distinct participants across the cycle with a computed subject total. */
  computedTotal: number;
}

/**
 * Resolve the canonical cohort for one cycle from the provider's read-models.
 * Pure and strictly read-only — getters only, never a mutator. Returns null when
 * the cycle is unknown.
 */
export function resolveCohort(provider: DataProvider, cycleId: string): ResolvedCohort | null {
  const cycle = provider.getCycle(cycleId);
  if (!cycle) return null;

  const composition = provider.getComposition(cycleId);
  const computedByAssessment = new Map<string, Set<string>>();
  if (composition) {
    for (const s of composition.students) {
      for (const sub of s.subjects) {
        (computedByAssessment.get(sub.assessmentId) ??
          computedByAssessment.set(sub.assessmentId, new Set()).get(sub.assessmentId)!).add(s.participantId);
      }
    }
  }

  // The authoritative ingest roster (migration 0026 `sittings`): which participants
  // sat each subject, STAFF INCLUDED, keyed on `count(distinct participant_email)`.
  // This — not the MCQ response matrix — is the source for the DETECTED (ingest)
  // stage, so the UI matches what `sittings` holds. Null only for an unknown cycle.
  const roster = provider.getSittingRoster(cycleId);

  const subjects: SubjectCohort[] = [];
  const detectedAll = new Set<string>();
  const cleanedAll = new Set<string>();
  const computedAll = new Set<string>();
  for (const a of cycle.assessments) {
    const raw = provider.getRawData(cycleId, a.id);
    const cleaning = provider.getDataCleaning(cycleId, a.id);
    if (!raw || !cleaning) continue;

    // Email lookup for staff detection: prefer the roster's own emails, fall back
    // to the raw matrix's studentId (identical on correct data).
    const emailById = new Map<string, string>();
    for (const r of raw.rows) emailById.set(r.id, r.studentId);
    const rosterForSubject = roster?.byAssessment.get(a.id);
    if (rosterForSubject) for (const [id, email] of rosterForSubject) emailById.set(id, email);

    // DETECTED = the sitting roster (staff included). Fall back to the raw response
    // matrix only when the seed carries no sitting spine (legacy seeds).
    const detected = new Set<string>(rosterForSubject ? rosterForSubject.keys() : raw.rows.map((r) => r.id));
    const staff = new Set<string>();
    for (const id of detected) {
      detectedAll.add(id);
      if (isStaffTestEmail(emailById.get(id))) staff.add(id);
    }
    // Cleaned = detected − staff − soft-deleted (cohort-excluded) rows, keyed on the
    // same `excludedRows` set the Clean view strikes through — so Upload, Clean and
    // Data-flow can never diverge. Staff/test and ad-hoc soft-deletes both live in
    // that set (the cohort exclusion the whole app reads).
    const excluded = new Set(cleaning.excludedRows);
    const cleaned = new Set<string>();
    for (const id of detected) {
      if (staff.has(id) || excluded.has(id)) continue;
      cleaned.add(id);
      cleanedAll.add(id);
    }
    // Matrix membership = the pivot's OWN output (never re-derived from cleaned).
    const naive = provider.getNaiveScores(cycleId, a.id);
    const matrix = new Set<string>(
      naive ? naive.students.map((s) => s.id) : [...cleaned],
    );
    const computed = computedByAssessment.get(a.id) ?? new Set<string>();
    for (const id of computed) computedAll.add(id);

    subjects.push({ assessmentId: a.id, name: a.name, detected, staff, cleaned, matrix, computed });
  }

  return {
    cycleId,
    subjects,
    // Distinct across the cycle: the roster's own distinct-email total when present
    // (the count(distinct participant_email) the DB reports), else the union.
    detectedTotal: roster?.totalParticipants ?? detectedAll.size,
    cleanedTotal: cleanedAll.size,
    computedTotal: computedAll.size,
  };
}

/**
 * Ingest-boundary invariant: a subject's CLEANED cohort must never exceed its
 * MATRIX cohort. A cleaned sitter absent from the score matrix is a participant
 * whose responses were not attached to a scorable row — the exact "all-dots /
 * dropped sitter" collapse this task fixes. Throws with the offending subject(s)
 * so the failure is loud at the boundary, not a silently-low count downstream.
 */
export function assertCohortResolved(resolved: ResolvedCohort): void {
  const offending: string[] = [];
  for (const s of resolved.subjects) {
    // Only meaningful once the matrix stage has run (naive scores present).
    if (s.matrix.size === 0 && s.cleaned.size > 0) continue;
    for (const id of s.cleaned) {
      if (!s.matrix.has(id)) {
        offending.push(`${s.name}: cleaned sitter ${id} has no score-matrix row`);
      }
    }
  }
  if (offending.length > 0) {
    throw new Error(
      `resolved-cohort integrity: ${offending.length} cleaned sitter(s) dropped before the ` +
        `score matrix — responses not attached to a scorable row:\n  ${offending.slice(0, 8).join("\n  ")}`,
    );
  }
}
