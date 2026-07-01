/**
 * Incident Adjustments — domain types for the configuration registry and the
 * incident import. Deliberately framework-free (no React / Supabase / SheetJS):
 * the admin config page, the import parser and the (02b) apply step all reason
 * about THESE shapes, so the rules live in one place and stay testable.
 *
 * Two invariants are baked into the vocabulary here and enforced in `config.ts`:
 *   - ADD-ONLY: every mark quantity an incident code can grant is ≥ 0. There is
 *     no way to express a subtraction — incidents only ever *add* marks.
 *   - CAPPED: every code carries a per-incident ceiling, and the registry as a
 *     whole carries a per-student global ceiling across all codes combined.
 */

/** The three supported formula kinds for how a code grants marks. */
export type FormulaKind = "fixed" | "per_duration" | "pct_section";

/**
 * Which "section" a `% of section` formula is a percentage OF. Defaults to the
 * subject/assessment maximum; `major_element` is the finer QuestionMajorElement
 * section, available for later use (02b resolves it from the engine denominator).
 */
export type SectionBasis = "assessment" | "major_element";

/** A flat number of marks per incident. */
export interface FixedFormula {
  kind: "fixed";
  /** Flat marks granted for one incident (add-only: ≥ 0). */
  marks: number;
}

/**
 * A rate per unit of incident duration — the canonical example being
 * "+0.5 marks per 5 minutes of incident" (`marksPerUnit: 0.5`, `perMinutes: 5`).
 */
export interface PerDurationFormula {
  kind: "per_duration";
  /** Marks granted per `perMinutes` of duration (add-only: ≥ 0). e.g. 0.5 */
  marksPerUnit: number;
  /** The duration unit, in minutes (> 0). e.g. 5 → "per 5 minutes". */
  perMinutes: number;
  /**
   * How partial units count. `block` (default) grants only whole completed units
   * (12 min at "per 5 min" → 2 units); `proportional` grants a continuous rate
   * (12 min → 2.4 units). Kept configurable so policy can pick either later.
   */
  rounding?: "block" | "proportional";
}

/** A percentage of the relevant section's (scored) maximum. */
export interface PctSectionFormula {
  kind: "pct_section";
  /** Percent of the section max granted (add-only: 0–100). */
  percent: number;
  /** Which section's max the percent applies to. Defaults to `assessment`. */
  basis: SectionBasis;
}

export type IncidentFormula = FixedFormula | PerDurationFormula | PctSectionFormula;

/**
 * One incident code in the registry: a label, the incident-type strings it
 * matches (case-insensitive), a formula, and a per-incident ceiling.
 */
export interface IncidentCode {
  id: string;
  /** Short machine-ish code, unique (case-insensitive) in the registry. */
  code: string;
  /** Human label. */
  label: string;
  /** Incident-type strings this code matches (case-insensitive, trimmed). */
  matchTypes: string[];
  formula: IncidentFormula;
  /** Hard ceiling on marks a single incident of this code may grant (≥ 0). */
  perCodeCap: number;
  /** Inactive codes are kept for history but never match / grant. */
  active: boolean;
}

/**
 * The column mapping for the incident import: which header in the uploaded file
 * carries each logical field. Reconfigurable so we can point the parser at the
 * real file later with no code change.
 */
export interface IncidentColumnMapping {
  studentId: string;
  studentName: string;
  incidentType: string;
  questionNumber: string;
  duration: string;
}

/** The whole Incident-Adjustments configuration surface (admin-owned). */
export interface IncidentAdjustmentConfig {
  codes: IncidentCode[];
  /**
   * Per-student global cap: the maximum TOTAL marks any one student may receive
   * from incidents across ALL codes combined. A hard safety limit the apply step
   * (02b) must respect. `null` means "no global cap set".
   */
  perStudentCap: number | null;
  mapping: IncidentColumnMapping;
}

/** Editable shape used when creating/updating a code (id optional → create). */
export interface IncidentCodeInput {
  id?: string;
  code: string;
  label: string;
  matchTypes: string[];
  formula: IncidentFormula;
  perCodeCap: number;
  active?: boolean;
}
