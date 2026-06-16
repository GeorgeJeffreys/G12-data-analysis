/**
 * Canonical G12++ subject catalog — the five assessments every cycle is built
 * from. This is the source of truth for the new-cycle assessment picker, so the
 * list is available even before any cycle exists in the database (the picker
 * must never depend on a loaded live cycle, or it shows "0 of 0").
 *
 * The `name` strings are the ones written to `assessments.name` when a cycle is
 * created; they are deliberately phrased so the hydration classifier
 * (supabase-hydrate.ts `classify`) maps each back to its subject code.
 */
export interface SubjectCatalogEntry {
  /** Stable catalog id used by the picker + CreateCycleInput.assessmentIds. */
  id: string;
  /** Display + persisted assessment name. */
  name: string;
  /** Right-to-left script (Arabic) — drives the RTL badge in the picker. */
  rtl: boolean;
}

export const SUBJECT_CATALOG: SubjectCatalogEntry[] = [
  { id: "subj-applicable-maths", name: "Applicable Maths", rtl: false },
  { id: "subj-scientific-thinking", name: "Scientific Thinking", rtl: false },
  { id: "subj-arabic-1st-language", name: "Arabic 1st Language", rtl: true },
  { id: "subj-english-2nd-language", name: "English 2nd Language", rtl: false },
  { id: "subj-life-success-skills", name: "Life Success Skills", rtl: false },
];

/** Resolve selected catalog ids → the assessment names to persist (order kept). */
export function catalogNamesFor(assessmentIds: string[]): string[] {
  return assessmentIds
    .map((id) => SUBJECT_CATALOG.find((s) => s.id === id)?.name)
    .filter((n): n is string => Boolean(n));
}
