-- ============================================================================
-- G12++ — reliable CLEAN RE-INGEST RESET (purge a cycle's stale ingested data so
-- a re-upload's fresh, correct cohort fully replaces it).
-- Migration 0018_clean_reingest_reset.sql
--
-- WHY THIS EXISTS
--   The participant identity / ingest fixes (P-A, migrations 0006–0016) make a
--   FRESH ingest of the raw exports resolve every distinct sitter correctly:
--   Applicable Math = 15 distinct participants at every stage (verified end-to-end
--   through the persist-payload builder — tests/ingest-write.participant-count.test.ts).
--   `ingest_persist` (0007) is clear-then-insert, so a re-upload of a cycle already
--   REPLACES its rows cleanly.
--
--   But a database that still holds rows ingested BEFORE those fixes shows the old
--   collapse (Applicable Math surfacing 9/7 instead of 15) until that cycle is
--   re-ingested through the fixed path. Two operational gaps made purging such a
--   cycle unreliable:
--     * `clear_sitting_data` (0007) authorises via `app.has_role(auth.uid())`, and
--       `auth.uid()` is NULL in the Supabase SQL editor (no session) — so running
--       it there fails with "not authorized".
--     * `scripts/wipe-cycle-ingest.sql` hardcodes ONE cycle id (the seed sitting);
--       run against a different live cycle it clears nothing, leaving stale rows.
--
--   This migration adds an SQL-editor-runnable, PARAMETER-DRIVEN reset that does
--   not depend on a session, and hardens the shared clear so no stale MATERIALISED
--   score can survive even if a future schema change drops an FK cascade.
--
-- WHAT THIS DOES
--   1. Hardens `app.clear_cycle_ingest(cycle)` — deletes the engine OUTPUTS
--      (participant_scores / score_runs / item_stats / grades) EXPLICITLY before
--      the parent ingest rows, instead of relying only on FK cascade. Still keeps
--      the cycle shell and — deliberately — `clean_exclusions` (they re-resolve by
--      stable key on re-ingest, migration 0016), so manual cohort removals survive.
--   2. Adds `public.reset_cycle_for_reingest(p_cycle uuid, p_actor uuid default null)`
--      — SECURITY DEFINER, no `auth.uid()` dependency, so it runs in the SQL editor.
--      Clears the cycle's ingested + materialised rows and returns it to the
--      'draft' (Upload) state, ready for a fresh upload. Audited when an actor id
--      is supplied. Granted to `service_role` only (the SQL editor runs privileged).
--
-- Reversibility: additive. `0018_…rollback.sql` restores the 0007 body of
-- `app.clear_cycle_ingest` and drops the new function. Engine parity is unaffected
-- (this touches only ingest/persistence lifecycle, never the scoring maths).
--
-- The human runs this in the Supabase SQL editor (EU) AFTER 0001–0017. Then runs
-- the RESET block at the bottom for the affected cycle and re-uploads the CSVs.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Harden the shared clear. Same FK-safe intent as 0007, but the engine
--    outputs are removed EXPLICITLY (belt-and-braces) so a stale materialised
--    score (the "Score shows 7" surface) can never outlive a reset. Order:
--    children first, then the parents (whose cascade would also catch them).
--    `clean_exclusions` is intentionally NOT cleared — it survives re-ingest.
-- ----------------------------------------------------------------------------
create or replace function app.clear_cycle_ingest(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  -- Engine OUTPUTS (materialised) — explicit, in case a cascade is ever missing.
  delete from participant_scores ps
    using score_runs sr
    where ps.score_run_id = sr.id and sr.cycle_id = p_cycle;
  delete from score_runs where cycle_id = p_cycle;
  delete from item_stats st
    using items i
    where st.item_id = i.id and i.cycle_id = p_cycle;
  delete from grades where cycle_id = p_cycle;

  -- Ingested rows (FK-safe order; deleting the parents also cascades the above).
  delete from result_totals where cycle_id = p_cycle;
  delete from topic_rollups where cycle_id = p_cycle;
  delete from responses     where cycle_id = p_cycle;
  delete from items         where cycle_id = p_cycle;   -- cascades item_stats / item_reviews
  delete from participants  where cycle_id = p_cycle;   -- cascades grades / participant_scores
  delete from assessments   where cycle_id = p_cycle;   -- cascades score_runs
  delete from import_batches where cycle_id = p_cycle;
end $$;

-- ----------------------------------------------------------------------------
-- 2. SQL-editor-runnable clean re-ingest reset. No `auth.uid()` dependency, so it
--    works from the editor (which has no session). Clears the cycle and returns
--    it to the Upload/draft state; a fresh upload then repopulates it correctly.
--    Audited only when an explicit actor is supplied (audit_log.actor_id is NOT
--    NULL and defaults to auth.uid(), which is null here).
-- ----------------------------------------------------------------------------
create or replace function public.reset_cycle_for_reingest(
  p_cycle uuid, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not exists (select 1 from exam_cycles where id = p_cycle) then
    raise exception 'reset_cycle_for_reingest: no cycle %', p_cycle;
  end if;

  perform app.clear_cycle_ingest(p_cycle);

  update exam_cycles set status = 'draft', updated_at = now() where id = p_cycle;

  if p_actor is not null then
    insert into audit_log (cycle_id, actor_id, action, entity, entity_id, before, after)
    values (p_cycle, p_actor, 'reset_for_reingest', 'exam_cycle', p_cycle::text, null,
            jsonb_build_object('cleared', true, 'returned_to', 'draft'));
  end if;
end $$;

revoke all on function public.reset_cycle_for_reingest(uuid, uuid) from public;
grant execute on function public.reset_cycle_for_reingest(uuid, uuid) to service_role;

commit;

-- ----------------------------------------------------------------------------
-- RESET RUNNER (run AFTER the migration above). Purge the affected cycle's stale
-- rows, then RE-UPLOAD the three CSVs in the app — the fresh ingest lands 15/11/
-- 12/9/10. Set the cycle name (or id) below. This block is idempotent and safe to
-- re-run. Uncomment to use.
-- ----------------------------------------------------------------------------
-- do $$
-- declare
--   v_cycle uuid;
-- begin
--   -- Resolve by name (edit to match your sitting); or set v_cycle directly.
--   select id into v_cycle from exam_cycles
--     order by created_at desc limit 1;              -- the live cycle (hydrate's cycles[0])
--   -- select id into v_cycle from exam_cycles where name = 'May 2026';
--   if v_cycle is null then raise exception 'no cycle resolved'; end if;
--   perform public.reset_cycle_for_reingest(v_cycle, null);
--   raise notice 'Reset cycle % for clean re-ingest — now re-upload the CSVs.', v_cycle;
-- end $$;
