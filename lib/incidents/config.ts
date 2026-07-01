/**
 * Incident-code registry — defaults + validation. This is the single source of
 * truth for the two safety invariants of the subsystem:
 *
 *   1. ADD-ONLY — no mark quantity (fixed marks, per-unit rate, percent, or any
 *      cap) may be negative. `validateIncidentCode` REJECTS negatives, so the
 *      config layer makes it impossible to express a subtraction. (The DB CHECK
 *      constraints in migration 0016 enforce the same thing at rest.)
 *   2. CAPPED — every code carries a per-incident ceiling, and the registry has a
 *      per-student global ceiling. Both are validated ≥ 0 here.
 *
 * Nothing here applies marks to students — that is the 02b apply step. This
 * module only defines and validates what the registry MEANS.
 */

import type {
  IncidentAdjustmentConfig,
  IncidentCode,
  IncidentCodeInput,
  IncidentColumnMapping,
  IncidentFormula,
} from "./types";

/** The default column mapping — the assumed import schema (adjust when the real
 *  file arrives; the mapping is reconfigurable precisely so this needs no code
 *  change). */
export const DEFAULT_COLUMN_MAPPING: IncidentColumnMapping = {
  studentId: "Student ID",
  studentName: "Student Name",
  incidentType: "Incident Type",
  questionNumber: "Question Number",
  duration: "Incident Duration",
};

/**
 * A starter registry. The calculator example is the canonical
 * "+0.5 marks per 5 minutes of incident" rate, capped at 3 marks per incident.
 * These are safe, editable defaults — an admin tunes them on the config page.
 */
export const DEFAULT_INCIDENT_CODES: IncidentCode[] = [
  {
    id: "code-calc",
    code: "CALC_FAIL",
    label: "Calculator / device failure",
    matchTypes: ["calculator broke", "calculator failure", "device failure", "frozen tool"],
    formula: { kind: "per_duration", marksPerUnit: 0.5, perMinutes: 5, rounding: "block" },
    perCodeCap: 3,
    active: true,
  },
  {
    id: "code-disrupt",
    code: "ROOM_DISRUPT",
    label: "Whole-room disruption",
    matchTypes: ["projector flicker", "fire alarm", "power cut", "noise disruption"],
    formula: { kind: "fixed", marks: 1 },
    perCodeCap: 2,
    active: true,
  },
];

/** The default per-student global cap (marks). A placeholder pending G12 policy. */
export const DEFAULT_PER_STUDENT_CAP = 5;

export function defaultIncidentConfig(): IncidentAdjustmentConfig {
  return {
    codes: DEFAULT_INCIDENT_CODES.map((c) => ({ ...c, matchTypes: [...c.matchTypes], formula: { ...c.formula } })),
    perStudentCap: DEFAULT_PER_STUDENT_CAP,
    mapping: { ...DEFAULT_COLUMN_MAPPING },
  };
}

const isFiniteNonNeg = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Validate a formula in isolation (add-only + structural rules). */
export function validateFormula(f: IncidentFormula): string[] {
  const errs: string[] = [];
  switch (f.kind) {
    case "fixed":
      if (!isFiniteNonNeg(f.marks)) errs.push("Fixed marks must be a number ≥ 0 (add-only).");
      break;
    case "per_duration":
      if (!isFiniteNonNeg(f.marksPerUnit)) errs.push("Marks per unit must be a number ≥ 0 (add-only).");
      if (!(typeof f.perMinutes === "number" && Number.isFinite(f.perMinutes) && f.perMinutes > 0))
        errs.push("The duration unit (minutes) must be greater than 0.");
      break;
    case "pct_section":
      if (!isFiniteNonNeg(f.percent)) errs.push("Percent must be a number ≥ 0 (add-only).");
      else if (f.percent > 100) errs.push("Percent cannot exceed 100.");
      if (f.basis !== "assessment" && f.basis !== "major_element")
        errs.push("Section basis must be 'assessment' or 'major_element'.");
      break;
    default:
      errs.push("Unknown formula kind.");
  }
  return errs;
}

/**
 * Validate one code for insert/update. Returns a list of human-readable errors
 * (empty = valid). `existing` is the rest of the registry, used to reject a
 * duplicate code label.
 */
export function validateIncidentCode(input: IncidentCodeInput, existing: readonly IncidentCode[] = []): string[] {
  const errs: string[] = [];
  const code = input.code?.trim() ?? "";
  if (!code) errs.push("A code is required.");
  if (!input.label?.trim()) errs.push("A label is required.");

  const others = existing.filter((c) => c.id !== input.id);
  if (code && others.some((c) => c.code.trim().toLowerCase() === code.toLowerCase()))
    errs.push(`The code "${code}" is already in use.`);

  const types = (input.matchTypes ?? []).map((t) => t.trim()).filter(Boolean);
  if (types.length === 0) errs.push("Add at least one incident type this code matches.");

  errs.push(...validateFormula(input.formula));

  if (!isFiniteNonNeg(input.perCodeCap))
    errs.push("The per-incident cap must be a number ≥ 0 (add-only).");

  return errs;
}

/** Validate the per-student global cap. `null` (no cap) is allowed. */
export function validatePerStudentCap(cap: number | null): string[] {
  if (cap === null) return [];
  return isFiniteNonNeg(cap) ? [] : ["The per-student global cap must be a number ≥ 0 (add-only)."];
}

/** Normalise an input into a stored code (trims strings, dedupes match types). */
export function normalizeIncidentCode(input: IncidentCodeInput, id: string): IncidentCode {
  const seen = new Set<string>();
  const matchTypes: string[] = [];
  for (const t of input.matchTypes ?? []) {
    const v = t.trim();
    const key = v.toLowerCase();
    if (v && !seen.has(key)) {
      seen.add(key);
      matchTypes.push(v);
    }
  }
  return {
    id,
    code: input.code.trim(),
    label: input.label.trim(),
    matchTypes,
    formula: { ...input.formula },
    perCodeCap: input.perCodeCap,
    active: input.active ?? true,
  };
}

/**
 * Find the first ACTIVE code whose match-types include `incidentType`
 * (case-insensitive, trimmed). Returns null when nothing matches — the caller
 * then routes the row to the "unclassified" bucket (never silently dropped).
 */
export function classifyIncidentType(
  incidentType: string,
  codes: readonly IncidentCode[],
): IncidentCode | null {
  const needle = incidentType.trim().toLowerCase();
  if (!needle) return null;
  for (const c of codes) {
    if (!c.active) continue;
    if (c.matchTypes.some((t) => t.trim().toLowerCase() === needle)) return c;
  }
  return null;
}
