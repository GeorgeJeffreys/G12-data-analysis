-- ============================================================================
-- Rollback for 0020_restore_ingest_delete.sql
--
-- Reverts the 0020-introduced changes ONLY:
--   * Restores `clear_sitting_data` / `delete_sitting` to their 0007 void-returning
--     bodies and `reset_cycle_for_reingest` / `app.clear_cycle_ingest` to their
--     0018 void-returning bodies (drop-then-create — the return type changes back).
--   * Drops the new probes `public.schema_health()` and `app.cycle_row_count(uuid)`.
--
-- DELIBERATELY NOT reverted:
--   * `items.item_set` is NOT dropped. It belongs to migration 0010 and is
--     referenced by `ingest_persist` (0019/0020); dropping it would re-break
--     ingest. Roll 0010 back separately (0010_items_item_set.rollback.sql) if the
--     column itself must go.
--   * `public.ingest_persist(...)` is left at its 0019/0020 definition (identical
--     bodies) — nothing to revert.
-- ============================================================================

begin;

drop function if exists public.schema_health();
drop function if exists app.cycle_row_count(uuid);

-- clear_cycle_ingest → 0018 void body.
drop function if exists app.clear_cycle_ingest(uuid);
create or replace function app.clear_cycle_ingest(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  delete from participant_scores ps using score_runs sr
    where ps.score_run_id = sr.id and sr.cycle_id = p_cycle;
  delete from score_runs where cycle_id = p_cycle;
  delete from item_stats st using items i
    where st.item_id = i.id and i.cycle_id = p_cycle;
  delete from grades where cycle_id = p_cycle;

  delete from result_totals where cycle_id = p_cycle;
  delete from topic_rollups where cycle_id = p_cycle;
  delete from responses     where cycle_id = p_cycle;
  delete from items         where cycle_id = p_cycle;
  delete from participants  where cycle_id = p_cycle;
  delete from assessments   where cycle_id = p_cycle;
  delete from import_batches where cycle_id = p_cycle;
end $$;

-- clear_sitting_data → 0007 void body.
drop function if exists public.clear_sitting_data(uuid);
create or replace function public.clear_sitting_data(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  perform app.clear_cycle_ingest(p_cycle);
  update exam_cycles set status = 'draft', updated_at = now() where id = p_cycle;
  perform app.audit(p_cycle, 'clear', 'exam_cycle', p_cycle::text, null,
                    jsonb_build_object('cleared', true));
end $$;
grant execute on function public.clear_sitting_data(uuid) to authenticated;

-- delete_sitting → 0007 void body.
drop function if exists public.delete_sitting(uuid);
create or replace function public.delete_sitting(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare c exam_cycles;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  select * into c from exam_cycles where id = p_cycle;
  if not found then return; end if;
  perform app.audit(null, 'delete', 'exam_cycle', p_cycle::text, to_jsonb(c), null);
  delete from exam_cycles where id = p_cycle;
end $$;
grant execute on function public.delete_sitting(uuid) to authenticated;

-- reset_cycle_for_reingest → 0018 void body.
drop function if exists public.reset_cycle_for_reingest(uuid, uuid);
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
