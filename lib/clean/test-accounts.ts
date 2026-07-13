/**
 * Configurable known test / staff account emails for the Clean-stage
 * KNOWN_TEST_ACCOUNT suggestion.
 *
 * Production ships NO baked-in identities: exam data is ingested exactly as
 * exported, and removing a row (staff/test/withdrawn) is a manual human action
 * in the Clean step. This list is therefore empty by default — the flag never
 * pre-judges an address. It stays as the single, case-insensitive configuration
 * point should a workspace later choose to surface its own test-address hints.
 */
export const KNOWN_TEST_ACCOUNT_EMAILS: readonly string[] = [];
