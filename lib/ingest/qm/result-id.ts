/**
 * Canonical ResultId (the QM sitting key) — the SINGLE place a raw `ResultId` is
 * turned into the join / persist key used across the three exports.
 *
 * A `ResultId` = one participant's sitting of one assessment; the Items,
 * Assessments and Topics exports are joined on it, and it is persisted as
 * `qm_result_id` (the sitting grain, migration 0021). The three CSVs are produced
 * by separate export passes and, in the wild, do NOT always render the numeric id
 * byte-identically: a large integer can come back with a spreadsheet-style trailing
 * decimal (`"1572504488.0"`), padded whitespace, or wrapping quotes in one file but
 * not another. A bare `String === String` join then FAILS to match those rows, so a
 * whole sitting's Items orphan against its Assessments roster row — the sitting
 * appears on the roster but persists ZERO responses and is silently dropped (it is
 * absent from BOTH `responses` and `result_totals`, so the roster ↔ responses guard
 * cannot see it). See task 19.
 *
 * `normalizeResultId` collapses those representational differences to one canonical
 * string so the SAME sitting keys identically no matter which export it was read
 * from — and so the value persisted as `qm_result_id` is stable across responses,
 * result_totals and topic_rollups. It is deterministic and injective over distinct
 * ids: two genuinely different ResultIds never collapse together (only the
 * whitespace / quote / trailing-`.0` skin of ONE id is removed).
 */

/**
 * Canonicalise a raw `ResultId` cell to its stable join / persist key.
 *
 * - trims surrounding whitespace and a single layer of wrapping quotes,
 * - strips a spreadsheet trailing decimal on an otherwise-integer id
 *   (`"1572504488.0"` / `"1572504488.00"` → `"1572504488"`),
 * - normalises an integer written in exponential form (`"1.572504488E9"`), which
 *   some CSV exporters emit for large numbers, back to its plain-integer string.
 *
 * Any value that is not a recognised numeric shape is returned trimmed-only, so
 * non-numeric ids (should they ever appear) pass through unchanged.
 */
export function normalizeResultId(raw: string): string {
  return canonNumericQmId(raw);
}

/**
 * Canonical `QuestionId` (the QM question key). A `QuestionId` is a numeric QM id
 * from the SAME export family as `ResultId`, so it is subject to the identical
 * representational skew (wrapping quotes, padded whitespace, spreadsheet trailing
 * `.0`, exponential form). It is used as the item natural key and as the second leg
 * of the response de-dup key `(ResultId, QuestionId)`, so it MUST be canonicalised
 * the same way in every place it is read — otherwise a padded/reshaped QuestionId
 * misses the canonical item-metadata join and escapes response de-dup, the exact
 * class of failure that dropped whole sittings on the ResultId axis (task 23).
 */
export function normalizeQuestionId(raw: string): string {
  return canonNumericQmId(raw);
}

/** Shared numeric-QM-id canonicaliser — one body for ResultId and QuestionId. */
function canonNumericQmId(raw: string): string {
  let v = (raw ?? "").trim();
  if (v === "") return "";
  // Strip one layer of wrapping quotes (some exporters quote id columns).
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    v = v.slice(1, -1).trim();
  }
  // Plain integer already — the common case, no reshaping.
  if (/^\d+$/.test(v)) return v;
  // Integer rendered with a spreadsheet trailing decimal: 1572504488.0 → 1572504488.
  const dec = /^(\d+)\.0+$/.exec(v);
  if (dec) return dec[1]!;
  // Integer rendered in exponential form: 1.572504488E9 / 1.5725e9 → 1572504488.
  const exp = /^(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/.exec(v);
  if (exp) {
    const intPart = exp[1]!;
    const fracPart = exp[2] ?? "";
    const shift = Number(exp[3]);
    if (Number.isFinite(shift) && shift >= fracPart.length) {
      const digits = intPart + fracPart;
      const zeros = shift - fracPart.length;
      // Only accept when the mantissa is a single leading digit (canonical sci form)
      // or the expansion is unambiguous — guard against dropping precision.
      if (intPart.length === 1 || /^0*$/.test(intPart.slice(1))) {
        return (digits + "0".repeat(zeros)).replace(/^0+(?=\d)/, "");
      }
    }
  }
  return v;
}
