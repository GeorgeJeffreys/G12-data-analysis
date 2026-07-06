-- ============================================================================
-- G12++ — CYCLE LIFECYCLE: carry the sitting DATE through create, and add a real
-- DELETE CYCLE that removes the cycle row and EVERY row keyed to its cycle_id.
-- Migration 0031_cycle_lifecycle_date_delete.sql
--
-- WHY THIS EXISTS (task 23 — one canonical id, and the lifecycle around it)
--   1. The "Sitting date" field was collected in the UI and then SILENTLY DROPPED:
--      create_cycle_with_assessments (0010) had no date parameter, so the chosen
--      date never reached the database and editing it had no effect. This adds an
--      `exam_cycles.sitting_date date` column and a `p_sitting_date` parameter so
--      the date is persisted with the sitting.
--   2. There was no way to DELETE a cycle. `delete_sitting` (0020) already removes
--      a cycle row and cascades every child (it counts via app.cycle_row_count then
--      `delete from exam_cycles`, which cascades all cycle_id-keyed rows). This adds
--      `delete_cycle` as the cycle-level danger action: it REUSES that exact cascade
--      + row-count, is admin-gated via the C1 `app.has_role` primitive, is
--      audit-logged at the workspace level (so the record survives the cascade),
--      touches NO other cycle, and GUARDS against deleting the last remaining cycle
--      (which would leave the workspace with nothing to open).
--
-- WHAT THIS DOES (idempotent — safe on a current DB and on a drifted one)
--   1. `alter table exam_cycles add column if not exists sitting_date date`.
--   2. Re-creates `create_cycle_with_assessments(...)` with a trailing
--      `p_sitting_date date default null` parameter, persisting it on insert. The
--      previous 6-arg signature is dropped first (a default-arg overload would make
--      the name ambiguous to PostgREST). Body otherwise identical to 0010.
--   3. Adds `public.delete_cycle(uuid) returns bigint` — the cycle-level cascade
--      delete with the last-cycle guard, admin-gated and audited.
--   4. Bumps `schema_health()` to report '0031' and to probe the new column +
--      function, retaining every 0025/0026/0028/0029/0030 probe.
--
-- SCOPE / SAFETY
--   Adds one nullable column (never dropped) and replaces two functions. No row
--   mutation; the only deletes are inside delete_cycle, called explicitly by an
--   admin. Does NOT touch the scoring engine (parity-locked) or the C1 auth model —
--   it REUSES app.has_role / app.cycle_row_count / app.audit. Run AFTER 0001–0030
--   in the Supabase SQL editor (EU). Reversible via
--   0031_cycle_lifecycle_date_delete.rollback.sql.
-- ============================================================================

begin;

set local lock_timeout = '30s';

-- ----------------------------------------------------------------------------
-- 1. The sitting date column. Nullable; only ever added.
-- ----------------------------------------------------------------------------
alter table exam_cycles add column if not exists sitting_date date;

-- ----------------------------------------------------------------------------
-- 2. create_cycle_with_assessments — add p_sitting_date and persist it. Drop the
--    prior 6-arg signature so the 7-arg one is unambiguous. Body mirrors 0010.
-- ----------------------------------------------------------------------------
drop function if exists public.create_cycle_with_assessments(text, text, jsonb, uuid, sitting_period, uuid);

create or replace function public.create_cycle_with_assessments(
  p_name text,
  p_region text default 'eu-west',
  p_assessments jsonb default '[]'::jsonb,
  p_year_id uuid default null,
  p_sitting sitting_period default 'may',
  p_test_centre_id uuid default null,
  p_sitting_date date default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  c           exam_cycles;
  rec         jsonb;
  v_name      text;
  v_year_id   uuid := p_year_id;
  v_year_name text;
  v_centre    uuid;
begin
  -- Resolve the year and its centre (see 0010: v_centre must ALWAYS be the year's
  -- REAL centre for the audit payload).
  if v_year_id is null then
    v_centre := coalesce(p_test_centre_id, app.default_test_centre());
    v_year_name := coalesce(substring(p_name from '(?:19|20)\d{2}'),
                            to_char(now(), 'YYYY'));
    select id into v_year_id from exam_years
      where name = v_year_name and region = p_region and test_centre_id = v_centre;
    if v_year_id is null then
      insert into exam_years (name, region, test_centre_id, created_by)
      values (v_year_name, p_region, v_centre, auth.uid())
      returning id into v_year_id;
    end if;
  else
    select test_centre_id into v_centre from exam_years where id = v_year_id;
    if not found then
      raise exception 'exam year % not found', v_year_id;
    end if;
    if p_test_centre_id is not null and p_test_centre_id <> v_centre then
      raise exception 'test_centre_id % conflicts with year %''s centre %',
        p_test_centre_id, v_year_id, v_centre;
    end if;
  end if;

  insert into exam_cycles (name, region, created_by, year_id, sitting, sitting_date)
  values (p_name, p_region, auth.uid(), v_year_id, p_sitting, p_sitting_date)
  returning * into c;

  insert into memberships (cycle_id, user_id, role)
  values (c.id, auth.uid(), 'lead_admin');

  for rec in select * from jsonb_array_elements(coalesce(p_assessments, '[]'::jsonb)) loop
    v_name := coalesce(trim(rec->>'name'), '');
    if v_name <> '' then
      insert into assessments (cycle_id, name, item_count)
      values (c.id, v_name, coalesce((rec->>'item_count')::int, 0));
    end if;
  end loop;

  perform app.audit(c.id, 'create', 'exam_cycle', c.id::text, null,
                    jsonb_build_object('cycle', to_jsonb(c),
                                       'assessments', coalesce(p_assessments, '[]'::jsonb),
                                       'test_centre_id', v_centre,
                                       'sitting_date', p_sitting_date));
  return c.id;
end $$;

revoke all on function
  public.create_cycle_with_assessments(text, text, jsonb, uuid, sitting_period, uuid, date) from public;
grant execute on function
  public.create_cycle_with_assessments(text, text, jsonb, uuid, sitting_period, uuid, date)
to authenticated;

-- ----------------------------------------------------------------------------
-- 3. delete_cycle — remove the cycle row and EVERY row keyed to its cycle_id.
--    Reuses the delete_sitting cascade (count via app.cycle_row_count, then
--    `delete from exam_cycles` which cascades all children). Admin-gated via the
--    C1 primitive; audited at the workspace level BEFORE the cascade; touches no
--    other cycle; refuses to delete the last remaining cycle.
-- ----------------------------------------------------------------------------
create or replace function public.delete_cycle(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  c exam_cycles;
  v_total bigint;
  v_remaining int;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;

  select * into c from exam_cycles where id = p_cycle;
  if not found then return 0; end if;

  -- Guard: never delete the LAST remaining cycle — the workspace would have nothing
  -- to open. (Counts cycles OTHER than the target.)
  select count(*) into v_remaining from exam_cycles where id <> p_cycle;
  if v_remaining = 0 then
    raise exception 'cannot delete the last remaining cycle (the workspace would be left with no cycles)';
  end if;

  -- Exhaustive pre-count across every cycle_id-keyed table (proves no orphans).
  v_total := app.cycle_row_count(p_cycle);

  -- Audit at the workspace level (cycle_id NULL) so the cascade cannot sweep it.
  perform app.audit(null, 'delete', 'exam_cycle', p_cycle::text, to_jsonb(c),
                    jsonb_build_object('rows_deleted', v_total, 'action', 'delete_cycle'));

  delete from exam_cycles where id = p_cycle;   -- cascades every child counted above
  return v_total;
end $$;

revoke all on function public.delete_cycle(uuid) from public;
grant execute on function public.delete_cycle(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. schema_health — every 0030 probe retained, PLUS probes for the new sitting
--    date column and delete_cycle function. Reports '0031'.
-- ----------------------------------------------------------------------------
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

  -- 0031 — the sitting date column persisted by create_cycle_with_assessments.
  if to_regclass('public.exam_cycles') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'exam_cycles' and column_name = 'sitting_date') then
    v_missing_cols := array_append(v_missing_cols, 'exam_cycles.sitting_date');
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

  -- The sitting-qualified natural-key uniqueness that prevents whole-sitting collisions.
  if not exists (select 1 from pg_constraint
                 where conname = 'responses_cycle_id_qm_result_id_question_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:unique(cycle_id,qm_result_id,question_id)');
  end if;
  -- Stale, NON-sitting-qualified grains must be gone.
  if exists (select 1 from pg_constraint where conname = 'responses_item_id_qm_result_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:stale-unique(item_id,qm_result_id)');
  end if;
  if exists (select 1 from pg_constraint where conname = 'responses_participant_id_item_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:stale-unique(participant_id,item_id)');
  end if;

  -- TOPIC ROLLUPS (0028): keyed on the TopicId, not the display name.
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

  -- ingest_persist must exist AND carry BOTH the whole-sitting guard (0029) and the
  -- per-subject sitting-count guard (0030) — not just exist by name.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  else
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'ingest_persist'
                     and pg_get_functiondef(p.oid) ilike '%whole-sitting drop%'
                     and pg_get_functiondef(p.oid) ilike '%question_id%') then
      v_missing_fns := array_append(v_missing_fns, 'ingest_persist:whole-sitting guard + sitting-qualified responses');
    end if;
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'ingest_persist'
                     and pg_get_functiondef(p.oid) ilike '%per-subject whole-sitting collapse%') then
      v_missing_fns := array_append(v_missing_fns, 'ingest_persist:per-subject sitting-count guard');
    end if;
  end if;

  -- The delete/clear lifecycle must exist AND RETURN bigint.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'delete_sitting'
                   and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.delete_sitting()->bigint');
  end if;
  -- 0031 — the cycle-level cascade delete.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'delete_cycle'
                   and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.delete_cycle()->bigint');
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
    'migration', '0031',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration). Expect ok=true, migration '0031', empty arrays.
--   select public.schema_health();
--
-- Create a sitting with a date and confirm it persisted:
--   select id, name, sitting_date from exam_cycles order by created_at desc limit 1;
--
-- Dry-run a cycle delete count WITHOUT deleting:
--   select app.cycle_row_count('<CYCLE_UUID>');
-- Then delete it (admin session) and confirm zero rows remain for that cycle_id in
-- every table, and other cycles are untouched:
--   select public.delete_cycle('<CYCLE_UUID>');
-- ----------------------------------------------------------------------------
