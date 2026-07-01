/**
 * Formula evaluation + capping — what an incident code's rule GRANTS.
 *
 * This defines the semantics of the registry (used by the config page to preview
 * a rule, and by the 02b apply step to compute the marks a matched incident adds).
 * It does NOT apply anything to a student's score — that seam lives in the engine
 * (`lib/engine/scores.ts`, which sums `alterations` into `raw`) and 02b feeds it.
 *
 * Every path is ADD-ONLY (never returns < 0) and CAPPED (never exceeds the code's
 * per-incident ceiling). The per-student global cap is a second ceiling applied
 * across codes by `capStudentTotal`.
 */

import type { IncidentFormula } from "./types";

export interface EvalContext {
  /** Incident duration in minutes (0 when not applicable / missing). */
  durationMinutes?: number;
  /**
   * The section maximum for a `% of section` formula — the SCORED denominator
   * (from the engine, via `section-max.ts`), never a naïve sum of raw max scores.
   */
  sectionMax?: number;
}

/** Raw (un-capped) marks a formula grants for one incident. Always ≥ 0. */
export function evaluateFormula(formula: IncidentFormula, ctx: EvalContext = {}): number {
  const marks = rawMarks(formula, ctx);
  return Number.isFinite(marks) && marks > 0 ? marks : 0;
}

function rawMarks(formula: IncidentFormula, ctx: EvalContext): number {
  switch (formula.kind) {
    case "fixed":
      return formula.marks;
    case "per_duration": {
      const duration = Math.max(0, ctx.durationMinutes ?? 0);
      if (!(formula.perMinutes > 0)) return 0;
      const units =
        formula.rounding === "proportional"
          ? duration / formula.perMinutes
          : Math.floor(duration / formula.perMinutes);
      return units * formula.marksPerUnit;
    }
    case "pct_section": {
      const sectionMax = Math.max(0, ctx.sectionMax ?? 0);
      return (formula.percent / 100) * sectionMax;
    }
    default:
      return 0;
  }
}

/**
 * Marks a single incident of a code grants, after the code's per-incident cap.
 * Add-only and capped: `0 ≤ result ≤ perCodeCap`.
 */
export function evaluateCapped(
  formula: IncidentFormula,
  perCodeCap: number,
  ctx: EvalContext = {},
): number {
  const raw = evaluateFormula(formula, ctx);
  const cap = Number.isFinite(perCodeCap) && perCodeCap >= 0 ? perCodeCap : 0;
  return Math.min(raw, cap);
}

/**
 * Apply the per-student GLOBAL cap to a student's summed incident marks across
 * all codes. `perStudentCap === null` means "no global cap". Add-only.
 */
export function capStudentTotal(total: number, perStudentCap: number | null): number {
  const t = Math.max(0, total);
  if (perStudentCap === null) return t;
  const cap = Number.isFinite(perStudentCap) && perStudentCap >= 0 ? perStudentCap : 0;
  return Math.min(t, cap);
}

/** A short human description of a formula, for the config UI / previews. */
export function describeFormula(formula: IncidentFormula): string {
  switch (formula.kind) {
    case "fixed":
      return `+${formula.marks} mark${formula.marks === 1 ? "" : "s"}`;
    case "per_duration":
      return `+${formula.marksPerUnit} per ${formula.perMinutes} min${
        formula.rounding === "proportional" ? " (pro-rata)" : ""
      }`;
    case "pct_section":
      return `${formula.percent}% of ${formula.basis === "major_element" ? "element" : "subject"} max`;
    default:
      return "—";
  }
}
