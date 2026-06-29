/**
 * Configurable A–E element labels per subject.
 *
 * Each subject carries an ordered A–E mapping of
 *   { matchKey (the QuestionMajorElement value in the data) → letter → display label }.
 * The element columns shown across the app (the cleaned matrix headers, the
 * by-element breakdowns, the per-element score columns) use the configured letter
 * and display label instead of a generic, appearance-ordered A–E.
 *
 * Matching the data values is case-insensitive and treats "&" and "and" as
 * equivalent, so the seed (which uses a mix of both) binds to whatever spelling
 * the export happens to use.
 *
 * The display label is editable in Settings (server-side validated); the match key
 * binds to the data and the letter fixes the order.
 */

export interface ElementLabelEntry {
  /** The QuestionMajorElement value in the data this row binds to. */
  matchKey: string;
  /** A–E (the ordered position). */
  letter: string;
  /** Editable display label shown in the UI. */
  label: string;
}

/** subject (full name) → ordered A–E entries. */
export type ElementLabelsConfig = Record<string, ElementLabelEntry[]>;

/**
 * Canonical form for matching: lower-cased, "&" treated as "and", whitespace
 * collapsed. Applied to both the data value and the configured match key so the
 * two bind regardless of "&"/"and" spelling or casing.
 */
export function normalizeElementKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical key for a subject name (case/whitespace/&-insensitive). */
export function normalizeSubjectKey(name: string): string {
  return normalizeElementKey(name);
}

/** The seeded defaults (data value → letter → default display label). */
export const DEFAULT_ELEMENT_LABELS: ElementLabelsConfig = {
  "Applicable Math": [
    { matchKey: "Numerical and quantitative reasoning", letter: "A", label: "Numerical and quantitative reasoning" },
    { matchKey: "Spatial and geometric reasoning", letter: "B", label: "Spatial & geometric reasoning" },
    { matchKey: "Functional algebra and logical thinking", letter: "C", label: "Functional algebra & logical thinking" },
    { matchKey: "Data, probability and decision-making", letter: "D", label: "Data, probability & decision-making" },
    { matchKey: "Graphical literacy and visual data interpretation", letter: "E", label: "Graphical literacy & visual data interpretation" },
  ],
  "Scientific Thinking": [
    { matchKey: "Explain phenomena scientifically", letter: "A", label: "Explain phenomena scientifically" },
    { matchKey: "Evaluate and design scientific inquiry", letter: "B", label: "Evaluate and design scientific inquiry" },
    { matchKey: "Interpret evidence and data scientifically", letter: "C", label: "Interpret evidence and data scientifically" },
  ],
  "Arabic as a 1st Language": [
    { matchKey: "Reading comprehension", letter: "A", label: "Reading Comprehension" },
    { matchKey: "Editing and Proofreading", letter: "B", label: "Editing and Proofreading" },
    { matchKey: "Writing and Expression", letter: "C", label: "Writing and Expression" },
  ],
  "English as a 2nd Language": [
    { matchKey: "Reading comprehension", letter: "A", label: "Reading comprehension" },
    { matchKey: "Listening comprehension", letter: "B", label: "Listening Comprehension" },
    { matchKey: "Writing and expression", letter: "C", label: "Writing and expression" },
  ],
  "Life Success Skills": [
    { matchKey: "Communication", letter: "A", label: "Communication" },
    { matchKey: "Creative Problem Solving", letter: "B", label: "Creative problem-solving" },
    { matchKey: "Self-management", letter: "C", label: "Self-management" },
    { matchKey: "Collaboration", letter: "D", label: "Collaboration" },
  ],
};

/** A resolved element label: its A–E letter and its display label. */
export interface ResolvedElementLabel {
  letter: string;
  label: string;
}

/** The fallback A–E letter for the i-th element when nothing is configured. */
export function fallbackLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * Resolve one major-element value for a subject to its configured letter + label.
 * Returns null when the subject or the value is not configured (caller falls back
 * to appearance-order A–E + the raw value).
 */
export function resolveElementLabel(
  config: ElementLabelsConfig,
  subjectName: string,
  majorValue: string,
): ResolvedElementLabel | null {
  const subjectKey = normalizeSubjectKey(subjectName);
  const entries =
    config[subjectName] ??
    Object.entries(config).find(([k]) => normalizeSubjectKey(k) === subjectKey)?.[1];
  if (!entries) return null;
  const target = normalizeElementKey(majorValue);
  const hit = entries.find((e) => normalizeElementKey(e.matchKey) === target);
  return hit ? { letter: hit.letter, label: hit.label } : null;
}

/**
 * Build a label map for the major-element values of one subject, in the order they
 * appear in the data. Configured values use their letter + display label; anything
 * unconfigured falls back to an appearance-order letter and the raw value, so the
 * UI never shows a blank.
 */
export function labelMapForSubject(
  config: ElementLabelsConfig,
  subjectName: string,
  majorValues: string[],
): Map<string, ResolvedElementLabel> {
  const out = new Map<string, ResolvedElementLabel>();
  majorValues.forEach((major, i) => {
    const resolved = resolveElementLabel(config, subjectName, major);
    out.set(major, resolved ?? { letter: fallbackLetter(i), label: major });
  });
  return out;
}

/** Validate an edited config: every label non-empty, letters unique per subject. */
export function validateElementLabels(config: ElementLabelsConfig): string | null {
  for (const [subject, entries] of Object.entries(config)) {
    const letters = new Set<string>();
    for (const e of entries) {
      if (!e.label || !e.label.trim()) return `${subject}: every element needs a display label.`;
      if (!e.matchKey || !e.matchKey.trim()) return `${subject}: every element needs a match key.`;
      const L = e.letter.trim().toUpperCase();
      if (letters.has(L)) return `${subject}: letter ${L} is used more than once.`;
      letters.add(L);
    }
  }
  return null;
}
