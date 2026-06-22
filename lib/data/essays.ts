/**
 * Essay detection + half-weighting — the single source of truth.
 *
 * Two G12++ subjects carry an offline-marked essay component: English (ESL) and
 * Arabic (AFL, اللّغة العربيّة). Each subject has TWO essays, each marked out of
 * `ESSAY_ITEM_MAX` (20) → `ESSAY_ITEM_MAX_SUM` (40) raw essay marks per subject.
 *
 * ## Half-weighting (the decided rule)
 * The essay block is intentionally weighted at HALF so the 40 raw essay marks do
 * not disproportionately outweigh the MCQ. It therefore contributes
 * `ESSAY_ITEM_MAX_SUM / 2` = `ESSAY_MAX_RESERVED` (20) to the subject denominator,
 * and a student's essay marks enter the numerator at half their raw value. The
 * provider stores each student's per-subject essay mark as the AVERAGE of their
 * essays out of 20 — which, for the two essays, equals (essay 1 + essay 2) / 2,
 * i.e. the half-weighted contribution out of the reserved 20. So the reserved max
 * and the stored mark are both already on the half-weighted /20 scale.
 *
 * ## Detection (data-driven, script-aware — NOT a Latin-only name regex)
 * `isEssaySubject` recognises an essay subject from the item data first (any item
 * whose max exceeds the dichotomous MCQ max of 1 is an essay/polytomous item),
 * falling back to a SCRIPT-AWARE subject-name match that also matches the
 * Arabic-script subject name (the previous `/arabic|english/i` predicate could
 * not — English worked, Arabic silently did not). Essays are dropped at ingest as
 * non-MCQ rows (`lib/ingest/normalize.ts`), so in the persisted seed the only
 * surviving signal is the subject identity; the item-data path keeps the detector
 * correct if essay items ever flow through.
 */

/** Arabic Unicode block (U+0600–U+06FF) — matches the Arabic-script subject name. */
const ARABIC_SCRIPT = /[؀-ۿ]/;

/** Maximum marks for a single essay item. */
export const ESSAY_ITEM_MAX = 20;
/** Essays carried by each essay subject (English + Arabic each have two). */
export const ESSAYS_PER_ESSAY_SUBJECT = 2;
/** Full (pre-weight) essay marks available per subject = essays × max-per-essay. */
export const ESSAY_ITEM_MAX_SUM = ESSAYS_PER_ESSAY_SUBJECT * ESSAY_ITEM_MAX; // 40
/**
 * Half-weighted essay max reserved in the subject denominator: the sum of the
 * subject's essay item max, halved. Derived — never hard-code 20. For English /
 * Arabic this yields 20 (40 / 2).
 */
export const ESSAY_MAX_RESERVED = ESSAY_ITEM_MAX_SUM / 2; // 20

/** Anything carrying a subject name and (optionally) its items, for detection. */
export interface EssayDetectable {
  name: string;
  items?: readonly { maxScore?: number | null }[];
}

/** Script-aware subject-name match (Arabic block OR the Latin subject labels). */
function matchesEssayName(name: string): boolean {
  return ARABIC_SCRIPT.test(name) || /arabic|english/i.test(name);
}

/**
 * Does this subject carry an essay component? Item-data first (a max beyond the
 * dichotomous MCQ 1 is a polytomous/essay item), then a script-aware name match
 * so the Arabic-script subject is recognised. Accepts a subject object or a bare
 * name (callers with only a name still get the script-aware match).
 */
export function isEssaySubject(subject: EssayDetectable | string): boolean {
  if (typeof subject === "string") return matchesEssayName(subject);
  if (subject.items?.some((it) => (it.maxScore ?? 1) > 1)) return true;
  return matchesEssayName(subject.name);
}

/**
 * Sum of a subject's essay item max (the full, pre-weight essay marks available).
 * Derived from the item data when essay items are present; otherwise the known
 * essay block (two essays × 20). Used to derive the half-weighted reserved max.
 */
export function essayItemMaxSum(subject: EssayDetectable): number {
  const fromItems =
    subject.items?.filter((it) => (it.maxScore ?? 1) > 1).reduce((n, it) => n + (it.maxScore ?? 0), 0) ?? 0;
  return fromItems > 0 ? fromItems : ESSAY_ITEM_MAX_SUM;
}

/**
 * Half-weighted essay max reserved in the denominator for an essay subject:
 * `essayItemMaxSum / 2`. Returns 0 for a non-essay subject (nothing reserved).
 */
export function reservedEssayMax(subject: EssayDetectable): number {
  return isEssaySubject(subject) ? essayItemMaxSum(subject) / 2 : 0;
}
