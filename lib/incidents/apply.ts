/**
 * Incident Adjustments — the auto-apply engine (02b, grade-bearing half).
 *
 * This is the bounded layer that turns parsed+classified incident rows into a
 * per-student mark adjustment, applied ON TOP OF the engine's base scores. It is
 * pure (no React / Supabase / SheetJS) and never mutates a base score — the
 * parity-locked scoring engine (`lib/engine/scores.ts`) is untouched, so base
 * scores keep reconciling 1:1 against the raw oracle.
 *
 * The three safety invariants of the subsystem are enforced HERE, in the apply
 * path, exactly as `lib/incidents/formula.ts` defines them:
 *   1. PER-CODE CAP — each incident's computed marks are clamped to its matched
 *      code's per-incident ceiling (`evaluateCapped`).
 *   2. PER-STUDENT GLOBAL CAP — a student's marks summed across ALL their
 *      incidents are clamped to the configured global ceiling (`capStudentTotal`).
 *   3. ADD-ONLY — no path can produce a negative adjustment; unmatched /
 *      unclassified / errored rows grant ZERO and are surfaced for manual
 *      attention, never silently applied and never reducing a score.
 *
 * The result is always DECOMPOSABLE: every student's adjustment carries the
 * per-incident contributions that produced it and the two cap-binding flags, so
 * `adjusted = base + adjustment` is auditable at all times — never a silently
 * merged number.
 */

import type { IncidentCode } from "./types";
import type { ResolvedIncidentRow } from "./import";
import { evaluateFormula, evaluateCapped, capStudentTotal } from "./formula";

/** One incident's contribution to a student's adjustment — fully decomposable. */
export interface IncidentContribution {
  /** 1-based source row number, for surfacing in the review UI. */
  rowNumber: number;
  incidentType: string;
  questionNumber: string;
  durationMinutes: number | null;
  /** `ok` = classified & valid; `unclassified` = no code match; `error` = a
   *  row-level validation problem. Only `ok` rows can grant marks. */
  status: "ok" | "unclassified" | "error";
  /** The matched incident code (null when unclassified / errored / code removed). */
  codeId: string | null;
  code: string | null;
  codeLabel: string | null;
  /** Raw (un-capped) marks the formula computed. 0 for non-`ok` rows. */
  rawMarks: number;
  /** Marks after this code's per-incident cap. 0 for non-`ok` rows. Add-only. */
  marks: number;
  /** The per-incident cap that applied (null when no code matched). */
  perCodeCap: number | null;
  /** True when the per-code cap bound (raw formula marks exceeded the ceiling). */
  perCodeCapHit: boolean;
  /** Row-level problems carried from the parser (surfaced, never dropped). */
  errors: string[];
}

/** A student's capped incident adjustment, decomposed into its contributions. */
export interface StudentIncidentAdjustment {
  /** P-A stable internal participant id (the incident row's `participant_key`). */
  participantKey: string;
  /** Resolved cohort participant UUID, or null when the row matched no cohort
   *  participant (surfaced for manual attention, never silently applied). */
  participantId: string | null;
  studentName: string;
  contributions: IncidentContribution[];
  /** Sum of the per-code-capped marks across the student's incidents, BEFORE the
   *  per-student global cap. */
  uncappedTotal: number;
  /** The adjustment actually applied, after the per-student global cap. Add-only. */
  adjustment: number;
  /** True when the per-student global cap bound the total. */
  perStudentCapHit: boolean;
  /** True when ANY of this student's incidents hit its per-code cap. */
  perCodeCapHit: boolean;
  okCount: number;
  unclassifiedCount: number;
  errorCount: number;
}

export interface ApplyContext {
  /**
   * The section maximum for a `% of section` incident — the engine's SCORED
   * denominator (via `section-max.ts`), resolved per row. Defaults to 0, so a
   * `pct_section` incident grants NOTHING rather than guessing when the caller
   * cannot resolve the section (e.g. the incident file carries no subject column
   * yet). Fixed / per-duration incidents don't use this.
   */
  sectionMaxFor?: (row: ResolvedIncidentRow, code: IncidentCode) => number;
}

const EPS = 1e-9;

/**
 * Compute one incident row's contribution against the active code registry.
 * Non-`ok` rows (unclassified / error) and rows whose matched code has since been
 * removed grant ZERO and are surfaced (never applied).
 */
export function contributionFor(
  row: ResolvedIncidentRow,
  codesById: ReadonlyMap<string, IncidentCode>,
  ctx: ApplyContext = {},
): IncidentContribution {
  const base = {
    rowNumber: row.rowNumber,
    incidentType: row.incidentType,
    questionNumber: row.questionNumber,
    durationMinutes: row.durationMinutes,
    status: row.status,
    errors: [...row.errors],
  };

  const code = row.status === "ok" && row.codeId ? codesById.get(row.codeId) ?? null : null;
  if (!code || !code.active) {
    // Unclassified, errored, or a code that no longer exists / is inactive:
    // zero marks, surfaced. Never applied, never reduces a score.
    return { ...base, codeId: null, code: null, codeLabel: null, rawMarks: 0, marks: 0, perCodeCap: null, perCodeCapHit: false };
  }

  const sectionMax = ctx.sectionMaxFor ? ctx.sectionMaxFor(row, code) : 0;
  const evalCtx = { durationMinutes: row.durationMinutes ?? 0, sectionMax };
  const rawMarks = evaluateFormula(code.formula, evalCtx);
  const marks = evaluateCapped(code.formula, code.perCodeCap, evalCtx);
  return {
    ...base,
    codeId: code.id,
    code: code.code,
    codeLabel: code.label,
    rawMarks,
    marks,
    perCodeCap: code.perCodeCap,
    perCodeCapHit: rawMarks - marks > EPS,
  };
}

/**
 * The auto-apply engine: turn resolved incident rows into per-student capped
 * adjustments. Rows are grouped by the P-A stable participant key; each student's
 * per-incident marks are per-code-capped, summed, then clamped to the per-student
 * global cap. Every result is decomposable into its contributions.
 */
export function computeStudentAdjustments(
  rows: readonly ResolvedIncidentRow[],
  codes: readonly IncidentCode[],
  perStudentCap: number | null,
  ctx: ApplyContext = {},
): StudentIncidentAdjustment[] {
  const codesById = new Map(codes.map((c) => [c.id, c]));
  const byStudent = new Map<string, StudentIncidentAdjustment>();

  for (const row of rows) {
    const key = row.participantInternalId ?? row.rawStudentId ?? `row-${row.rowNumber}`;
    let entry = byStudent.get(key);
    if (!entry) {
      entry = {
        participantKey: key,
        participantId: row.participantInternalId,
        studentName: row.studentName,
        contributions: [],
        uncappedTotal: 0,
        adjustment: 0,
        perStudentCapHit: false,
        perCodeCapHit: false,
        okCount: 0,
        unclassifiedCount: 0,
        errorCount: 0,
      };
      byStudent.set(key, entry);
    }
    // Keep the resolved cohort id / a display name if a later row carries it.
    if (!entry.participantId && row.participantInternalId) entry.participantId = row.participantInternalId;
    if (!entry.studentName && row.studentName) entry.studentName = row.studentName;

    const contribution = contributionFor(row, codesById, ctx);
    entry.contributions.push(contribution);
    if (contribution.status === "error") entry.errorCount += 1;
    else if (contribution.status === "unclassified" || !contribution.codeId) entry.unclassifiedCount += 1;
    else entry.okCount += 1;
    if (contribution.perCodeCapHit) entry.perCodeCapHit = true;
  }

  for (const entry of byStudent.values()) {
    const uncapped = entry.contributions.reduce((t, c) => t + c.marks, 0);
    const adjustment = capStudentTotal(uncapped, perStudentCap);
    entry.uncappedTotal = round4(uncapped);
    entry.adjustment = round4(adjustment);
    entry.perStudentCapHit = uncapped - adjustment > EPS;
  }

  return [...byStudent.values()];
}

/** Round to 4dp to keep sums free of float dust (mirrors the engine's rounding). */
function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}
