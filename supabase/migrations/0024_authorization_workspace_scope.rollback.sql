-- ============================================================================
-- Rollback of 0024_authorization_workspace_scope.sql
--
-- Restores the PRIOR (0023) drift-probe surface and the plain member-scoped
-- `memberships_select` policy. It deliberately KEEPS the global-aware
-- `app.is_member` / `app.has_role` bodies (0002) — reverting those to the strict
-- 0001 form is the very bug 0024 fixes, so a rollback must never re-introduce it.
-- No table/column/constraint/DATA change; engine untouched (parity 183/183).
-- ============================================================================

begin;

-- Lock memberships first (reader lock order: table → helper functions) so the
-- function replacements + policy swap below can't deadlock against live traffic.
set local lock_timeout = '10s';
lock table memberships in access exclusive mode;

-- Keep the global-aware helpers (re-affirm 0002 — a no-op if already correct).
create or replace function app.is_member(p_cycle uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where (m.cycle_id is null or m.cycle_id = p_cycle)
      and m.user_id = auth.uid()
  );
$$;

create or replace function app.has_role(p_cycle uuid, p_roles member_role[])
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where (m.cycle_id is null or m.cycle_id = p_cycle)
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;

-- Restore the plain member-scoped select policy (0001 shape).
drop policy if exists memberships_select on memberships;
create policy memberships_select on memberships for select
  using (app.is_member(cycle_id));

-- Restore the 0023 probe surface (drops the 0024 authorization probes; reports '0023').
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

  return jsonb_build_object(
    'ok', (cardinality(v_missing_cols) = 0 and cardinality(v_missing_fns) = 0),
    'migration', '0023',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;
