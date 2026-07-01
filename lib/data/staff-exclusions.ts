/**
 * Staff / test account exclusion list — keyed on email, applied at the cohort
 * boundary.
 *
 * Root cause context (prompt-09): the reported symptom is that staff/test
 * accounts — notably **Lavinia** (a G12 Lead) and **Muamina** (a re-sit / test
 * account) — reach the Candidate Scores / Grades pages. The robust primary fix is
 * a configured exclusion list keyed on the participant's **email**
 * (`ResultParticipantName`, the ONLY collision-free natural key per P-A). Email is
 * stable across re-imports (the per-ingest row UUID is not), so listing an account
 * here excludes it from EVERY subject and from `participant_scores` and — because
 * it keys on data, not a stored id — the exclusion survives ingest with no replay.
 *
 * Excluding Muamina by email also drops her typo `G12++ Applicable Maths` sitting
 * (`ResultId=912399558`), collapsing the two reported bugs into one fix.
 *
 * Keep this aligned with the reconcile oracle's exclusion set (reconcile.py): the
 * oracle computes ground truth from the RAW CSVs, which still include these
 * accounts, so it must apply the SAME list or it reports them as spurious diffs.
 */
import { internalParticipantId } from "@/lib/ingest/participant-identity";

/**
 * Staff / test account emails excluded from the whole cohort. Lower-cased and
 * trimmed via `internalParticipantId` at compare time, so casing/whitespace in the
 * export never lets an account slip through. Seed with the two confirmed accounts;
 * extend here as more staff/test logins are identified.
 */
export const STAFF_TEST_EMAILS: readonly string[] = [
  "lavinia.cavalet@alsamaproject.com", // G12 Lead — staff account
  "muamina.mlisho@alsamaproject.com", // re-sit / test account (also the typo Maths row)
];

/** The normalised staff/test set — the same injective normalisation P-A mints the
 *  internal participant id with, so a listed email matches a participant's id 1:1. */
const STAFF_TEST_SET: ReadonlySet<string> = new Set(
  STAFF_TEST_EMAILS.map((e) => internalParticipantId(e)),
);

/**
 * True when `email` is a configured staff/test account. Accepts the participant's
 * email in any of its stable forms — the raw `ResultParticipantName`, the P-A
 * internal id, or the `qm_participant_id` (all the email, normalised the same way).
 * Null/blank is never staff.
 */
export function isStaffTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return STAFF_TEST_SET.has(internalParticipantId(email));
}
