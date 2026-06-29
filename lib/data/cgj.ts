/**
 * CGJ (Centre Grade Judgement) — shared vocabulary, the ASSUMED PLD→award
 * mapping, and the pure expected-vs-actual comparison helpers. Kept out of the
 * provider so the mapping and the rank comparison can be unit-tested directly.
 *
 * The pipeline already produces, per student per subject, an actual performance
 * level (the PLD). Partner centres supply an Excel of EXPECTED levels per
 * subject. CGJ lines the two up side by side. Nothing here recomputes a grade —
 * the actual levels/awards come from the engine via `getGrades`.
 *
 * ── O2 (open for G12) ───────────────────────────────────────────────────────
 * The alignment between the four performance levels (PLDs) and the four award
 * levels — Doesn't-meet ↔ No Award, Meets ↔ Secondary, Exceeds ↔ Advanced,
 * Outstanding ↔ Distinction — is an ASSUMPTION, not a signed-off rule. It is the
 * rank-for-rank zip of the two confirmed vocabularies. It is surfaced as a
 * labelled assumption (see `assumedPldAwardMap` + `CgjModel.pldAwardMapAssumed`)
 * and used ONLY to label the CGJ view (e.g. the award a centre's expected PLD
 * implies). It never overrides the engine's award derivation.
 */

import type { CgjMatch, PldAwardMapEntry } from "./types";

/**
 * The assumed PLD→award alignment: rank `i` of the performance vocabulary maps
 * to rank `i` of the award vocabulary. With the confirmed G12 vocabularies this
 * is exactly Outstanding↔Distinction · Exceeds↔Advanced · Meets↔Secondary ·
 * Doesn't-meet↔No Award. Assumed, not signed off (O2).
 */
export function assumedPldAwardMap(
  performanceLevels: string[],
  awardLevels: string[],
): PldAwardMapEntry[] {
  return performanceLevels.map((performanceLevel, i) => ({
    performanceLevel,
    // Defensive: if the two lists ever differ in length, clamp to the lowest award.
    awardLevel: awardLevels[i] ?? awardLevels[awardLevels.length - 1] ?? "",
  }));
}

/** The award a single expected PLD implies under the assumed map (null if unknown). */
export function awardForPld(
  pld: string | null,
  performanceLevels: string[],
  awardLevels: string[],
): string | null {
  if (!pld) return null;
  const i = performanceLevels.indexOf(pld);
  return i < 0 ? null : awardLevels[i] ?? null;
}

/**
 * Normalise a raw cell from the centre file into one of the canonical
 * performance levels (best → lowest). Tolerant of shorthand the centres use:
 * the full label, a leading word ("Meets", "Exceeds", "Outstanding"), "doesn't
 * meet" / "below", or a star string ("*", "**", "***"). Returns null when the
 * cell is blank or unrecognised (a blank expectation, not a wrong one).
 */
export function normalizePerformanceLevel(
  raw: string,
  performanceLevels: string[],
): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  // Exact / contained label match first (most reliable).
  for (const lvl of performanceLevels) {
    const l = lvl.toLowerCase();
    if (l === v || l.includes(v) || v.includes(l)) return lvl;
  }
  // Keyword match against the conventional PLD wording. Order matters: the
  // negative "doesn't (yet) meet" case must be tested BEFORE the bare "meet"
  // pattern, or "doesn't meet" would match Meets.
  const byKeyword: [RegExp, number][] = [
    [/doesn|does not|not yet|below|fail|no award|none/, 3],
    [/outstand|excellent|distinction|\*\*\*/, 0],
    [/exceed|advanced|\*\*/, 1],
    [/meet|secondary|pass|\*/, 2],
  ];
  for (const [re, rank] of byKeyword) {
    if (re.test(v) && performanceLevels[rank]) return performanceLevels[rank]!;
  }
  return null;
}

/**
 * Compare an actual PLD to the expected PLD by RANK in `performanceLevels`
 * (index 0 = best). "above" means the student did better than the centre
 * expected; "below" means worse; "missing" means no actual level (the student
 * isn't in that subject) or no expectation was supplied.
 */
export function compareLevels(
  expected: string | null,
  actual: string | null,
  performanceLevels: string[],
): CgjMatch {
  if (!expected || !actual) return "missing";
  const e = performanceLevels.indexOf(expected);
  const a = performanceLevels.indexOf(actual);
  if (e < 0 || a < 0) return "missing";
  if (a === e) return "match";
  // Lower index = higher level, so a smaller actual index beats expectation.
  return a < e ? "above" : "below";
}
