-- ============================================================================
-- ROLLBACK for 0029_responses_sitting_qualified_persist.sql — restore the 0028
-- schema_health body (reports '0028'; drops the ingest_persist whole-sitting
-- guard probe). The responses grain + ingest_persist body are unchanged from
-- 0026/0028 (0029 only re-affirmed them), so nothing else needs reverting.
-- ============================================================================

begin;

create or replace function public.schema_health()
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_missing_cols text[] := '{}';
  v_missing_fns  text[] := '{}';
begin
  -- Required columns.
  if to_regclass('public.items') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'items' and column_name = 'item_set') then
    v_missing_cols := array_append(v_missing_cols, 'items.item_set');
  end if;

  -- AUTH (0025 — retained): enum, primitive, memberships policies.
  if not exists (
    select 1 from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'member_role' and e.enumlabel = 'lead_admin') then
    v_missing_cols := array_append(v_missing_cols, 'enum member_role:lead_admin');
  end if;
  if not exists (
    select 1 from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'member_role' and e.enumlabel = 'analyst') then
    v_missing_cols := array_append(v_missing_cols, 'enum member_role:analyst');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'memberships'
      and policyname = 'memberships_select'
      and coalesce(qual, '') ilike '%auth.uid()%'
      and coalesce(qual, '') not ilike '%is_member%'
      and coalesce(qual, '') not ilike '%has_role%') then
    v_missing_cols := array_append(v_missing_cols, 'memberships:self-read select policy');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'memberships'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and (coalesce(qual, '') ilike '%has_role%' or coalesce(with_check, '') ilike '%has_role%')) then
    v_missing_cols := array_append(v_missing_cols, 'memberships:has_role write policy');
  end if;

  -- PIPELINE (0026): the sitting spine + the natural-key grain + the real cascade.
  if to_regclass('public.sittings') is null then
    v_missing_cols := array_append(v_missing_cols, 'table sittings');
  elsif not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sittings'::regclass and contype = 'p') then
    v_missing_cols := array_append(v_missing_cols, 'sittings:primary key(cycle_id,qm_result_id)');
  end if;

  if to_regclass('public.responses') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'responses' and column_name = 'question_id') then
    v_missing_cols := array_append(v_missing_cols, 'responses.question_id');
  end if;

  -- The natural-key uniqueness that prevents whole-sitting collisions.
  if not exists (select 1 from pg_constraint
                 where conname = 'responses_cycle_id_qm_result_id_question_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:unique(cycle_id,qm_result_id,question_id)');
  end if;
  -- Stale grains must be gone.
  if exists (select 1 from pg_constraint where conname = 'responses_item_id_qm_result_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:stale-unique(item_id,qm_result_id)');
  end if;
  if exists (select 1 from pg_constraint where conname = 'responses_participant_id_item_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:stale-unique(participant_id,item_id)');
  end if;

  -- TOPIC ROLLUPS (0028): keyed on the TopicId, not the display name. Distinct
  -- topics that share a leaf name within a sitting (different TopicId/TopicPath)
  -- must coexist — so the qm_topic_id key must be present and the name key gone.
  if to_regclass('public.topic_rollups') is not null then
    if not exists (select 1 from pg_constraint
                   where conname = 'topic_rollups_cycle_id_qm_result_id_qm_topic_id_key') then
      v_missing_cols := array_append(v_missing_cols, 'topic_rollups:unique(cycle_id,qm_result_id,qm_topic_id)');
    end if;
    if exists (select 1 from pg_constraint
               where conname = 'topic_rollups_cycle_id_qm_result_id_topic_name_key') then
      v_missing_cols := array_append(v_missing_cols, 'topic_rollups:stale-unique(cycle_id,qm_result_id,topic_name)');
    end if;
  end if;

  -- responses → sittings must be a REAL ON DELETE CASCADE (confdeltype 'c').
  if to_regclass('public.responses') is not null and to_regclass('public.sittings') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.responses'::regclass and contype = 'f'
         and confrelid = 'public.sittings'::regclass and confdeltype = 'c') then
    v_missing_cols := array_append(v_missing_cols, 'responses->sittings:on delete cascade');
  end if;

  -- ingest_persist must exist.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  end if;

  -- The delete/clear lifecycle must exist AND RETURN bigint.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'delete_sitting'
                   and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.delete_sitting()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'clear_sitting_data'
                   and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.clear_sitting_data()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'reset_cycle_for_reingest'
                   and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.reset_cycle_for_reingest()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'clear_cycle_ingest'
                   and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'app.clear_cycle_ingest()->bigint');
  end if;

  -- AUTH (0025 — retained): the single primitive must be workspace-aware.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'has_role'
                   and pg_get_functiondef(p.oid) ilike '%cycle_id is null%') then
    v_missing_fns := array_append(v_missing_fns, 'app.has_role(workspace-scope)');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'is_member') then
    v_missing_fns := array_append(v_missing_fns, 'app.is_member');
  end if;

  return jsonb_build_object(
    'ok', (cardinality(v_missing_cols) = 0 and cardinality(v_missing_fns) = 0),
    'migration', '0028',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;
