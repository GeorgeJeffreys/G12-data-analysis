-- ============================================================================
-- G12++ — RESPONSES SITTING-QUALIFIED PERSIST: make a whole-sitting collapse
-- impossible, and make a drifted persist detectable.
-- Migration 0029_responses_sitting_qualified_persist.sql
--
-- WHY THIS EXISTS (the intermittent 15→6 score-matrix collapse)
--   On a fresh cycle, `sittings` held the correct per-subject roster (Applicable
--   Math 15) but `responses` yielded only 6 distinct sittings for Math — 9 whole
--   sittings had ZERO response rows. It was intermittent (another cycle came out at
--   15) — the signature of an order-dependent key collision on WRITE, not a filter.
--
--   Root cause: a DRIFTED deployment was still running a pre-0026 `ingest_persist`
--   whose `responses` write was NOT sitting-qualified end-to-end and had NO
--   whole-sitting completeness guard, so distinct sittings collapsed on insert and
--   the drop was SILENT. The natural-key rebuild (0026) already keys `responses`
--   on the sitting-qualified UNIQUE (cycle_id, qm_result_id, question_id) and raises
--   loudly if any sitting is missing on either side — but a DB that never fully
--   applied 0026's function body kept collapsing. `schema_health()` only checked the
--   grain COLUMNS/CONSTRAINTS, not that the live `ingest_persist` actually carries
--   the guard, so the drift passed as ok=true.
--
-- WHAT THIS DOES (idempotent — safe on a current DB AND safe on a drifted one)
--   1. Re-affirms the sitting-qualified `responses` grain: `question_id` +
--      `participant_email` present; UNIQUE (cycle_id, qm_result_id, question_id);
--      the stale non-sitting-qualified keys (item_id, qm_result_id) and
--      (participant_id, item_id) dropped; FK (cycle_id, qm_result_id) → sittings
--      ON DELETE CASCADE re-affirmed.
--   2. Re-affirms `public.ingest_persist` at that grain — clear-then-write, a PLAIN
--      insert (no ON CONFLICT that could drop a distinct sitting), the roster↔
--      responses guard, and the WHOLE-SITTING completeness guard that raises if any
--      sitting is absent from either side. No silent drops.
--   3. Hardens `schema_health()`: adds a probe that the LIVE `ingest_persist` body
--      actually contains the whole-sitting guard (not just that a function of that
--      name exists) — so a drifted, guard-less persist is flagged, not passed.
--      Reports migration '0029'. Retains every 0026/0028 probe.
--
-- SCOPE / SAFETY
--   Function DROP-then-CREATE + constraint re-affirmation only — no data drop, no
--   row mutation. Does NOT touch `sittings` (correct), the scoring engine (183/183),
--   or the C1 auth model. Forward-only; reversible via
--   0029_responses_sitting_qualified_persist.rollback.sql. Run AFTER 0001–0028 in
--   the Supabase SQL editor (EU). Then re-ingest — the collapse cannot recur (it
--   either persists every sitting or raises).
-- ============================================================================

begin;

set local lock_timeout = '30s';

-- ----------------------------------------------------------------------------
-- 1. Re-affirm the sitting-qualified responses grain (idempotent). Columns are
--    ADD IF NOT EXISTS (safe); a re-ingest repopulates every row.
-- ----------------------------------------------------------------------------
alter table responses add column if not exists question_id       text;
alter table responses add column if not exists participant_email text;

-- Drop the stale, NON-sitting-qualified uniqueness that let distinct sittings
-- collapse on insert.
alter table responses drop constraint if exists responses_item_id_qm_result_id_key;
alter table responses drop constraint if exists responses_participant_id_item_id_key;

-- Ensure the sitting-qualified natural key. One row per sitting × question — a
-- genuine duplicate raises (never silently overwrites a different sitting).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'responses_cycle_id_qm_result_id_question_id_key'
  ) then
    alter table responses
      add constraint responses_cycle_id_qm_result_id_question_id_key
      unique (cycle_id, qm_result_id, question_id);
  end if;
end $$;

-- Re-affirm the real delete cascade responses → sittings (only if sittings exists).
do $$
begin
  if to_regclass('public.sittings') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.responses'::regclass and contype = 'f'
         and confrelid = 'public.sittings'::regclass and confdeltype = 'c') then
    alter table responses
      add constraint responses_cycle_id_qm_result_id_fkey
      foreign key (cycle_id, qm_result_id)
      references sittings (cycle_id, qm_result_id) on delete cascade;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Re-affirm ingest_persist at the sitting-qualified grain, WITH the guards.
--    Sittings insert BEFORE responses (FK order). The responses insert is a PLAIN
--    insert on (cycle_id, qm_result_id, question_id) — no ON CONFLICT path may drop
--    a distinct sitting's rows. The whole-sitting completeness guard raises if any
--    sitting is missing from either side (the collapse becomes a loud failure).
-- ----------------------------------------------------------------------------
create or replace function public.ingest_persist(
  p_cycle uuid, p_payload jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_counts jsonb;
  v_dropped int;
  v_detail  text;
  v_sitting_gap int;
  v_sitting_detail text;
begin
  if p_actor is null then
    raise exception 'ingest_persist requires an explicit actor (the service role has no auth.uid())';
  end if;

  -- Clear-then-write: never upsert-merge onto stale rows.
  perform app.clear_cycle_ingest(p_cycle);

  insert into assessments (id, cycle_id, name, item_count, qm_max_score, sitting)
  select id, cycle_id, name, item_count, qm_max_score, sitting
  from jsonb_populate_recordset(null::assessments, p_payload->'assessments');

  insert into items (id, cycle_id, assessment_id, qm_question_id, wording,
                     major_element, sub_element, demand_level, item_set, max_score,
                     question_type, question_status, topic_name, topic_path)
  select id, cycle_id, assessment_id, qm_question_id, wording,
         major_element, sub_element, demand_level, item_set, max_score,
         question_type, question_status, topic_name, topic_path
  from jsonb_populate_recordset(null::items, p_payload->'items');

  insert into participants (id, cycle_id, qm_participant_id, pseudonym_id,
                            full_name, first_name, last_name, email, dob, gender, group_name)
  select id, cycle_id, qm_participant_id, pseudonym_id,
         full_name, first_name, last_name, email, dob, gender, group_name
  from jsonb_populate_recordset(null::participants, p_payload->'participants');

  -- The sitting spine FIRST (responses/topic_rollups FK to it).
  insert into sittings (cycle_id, qm_result_id, participant_email, participant_id,
                        assessment_id, subject_name, result_status, attempt_number,
                        total_score, maximum_score, percentage_score, scoreband,
                        sitting, reconciled)
  select cycle_id, qm_result_id, participant_email, participant_id,
         assessment_id, subject_name, result_status, attempt_number,
         total_score, maximum_score, percentage_score, scoreband,
         sitting, reconciled
  from jsonb_populate_recordset(null::sittings, p_payload->'sittings');

  -- responses — one row per sitting × question. PLAIN insert on the sitting-qualified
  -- natural key (cycle_id, qm_result_id, question_id): a genuine duplicate raises;
  -- NO ON CONFLICT collapses a distinct sitting.
  insert into responses (cycle_id, qm_result_id, question_id, participant_email,
                         participant_id, item_id, assessment_id, answer_given,
                         answer_score, response_time, result_status,
                         question_type, question_status)
  select cycle_id, qm_result_id, question_id, participant_email,
         participant_id, item_id, assessment_id, answer_given,
         answer_score, response_time, result_status,
         question_type, question_status
  from jsonb_populate_recordset(null::responses, p_payload->'responses');

  insert into topic_rollups (cycle_id, qm_result_id, assessment_id, participant_id,
                             qm_topic_id, topic_name, topic_path, score,
                             maximum_score, percentage_score, question_count)
  select cycle_id, qm_result_id, assessment_id, participant_id,
         qm_topic_id, topic_name, topic_path, score,
         maximum_score, percentage_score, question_count
  from jsonb_populate_recordset(null::topic_rollups, p_payload->'topic_rollups');

  insert into import_batches (cycle_id, file_ref, file_size_mb, parsed_rows, validation_passed,
                              report_json, items_file, assessments_file, topics_file,
                              results_total, results_reconciled, created_by)
  select p_cycle, b.file_ref, b.file_size_mb, b.parsed_rows, b.validation_passed,
         b.report_json, b.items_file, b.assessments_file, b.topics_file,
         b.results_total, b.results_reconciled, p_actor
  from jsonb_populate_record(null::import_batches, p_payload->'import_batch') b;

  -- ── roster ↔ responses guard: every sitting must carry ≥1 attached response ──
  with roster as (
    select distinct assessment_id, participant_id
    from sittings where cycle_id = p_cycle
  ), attached as (
    select distinct i.assessment_id, r.participant_id
    from responses r join items i on i.id = r.item_id
    where r.cycle_id = p_cycle
  ), dropped as (
    select r.assessment_id, r.participant_id from roster r
    except
    select a.assessment_id, a.participant_id from attached a
  )
  select count(*),
         string_agg(assessment_id::text || '/' || participant_id::text, ', ')
    into v_dropped, v_detail
  from dropped;

  if v_dropped > 0 then
    raise exception
      'ingest_persist: % roster sitter(s) have no attached responses (dropped-sitter / all-dots response-attach collapse): %',
      v_dropped, v_detail;
  end if;

  -- ── whole-sitting completeness guard: every sitting present on BOTH sides ────
  -- This is what turns a silent whole-sitting drop into a loud failure: if any
  -- sitting exists in `sittings` but has zero rows in `responses` (or vice versa),
  -- the ingest ABORTS instead of persisting a collapsed matrix.
  with rt as (
    select distinct qm_result_id from sittings
    where cycle_id = p_cycle and qm_result_id is not null and qm_result_id <> ''
  ), rr as (
    select distinct qm_result_id from responses
    where cycle_id = p_cycle and qm_result_id is not null and qm_result_id <> ''
  ), gap as (
    select qm_result_id, 'sitting without responses' as side from rt
    where qm_result_id not in (select qm_result_id from rr)
    union all
    select qm_result_id, 'responses without sitting' as side from rr
    where qm_result_id not in (select qm_result_id from rt)
  )
  select count(*), string_agg(qm_result_id || ' (' || side || ')', ', ')
    into v_sitting_gap, v_sitting_detail
  from gap;

  if v_sitting_gap > 0 then
    raise exception
      'ingest_persist: % sitting(s) are not present at the sitting grain in both responses and sittings (whole-sitting drop): %',
      v_sitting_gap, v_sitting_detail;
  end if;

  insert into audit_log (cycle_id, actor_id, action, entity, entity_id, before, after)
  values (p_cycle, p_actor, 'ingest', 'exam_cycle', p_cycle::text, null,
          jsonb_build_object(
            'assessments', coalesce(jsonb_array_length(p_payload->'assessments'), 0),
            'items',       coalesce(jsonb_array_length(p_payload->'items'), 0),
            'participants',coalesce(jsonb_array_length(p_payload->'participants'), 0),
            'sittings',    coalesce(jsonb_array_length(p_payload->'sittings'), 0),
            'responses',   coalesce(jsonb_array_length(p_payload->'responses'), 0)));

  v_counts := jsonb_build_object(
    'assessments', coalesce(jsonb_array_length(p_payload->'assessments'), 0),
    'items',       coalesce(jsonb_array_length(p_payload->'items'), 0),
    'participants',coalesce(jsonb_array_length(p_payload->'participants'), 0),
    'sittings',    coalesce(jsonb_array_length(p_payload->'sittings'), 0),
    'responses',   coalesce(jsonb_array_length(p_payload->'responses'), 0),
    'topic_rollups', coalesce(jsonb_array_length(p_payload->'topic_rollups'), 0));
  return v_counts;
end $$;

revoke all on function public.ingest_persist(uuid, jsonb, uuid) from public;
grant execute on function public.ingest_persist(uuid, jsonb, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 3. schema_health — every 0026/0028 probe retained, PLUS a probe that the LIVE
--    ingest_persist body carries the whole-sitting completeness guard (so a
--    drifted, guard-less persist that silently collapses sittings is flagged).
--    Reports migration '0029'.
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

  -- ingest_persist must exist AND carry the whole-sitting completeness guard (not
  -- just exist by name) — a drifted, guard-less persist silently collapses sittings.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  elsif not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'ingest_persist'
                      and pg_get_functiondef(p.oid) ilike '%whole-sitting drop%'
                      and pg_get_functiondef(p.oid) ilike '%question_id%') then
    v_missing_fns := array_append(v_missing_fns, 'ingest_persist:whole-sitting guard + sitting-qualified responses');
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
    'migration', '0029',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration). Expect ok=true, migration '0029', empty arrays.
--   select public.schema_health();
--
-- Then re-ingest the 700435 CSVs into a fresh cycle and confirm responses distinct
-- sittings == sittings, per subject (Math 15 / English 12 / Scientific 12 /
-- Arabic 9 / Life 11) — the collapse cannot recur (the persist raises otherwise):
--   select a.name,
--          count(distinct s.qm_result_id)                                    as sittings,
--          count(distinct r.qm_result_id) filter (where r.qm_result_id is not null) as responses
--     from assessments a
--     left join sittings  s on s.assessment_id = a.id
--     left join responses r on r.assessment_id = a.id
--    where a.cycle_id = '<CYCLE_UUID>'
--    group by a.name;   -- sittings == responses for every subject
-- ----------------------------------------------------------------------------
