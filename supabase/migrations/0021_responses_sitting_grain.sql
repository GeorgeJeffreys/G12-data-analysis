-- ============================================================================
-- G12++ — RESPONSES AT SITTING GRAIN: key the immutable facts on the sitting, not
-- the participant. Migration 0021_responses_sitting_grain.sql
--
-- WHY THIS EXISTS (root cause of the ~7-per-subject collapse)
--   `responses` was uniquely keyed on (participant_id, item_id) — a PARTICIPANT ×
--   question grain. A participant sits one RESULT (QM ResultId) per subject, so the
--   participant-grain key silently merged a participant's separate subject-sittings
--   into one identity space: the cleaned export minted one synthetic id per
--   participant email and lost the sitting (ResultId) key entirely. Each sitting is
--   a (participant × subject) event and MUST be its own record.
--
--   Fix: carry the QM `ResultId` on every response as `qm_result_id` (the sitting
--   key), and move the uniqueness to the SITTING × question grain
--   (item_id, qm_result_id). Since items are already subject-scoped, this preserves
--   every real sitting as its own record and never folds a participant's subjects
--   together. Participant identity stays a SEPARATE column (participant_id → the
--   email-keyed participants row) used only for cross-subject grouping.
--
-- WHAT THIS DOES (idempotent — safe on an out-of-date DB AND safe to re-run)
--   1. Adds `responses.qm_result_id text` (the QM ResultId / sitting key).
--   2. Swaps the uniqueness: drop (participant_id, item_id), add
--      (item_id, qm_result_id). Existing rows (pre-0021) carry a null
--      qm_result_id until the next re-ingest repopulates them; the app clears +
--      re-inserts the whole cycle on every upload, so a fresh ingest is exact.
--   3. Re-affirms `public.ingest_persist(...)` so the responses INSERT carries
--      `qm_result_id` (the column list must name it; `jsonb_populate_recordset`
--      alone won't route a column the INSERT omits).
--   4. Extends `public.schema_health()` to probe `responses.qm_result_id` and to
--      report migration '0021', so the app can flag a lagging DB itself.
--
-- SAFETY: no destructive DROP of user DATA. Only a nullable column ADD and a
-- constraint swap. The engine + grade-bearing tables are untouched — parity
-- 183/183 unaffected (this is ingest/identity/persistence only).
--
-- The human runs this in the Supabase SQL editor (EU) AFTER 0001–0020. Reversible
-- via 0021_responses_sitting_grain.rollback.sql.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. The sitting key on the immutable facts. Nullable so the ADD is safe on a
--    populated DB; a re-ingest (clear-then-insert) repopulates every row.
-- ----------------------------------------------------------------------------
alter table responses add column if not exists qm_result_id text;

-- ----------------------------------------------------------------------------
-- 2. Move uniqueness from participant × question → sitting × question. The old
--    constraint's auto-generated name is dropped IF EXISTS; the new one is added
--    only when absent (guarded, so re-running is a no-op).
-- ----------------------------------------------------------------------------
alter table responses drop constraint if exists responses_participant_id_item_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'responses_item_id_qm_result_id_key'
  ) then
    alter table responses
      add constraint responses_item_id_qm_result_id_key unique (item_id, qm_result_id);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Re-affirm `ingest_persist` so the responses INSERT carries `qm_result_id`.
--    Identical to 0020 except the responses insert names + selects qm_result_id
--    (so the sitting key actually persists). CREATE OR REPLACE keeps the same
--    signature / grants / SECURITY DEFINER semantics.
-- ----------------------------------------------------------------------------
create or replace function public.ingest_persist(
  p_cycle uuid, p_payload jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_counts jsonb;
  v_dropped int;
  v_detail  text;
begin
  if p_actor is null then
    raise exception 'ingest_persist requires an explicit actor (the service role has no auth.uid())';
  end if;

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

  -- responses now carry qm_result_id (the sitting key) — one record per sitting ×
  -- question, never merged across a participant's subjects.
  insert into responses (cycle_id, participant_id, item_id, qm_result_id, answer_given,
                         answer_score, response_time, result_status, question_type, question_status)
  select cycle_id, participant_id, item_id, qm_result_id, answer_given,
         answer_score, response_time, result_status, question_type, question_status
  from jsonb_populate_recordset(null::responses, p_payload->'responses');

  insert into result_totals (cycle_id, assessment_id, participant_id, qm_result_id,
                             total_score, maximum_score, percentage_score, scoreband,
                             result_status, attempt_number, sitting, reconciled)
  select cycle_id, assessment_id, participant_id, qm_result_id,
         total_score, maximum_score, percentage_score, scoreband,
         result_status, attempt_number, sitting, reconciled
  from jsonb_populate_recordset(null::result_totals, p_payload->'result_totals');

  insert into topic_rollups (cycle_id, assessment_id, participant_id, qm_result_id,
                             qm_topic_id, topic_name, topic_path, score,
                             maximum_score, percentage_score, question_count)
  select cycle_id, assessment_id, participant_id, qm_result_id,
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

  -- ── cohort-integrity guard: roster ↔ responses must agree ──────────────────
  with roster as (
    select distinct assessment_id, participant_id
    from result_totals where cycle_id = p_cycle
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

  insert into audit_log (cycle_id, actor_id, action, entity, entity_id, before, after)
  values (p_cycle, p_actor, 'ingest', 'exam_cycle', p_cycle::text, null,
          jsonb_build_object(
            'assessments', coalesce(jsonb_array_length(p_payload->'assessments'), 0),
            'items',       coalesce(jsonb_array_length(p_payload->'items'), 0),
            'participants',coalesce(jsonb_array_length(p_payload->'participants'), 0),
            'responses',   coalesce(jsonb_array_length(p_payload->'responses'), 0)));

  v_counts := jsonb_build_object(
    'assessments', coalesce(jsonb_array_length(p_payload->'assessments'), 0),
    'items',       coalesce(jsonb_array_length(p_payload->'items'), 0),
    'participants',coalesce(jsonb_array_length(p_payload->'participants'), 0),
    'responses',   coalesce(jsonb_array_length(p_payload->'responses'), 0),
    'result_totals', coalesce(jsonb_array_length(p_payload->'result_totals'), 0),
    'topic_rollups', coalesce(jsonb_array_length(p_payload->'topic_rollups'), 0));
  return v_counts;
end $$;

revoke all on function public.ingest_persist(uuid, jsonb, uuid) from public;
grant execute on function public.ingest_persist(uuid, jsonb, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Extend the drift probe to include `responses.qm_result_id`, and report '0021'.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration). Expect ok=true and empty arrays.
-- ----------------------------------------------------------------------------
-- select public.schema_health();
--
-- After a fresh re-ingest, distinct sitting keys should far exceed participants:
--   select count(distinct qm_result_id) as sittings, count(distinct participant_id) as participants
--     from responses where cycle_id = '<CYCLE_UUID>';
-- and every participant should hold one sitting per real subject they sat:
--   select i.assessment_id, count(distinct r.qm_result_id) as sittings
--     from responses r join items i on i.id = r.item_id
--     where r.cycle_id = '<CYCLE_UUID>' group by i.assessment_id;
