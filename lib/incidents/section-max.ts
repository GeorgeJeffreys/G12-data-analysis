/**
 * Section maximum for a `% of section` incident formula.
 *
 * CRITICAL: the section max MUST be the engine's SCORED denominator, never a
 * naïve sum of raw item max scores. Some items are max-0 stimulus items that the
 * engine excludes from the denominator, and cohort-excluded items are dropped
 * too. The engine already computes exactly this figure per assessment as
 * `ParticipantScore.max` (retained-MCQ max + reserved essay max) — so for the
 * default `assessment` basis we READ that value straight from engine output
 * rather than re-derive it (zero drift from the parity-locked engine).
 *
 * The finer `major_element` basis is a scored denominator over a subset of items;
 * `majorElementSectionMax` computes it with the SAME retained-item rule the engine
 * uses (only items that appear in the responses, are not excluded, and carry a
 * positive max score contribute). 02b feeds whichever basis a code declares into
 * `evaluateFormula`.
 */

import type { ItemMeta, ParticipantScore, ResponseRecord } from "@/lib/engine/types";
import type { IncidentFormula, SectionBasis } from "./types";

/**
 * The assessment (subject) scored max — read from the engine's participant
 * scores. All participants on an assessment share the same cohort `max`, so any
 * one row suffices. Returns null when the assessment has no scored rows.
 */
export function assessmentSectionMax(
  scores: readonly ParticipantScore[],
  assessmentId: string,
): number | null {
  const row = scores.find((s) => s.assessmentId === assessmentId);
  return row ? row.max : null;
}

/**
 * The scored max for one QuestionMajorElement within an assessment, using the
 * engine's retained-item denominator rule: distinct items that (a) belong to the
 * assessment + major element, (b) appear in the responses, and (c) are NOT in
 * `excludedItemIds`; summed by each item's `maxScore` (default 1). Max-0 items
 * contribute 0, so stimulus items never inflate the denominator.
 */
export function majorElementSectionMax(
  responses: readonly ResponseRecord[],
  items: readonly ItemMeta[],
  assessmentId: string,
  majorElement: string,
  excludedItemIds: readonly string[] = [],
): number {
  const excluded = new Set(excludedItemIds);
  const maxByItem = new Map<string, number>();
  const inSection = new Set<string>();
  for (const it of items) {
    if (it.assessmentId !== assessmentId) continue;
    if ((it.majorElement ?? "") !== majorElement) continue;
    maxByItem.set(it.itemId, it.maxScore ?? 1);
    inSection.add(it.itemId);
  }
  const retained = new Set<string>();
  for (const r of responses) {
    if (r.assessmentId !== assessmentId) continue;
    if (excluded.has(r.itemId)) continue;
    if (inSection.has(r.itemId)) retained.add(r.itemId);
  }
  let max = 0;
  for (const id of retained) max += maxByItem.get(id) ?? 1;
  return max;
}

/**
 * Resolve the section max for a formula from pre-computed denominators. The
 * caller supplies whichever it has (both derived from the engine's scored
 * denominator, via the helpers above). Returns 0 when the needed basis is
 * unavailable, so a `% of section` formula degrades to granting nothing rather
 * than guessing.
 */
export function resolveSectionMax(
  formula: IncidentFormula,
  denominators: { assessment?: number | null; majorElement?: number | null },
): number {
  if (formula.kind !== "pct_section") return 0;
  const basis: SectionBasis = formula.basis;
  const value = basis === "major_element" ? denominators.majorElement : denominators.assessment;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
