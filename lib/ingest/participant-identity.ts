/**
 * Participant identity on the ingest path (root cause: identity collapse).
 *
 * A participant's identity MUST be keyed on a guaranteed-unique field from the
 * export — never on a derived, hashed, initial-based or name-based value that can
 * collide. The Questionmark export's `ResultParticipantName` is NOT safe for this:
 * for a real cohort it is often a short login / initials code ("A-A") that several
 * students share, or blank — so keying identity on it silently folds distinct
 * students into one record (the per-subject "8 participants when 15 sat it"
 * collapse, and the per-student score-matrix corruption that rides on it).
 *
 * Identity is therefore resolved here, in this precedence:
 *   1. an explicit, guaranteed-unique **ParticipantID** column, when present;
 *   2. the **participant email** (a unique, stable-across-subjects field);
 *   3. the **result→participant mapping** — the unique `ResultId` — as the final
 *      fallback so two distinct results are NEVER merged.
 *
 * On top of the precedence we apply a collision safety-net: if a chosen stable key
 * is shared by two or more DISTINCT results WITHIN ONE SUBJECT (the collapse
 * signature — a non-unique `ResultParticipantName` folding real sitters together),
 * that key cannot be trusted as an identity, so those results fall back to their
 * unique `ResultId`. Net effect: distinct sitters never collapse, and a
 * participant's cross-subject identity is preserved whenever a real unique id
 * exists. The P00xx pseudonym then maps 1:1 from this resolved identity — it is
 * display-only and never the identity itself.
 */

/** Columns that may carry an explicit, guaranteed-unique participant id. */
export const PARTICIPANT_ID_COLUMNS = ["ParticipantID", "ParticipantId", "Participant ID"] as const;
/** Columns that may carry the participant email (unique, stable across subjects). */
export const PARTICIPANT_EMAIL_COLUMNS = ["ParticipantEmail", "ResultParticipantName"] as const;

/** Every column whose value the identity resolver may read off a row. The bridge
 *  copies these from the Assessments row onto each joined response row so the
 *  legacy normaliser resolves the same identity the canonical model does. */
export const PARTICIPANT_IDENTITY_COLUMNS: readonly string[] = [
  ...PARTICIPANT_ID_COLUMNS,
  ...PARTICIPANT_EMAIL_COLUMNS,
];

/** Values that are present-but-meaningless and must NOT key an identity. */
const PLACEHOLDERS = new Set(["", "<not defined>", "<unknown>", "n/a", "na", "none", "null", "-"]);

function cell(row: Record<string, unknown>, col: string): string {
  const v = row[col];
  return v === null || v === undefined ? "" : String(v).trim();
}

function usable(value: string): boolean {
  return value !== "" && !PLACEHOLDERS.has(value.toLowerCase());
}

export type IdentitySource = "participant_id" | "email" | "result_id";

/**
 * The raw stable identity candidate for one row: an explicit unique ParticipantID,
 * else a participant email — both guaranteed-unique and stable across a
 * participant's subjects. Returns null when neither is usable (the caller then
 * falls back to the unique result→participant mapping). NEVER derived from
 * names/initials.
 */
export function rawParticipantKey(
  row: Record<string, unknown>,
): { key: string; source: Exclude<IdentitySource, "result_id"> } | null {
  for (const col of PARTICIPANT_ID_COLUMNS) {
    const v = cell(row, col);
    if (usable(v)) return { key: v, source: "participant_id" };
  }
  for (const col of PARTICIPANT_EMAIL_COLUMNS) {
    const v = cell(row, col);
    if (usable(v)) return { key: v.toLowerCase(), source: "email" };
  }
  return null;
}

/** One result's identity inputs: its unique result id, its subject, and the row. */
export interface IdentityInputRow {
  resultId: string;
  subject: string;
  row: Record<string, unknown>;
}

/** Result of identity resolution: the per-result identity plus its source. */
export interface ResolvedIdentity {
  id: string;
  source: IdentitySource;
}

const SEP = "␟"; // unit-separator: cannot occur in a subject/key

/**
 * Assign every result a guaranteed-unique participant identity (see module doc).
 * Returns a map from `resultId` to the resolved identity. Rows are grouped by
 * result (one identity per `ResultId`); a stable key is downgraded to the unique
 * `ResultId` when it is blank or folds ≥2 distinct results within one subject.
 */
export function assignParticipantIdentities(
  rows: readonly IdentityInputRow[],
): Map<string, ResolvedIdentity> {
  // 1. One stable key per distinct result (first usable value wins).
  const keyByResult = new Map<string, { key: string; source: Exclude<IdentitySource, "result_id"> | null }>();
  const subjectByResult = new Map<string, string>();
  for (const { resultId, subject, row } of rows) {
    if (!resultId) continue;
    if (!subjectByResult.has(resultId)) subjectByResult.set(resultId, subject);
    const existing = keyByResult.get(resultId);
    if (existing && existing.key) continue; // already have a usable key for this result
    const raw = rawParticipantKey(row);
    if (raw) keyByResult.set(resultId, raw);
    else if (!existing) keyByResult.set(resultId, { key: "", source: null });
  }

  // 2. Per (stable key, subject), collect the distinct results carrying it.
  const resultsByKeySubject = new Map<string, Set<string>>();
  for (const [resultId, { key }] of keyByResult) {
    if (!key) continue;
    const bucket = `${key}${SEP}${subjectByResult.get(resultId) ?? ""}`;
    (resultsByKeySubject.get(bucket) ?? resultsByKeySubject.set(bucket, new Set()).get(bucket)!).add(resultId);
  }

  // 3. Final identity per result: trust the stable key only when it is non-blank
  //    AND maps to a single result within its subject; otherwise fall back to the
  //    unique result→participant mapping so distinct sitters never merge.
  const identityByResult = new Map<string, ResolvedIdentity>();
  for (const [resultId, { key, source }] of keyByResult) {
    const subject = subjectByResult.get(resultId) ?? "";
    const folded = !key || (resultsByKeySubject.get(`${key}${SEP}${subject}`)?.size ?? 0) > 1;
    identityByResult.set(
      resultId,
      folded ? { id: `result:${resultId}`, source: "result_id" } : { id: key, source: source ?? "email" },
    );
  }
  return identityByResult;
}
