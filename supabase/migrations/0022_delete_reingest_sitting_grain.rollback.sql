-- ============================================================================
-- Rollback for 0022_delete_reingest_sitting_grain.sql
--
-- Reverts the 0022-introduced changes ONLY — restores `public.schema_health()` to
-- its 0021 body (name-only function checks; reports '0021').
--
-- DELIBERATELY NOT reverted:
--   * The re-affirmed `delete_sitting` / `clear_sitting_data` /
--     `reset_cycle_for_reingest` / `app.clear_cycle_ingest` / `app.cycle_row_count`
--     / `ingest_persist` bodies are IDENTICAL to their 0020/0021 definitions —
--     re-affirming a correct definition is not a change to roll back, and reverting
--     them to a void return would re-introduce the silent-no-op delete this
--     migration exists to kill. They are left in place.
--   * The sitting-grain shape (`responses.qm_result_id` + the
--     (item_id, qm_result_id) uniqueness) belongs to 0021 — its own rollback owns
--     it; 0022 only re-affirmed it idempotently. Not touched here.
-- ============================================================================

begin;

-- schema_health → 0021 body (name-only checks; reports '0021').
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

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'delete_sitting') then
    v_missing_fns := array_append(v_missing_fns, 'public.delete_sitting');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'clear_sitting_data') then
    v_missing_fns := array_append(v_missing_fns, 'public.clear_sitting_data');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'clear_cycle_ingest') then
    v_missing_fns := array_append(v_missing_fns, 'app.clear_cycle_ingest');
  end if;

  return jsonb_build_object(
    'ok', (cardinality(v_missing_cols) = 0 and cardinality(v_missing_fns) = 0),
    'migration', '0021',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;
