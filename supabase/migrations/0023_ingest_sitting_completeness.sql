-- ============================================================================
-- 0023 — whole-sitting completeness guard at persist (task 19)
-- ============================================================================
-- 0021/0022 keyed `responses` and `result_totals` at the SITTING grain
-- (qm_result_id) and added a roster↔responses guard. That guard compares the two
-- tables at the (assessment_id, participant_id) grain — so it catches a sitter on
-- the roster with no attached responses, but it CANNOT see a whole sitting that is
-- absent from BOTH tables (the "silent whole-sitting drop": a roster sitting whose
-- Items rows failed to attach — e.g. a ResultId representation skew between the
-- Items and Assessments exports — persists zero rows and simply vanishes; the
-- per-subject count reads low with no error).
--
-- The primary fix for that skew lives in the app ingest (`normalizeResultId`
-- canonicalises the ResultId join key so the sittings no longer orphan) plus an
-- app-side boundary guard (`assertAllGradedSittingsPersisted`). This migration is
-- the DB-side defence-in-depth: it strengthens `ingest_persist`'s guard to the
-- SITTING grain so a sitting present in one of responses / result_totals but not
-- the other fails LOUDLY inside the persist transaction (which rolls back whole),
-- instead of shipping a silently-short cohort.
--
-- What it changes:
--   1. Re-affirms `public.ingest_persist(uuid, jsonb, uuid)` IDENTICALLY to 0022
--      (clear-then-insert at the sitting grain), with ONE addition: after the
--      existing (assessment, participant) roster guard it also asserts a
--      bidirectional SITTING-grain agreement between result_totals and responses.
--   2. Bumps `public.schema_health()` to report migration '0023' (all 0022 probes
--      retained — no column or constraint changed, so the drift surface is the same).
--
-- No table / column / constraint changes. Idempotent (create or replace). Safe to
-- run after 0022 in the Supabase SQL editor (EU). Rollback restores the 0022 body.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. ingest_persist — 0022 body + a SITTING-grain roster↔responses guard.
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

  -- responses carry qm_result_id (the sitting key) — one record per sitting ×
  -- question, never merged across a participant's subjects (migration 0021).
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
  -- (unchanged from 0022) — (assessment, participant) grain: every roster sitter
  -- must carry ≥1 attached response.
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

  -- ── NEW (0023): SITTING-grain completeness guard ───────────────────────────
  -- Every graded sitting (distinct qm_result_id) must be present on BOTH sides:
  -- a sittings-parent record (result_totals) whose sitting has no attached
  -- responses, OR responses for a sitting with no parent record, is a whole-
  -- sitting drop the (assessment, participant) guard above cannot see (it collapses
  -- a participant's separate sittings). Compared symmetrically so either direction
  -- fails loudly. The transaction rolls back whole, so a short cohort is never
  -- persisted silently.
  with rt as (
    select distinct qm_result_id from result_totals
    where cycle_id = p_cycle and qm_result_id is not null and qm_result_id <> ''
  ), rr as (
    select distinct qm_result_id from responses
    where cycle_id = p_cycle and qm_result_id is not null and qm_result_id <> ''
  ), gap as (
    -- a parent sitting with no responses …
    select qm_result_id, 'result_totals without responses' as side from rt
    where qm_result_id not in (select qm_result_id from rr)
    union all
    -- … or responses for a sitting with no parent record.
    select qm_result_id, 'responses without result_totals' as side from rr
    where qm_result_id not in (select qm_result_id from rt)
  )
  select count(*), string_agg(qm_result_id || ' (' || side || ')', ', ')
    into v_sitting_gap, v_sitting_detail
  from gap;

  if v_sitting_gap > 0 then
    raise exception
      'ingest_persist: % sitting(s) are not present at the sitting grain in both responses and result_totals (whole-sitting drop): %',
      v_sitting_gap, v_sitting_detail;
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
-- 2. schema_health — same probes as 0022, reporting migration '0023'.
--    No column / constraint changed; the drift surface is identical. The version
--    bump lets the app confirm the sitting-completeness guard is deployed.
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

  if to_regclass('public.responses') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'responses' and column_name = 'qm_result_id') then
    v_missing_cols := array_append(v_missing_cols, 'responses.qm_result_id');
  end if;

  -- The grain must actually be swapped to the sitting key.
  if not exists (select 1 from pg_constraint where conname = 'responses_item_id_qm_result_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:unique(item_id,qm_result_id)');
  end if;
  if exists (select 1 from pg_constraint where conname = 'responses_participant_id_item_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:stale-unique(participant_id,item_id)');
  end if;

  -- ingest_persist must exist (its grain is locked by the constraint check above).
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  end if;

  -- The delete/clear lifecycle must exist AND RETURN bigint (a void body is the
  -- silent no-op). A missing-or-void function is reported as drift either way.
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

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration). Expect ok=true, migration '0023', empty arrays.
--   select public.schema_health();
--
-- Sitting completeness (should hold for a healthy cycle — 0 rows):
--   with rt as (select distinct qm_result_id from result_totals where cycle_id = '<CYCLE_UUID>'),
--        rr as (select distinct qm_result_id from responses     where cycle_id = '<CYCLE_UUID>')
--   select 'parent_no_responses' as gap, qm_result_id from rt except select 'parent_no_responses', qm_result_id from rt r where exists (select 1 from rr where rr.qm_result_id = r.qm_result_id)
--   union all
--   select 'responses_no_parent', qm_result_id from rr except select 'responses_no_parent', qm_result_id from rr r where exists (select 1 from rt where rt.qm_result_id = r.qm_result_id);
-- ----------------------------------------------------------------------------
