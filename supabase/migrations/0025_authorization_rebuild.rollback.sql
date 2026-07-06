-- ============================================================================
-- ROLLBACK for 0025_authorization_rebuild.sql — restore the 0024 authorization
-- surface (global-aware helpers with standalone bodies, the combined self-read +
-- FOR ALL memberships policies, and the schema_health probe reporting '0024').
--
-- It deliberately KEEPS the helpers workspace-aware (`cycle_id is null or
-- cycle_id = p_cycle`) — rolling back must NEVER re-introduce the strict,
-- cycle-scoped body that stranded a workspace admin. No table/column/data change.
--
-- Two transactions, mirroring the forward migration's deadlock discipline
-- (functions first, memberships policy second).
-- ============================================================================

-- ============================================================================
-- TRANSACTION 1 — restore the standalone 0024 helper bodies + the 0024 probe.
-- ============================================================================
begin;

set local lock_timeout = '15s';

-- has_role: standalone workspace-aware body (0024).
create or replace function app.has_role(p_cycle uuid, p_roles member_role[])
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where (m.cycle_id is null or m.cycle_id = p_cycle)
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;

-- is_member: standalone workspace-aware body (0024) — reads memberships directly
-- again (the forward migration derived it from has_role).
create or replace function app.is_member(p_cycle uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where (m.cycle_id is null or m.cycle_id = p_cycle)
      and m.user_id = auth.uid()
  );
$$;

-- schema_health restored to the 0024 body (reports '0024').
create or replace function public.schema_health()
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_missing_cols text[] := '{}';
  v_missing_fns  text[] := '{}';
begin
  if to_regclass('public.items') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'items' and column_name = 'item_set') then
    v_missing_cols := array_append(v_missing_cols, 'items.item_set');
  end if;

  if to_regclass('public.responses') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'responses' and column_name = 'qm_result_id') then
    v_missing_cols := array_append(v_missing_cols, 'responses.qm_result_id');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'responses_item_id_qm_result_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:unique(item_id,qm_result_id)');
  end if;
  if exists (select 1 from pg_constraint where conname = 'responses_participant_id_item_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:stale-unique(participant_id,item_id)');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'memberships'
      and policyname = 'memberships_select' and coalesce(qual, '') ilike '%auth.uid()%') then
    v_missing_cols := array_append(v_missing_cols, 'memberships:self-read policy');
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  end if;

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

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'is_member'
                   and pg_get_functiondef(p.oid) ilike '%cycle_id is null%') then
    v_missing_fns := array_append(v_missing_fns, 'app.is_member(workspace-scope)');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'has_role'
                   and pg_get_functiondef(p.oid) ilike '%cycle_id is null%') then
    v_missing_fns := array_append(v_missing_fns, 'app.has_role(workspace-scope)');
  end if;

  return jsonb_build_object(
    'ok', (cardinality(v_missing_cols) = 0 and cardinality(v_missing_fns) = 0),
    'migration', '0024',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;

-- ============================================================================
-- TRANSACTION 2 — restore the combined self-read SELECT + FOR ALL write policy.
-- ============================================================================
begin;

set local lock_timeout = '15s';

drop policy if exists memberships_select on memberships;
drop policy if exists memberships_insert on memberships;
drop policy if exists memberships_update on memberships;
drop policy if exists memberships_delete on memberships;
drop policy if exists memberships_all    on memberships;

create policy memberships_select on memberships for select
  using (user_id = auth.uid() or app.is_member(cycle_id));
create policy memberships_all on memberships for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

commit;
