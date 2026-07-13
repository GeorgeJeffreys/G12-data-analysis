-- ============================================================================
-- 0043_remove_seeded_cohort_exclusions.sql
--
-- Production cutover: ingest exam data EXACTLY as exported. There is no
-- person-level / identity-based exclusion anywhere in the pipeline before the
-- Clean step. Removing a row (staff / test / withdrawn) is a MANUAL human action
-- in Clean.
--
-- Migration 0033 seeded a default staff/test cohort exclusion (the historical
-- Lavinia/Muamina rows) baked with hard-coded emails. 0033 is already applied
-- and must not be amended, so this forward migration removes that identity-based
-- SEED as data — while KEEPING the mechanism it rode on:
--
--   * the `cohort_exclusions` table                     — KEPT
--   * the `set_cohort_exclusion(...)` RPC (Clean's       — KEPT
--     "Remove from all subjects" / restore)
--
-- Only the seeded defaults are removed. They are the ONLY rows with no human
-- decider: the seed inserted `decided_by = null`, whereas every exclusion made
-- through the RPC stamps `auth.uid()`. Targeting `decided_by is null` removes the
-- baked-in identity filter for every cohort without hard-coding any email here.
--
-- Idempotent and forward-only. Run in the Supabase SQL editor (EU).
-- Engine parity is unaffected: with no cohort exclusions the scored set is the
-- full ingested cohort until a human excludes a row in Clean.
-- ============================================================================

begin;

delete from cohort_exclusions
where decided_by is null;

commit;
