/**
 * Configurable known test / staff account emails for the Clean-stage
 * KNOWN_TEST_ACCOUNT flag.
 *
 * This is a supplementary heuristic ONLY. The authoritative staff/test exclusion
 * is data-driven — the per-cohort `cohort_exclusions` list applied via
 * `excludeParticipantFromCohort` (that is how Lavinia Cavalet's account is
 * already removed cohort-wide), never a constant baked into scoring. This list
 * exists so the Clean tab can *suggest* obvious test addresses that a reviewer
 * may not yet have excluded; edit it here (one place) to tune the suggestions.
 *
 * Matching is case-insensitive; keep entries lowercased.
 */
export const KNOWN_TEST_ACCOUNT_EMAILS: readonly string[] = [
  "test@test.com",
  "test@example.com",
  "demo@demo.com",
  "qa@test.com",
  "admin@test.com",
];
