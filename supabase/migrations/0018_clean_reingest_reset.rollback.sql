-- ============================================================================
-- Rollback for 0018_clean_reingest_reset.sql
--   * Drops the SQL-editor reset function.
--   * Restores `app.clear_cycle_ingest` to its 0007 body (cascade-only clear).
-- No data is lost; this only reverts the lifecycle helpers.
-- ============================================================================

begin;

drop function if exists public.reset_cycle_for_reingest(uuid, uuid);

-- Restore the 0007 definition (relies on FK cascade for engine outputs).
create or replace function app.clear_cycle_ingest(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  delete from result_totals where cycle_id = p_cycle;
  delete from topic_rollups where cycle_id = p_cycle;
  delete from responses     where cycle_id = p_cycle;
  delete from items         where cycle_id = p_cycle;   -- cascades item_stats / item_reviews
  delete from participants  where cycle_id = p_cycle;   -- cascades grades / participant_scores
  delete from assessments   where cycle_id = p_cycle;   -- cascades score_runs
  delete from import_batches where cycle_id = p_cycle;
end $$;

commit;
