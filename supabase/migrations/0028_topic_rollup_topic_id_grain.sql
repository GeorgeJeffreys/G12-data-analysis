-- ============================================================================
-- G12++ — TOPIC ROLLUP GRAIN FIX: key topic_rollups on the TopicId, not the name.
-- Migration 0028_topic_rollup_topic_id_grain.sql
--
-- WHY THIS EXISTS (the 0026 topic-key regression)
--   0026 rebuilt `topic_rollups` with UNIQUE (cycle_id, qm_result_id, topic_name).
--   That silently REVERSED the fix migration 0007 already shipped: QM's topic tree
--   contains DISTINCT topics — different `TopicId` AND different `TopicPath` — that
--   share a leaf display NAME within a single result. In the 700435 export the
--   English 2nd Language sittings each carry "Evaluating meaning" and "Understanding
--   meaning" under BOTH the Reading-comprehension and Listening-comprehension paths:
--       TopicId 289361  English 2nd Language\Reading comprehension\Evaluating meaning
--       TopicId 289364  English 2nd Language\Listening comprehension\Evaluating meaning
--   Those are two genuinely different curriculum elements, not duplicate rows. The
--   name key can only represent ONE of them, so a fresh ingest of 700435 raised:
--       duplicate key value violates unique constraint
--       "topic_rollups_cycle_id_qm_result_id_topic_name_key"
--   (24 such (result, name) collisions across the 12 English sittings). Aggregating
--   by name would MERGE Reading into Listening and corrupt element analysis — the
--   grain is wrong, not the payload. The correct natural key is the TopicId, exactly
--   as 0007 established; the ingest payload build (lib/server/ingest-write.ts) already
--   emits one row per (result, TopicId). This migration just puts the DB constraint
--   back on the right column.
--
-- WHAT THIS DOES (idempotent; safe on an out-of-date DB and safe to re-run)
--   1. Swaps the `topic_rollups` uniqueness from (cycle_id, qm_result_id, topic_name)
--      to (cycle_id, qm_result_id, qm_topic_id) — one row per sitting × topic (id).
--   2. Re-affirms `public.schema_health()`: keeps every 0026 probe (auth + pipeline
--      spine + delete lifecycle) and ADDS the topic-grain probe (the qm_topic_id key
--      present, the stale name key gone). Reports migration '0028'.
--
-- SCOPE / SAFETY
--   A constraint swap only — no data drop, no row mutation, no touch to the scoring
--   engine, the responses (cycle_id, qm_result_id, question_id) grain, or the C1 auth
--   model. Parity 183/183 unaffected. Forward-only; reversible via
--   0028_topic_rollup_topic_id_grain.rollback.sql. Run AFTER 0001–0027 in the
--   Supabase SQL editor (EU).
-- ============================================================================

begin;

set local lock_timeout = '30s';

-- ----------------------------------------------------------------------------
-- 1. Re-key topic_rollups: drop the name-based uniqueness (the 0026 regression)
--    and constrain on the TopicId natural key. `qm_topic_id` stays nullable (real
--    QM exports always carry it; the payload build folds any id-less rows by name
--    so a genuine duplicate can never reach here). Idempotent.
-- ----------------------------------------------------------------------------
alter table topic_rollups
  drop constraint if exists topic_rollups_cycle_id_qm_result_id_topic_name_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'topic_rollups_cycle_id_qm_result_id_qm_topic_id_key'
  ) then
    alter table topic_rollups
      add constraint topic_rollups_cycle_id_qm_result_id_qm_topic_id_key
      unique (cycle_id, qm_result_id, qm_topic_id);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. schema_health — every 0026 probe retained, PLUS the topic-grain probe.
--    Reports migration '0028'.
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

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration). Expect ok=true, migration '0028', empty arrays.
--   select public.schema_health();
--
-- Then re-ingest the 700435 CSVs into a fresh cycle → NO topic_rollups duplicate-key
-- error, per-subject counts 15 / 11 / 12 / 9 / 10, and each English sitting keeps
-- BOTH the Reading- and Listening-comprehension "Evaluating meaning" topics:
--   select qm_result_id, topic_name, count(*)
--     from topic_rollups where cycle_id = '<CYCLE_UUID>'
--    group by qm_result_id, topic_name having count(*) > 1;   -- distinct TopicIds, kept
--   select cycle_id, qm_result_id, qm_topic_id, count(*)
--     from topic_rollups where cycle_id = '<CYCLE_UUID>'
--    group by 1,2,3 having count(*) > 1;                       -- must be EMPTY (grain holds)
-- ----------------------------------------------------------------------------
