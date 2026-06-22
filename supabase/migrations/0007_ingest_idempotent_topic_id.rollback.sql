-- ============================================================================
-- Rollback for 0007_ingest_idempotent_topic_id.sql
--
-- Reverses the topic-id re-key, the ingest/clear/delete functions. Run in the
-- Supabase SQL editor only if you need to undo migration 0007. Restores the
-- original 0006 topic_rollups uniqueness (on topic_name) and makes qm_topic_id
-- nullable again. No 0001–0006 data is lost.
-- ============================================================================

begin;

-- Functions added by 0007.
drop function if exists public.delete_sitting(uuid);
drop function if exists public.clear_sitting_data(uuid);
drop function if exists public.ingest_persist(uuid, jsonb, uuid);
drop function if exists app.clear_cycle_ingest(uuid);

-- Revert topic_rollups back to the 0006 key (name-based, qm_topic_id nullable).
alter table topic_rollups
  drop constraint if exists topic_rollups_cycle_id_qm_result_id_qm_topic_id_key;

alter table topic_rollups alter column qm_topic_id drop not null;

alter table topic_rollups
  add constraint topic_rollups_cycle_id_qm_result_id_topic_name_key
  unique (cycle_id, qm_result_id, topic_name);

commit;
