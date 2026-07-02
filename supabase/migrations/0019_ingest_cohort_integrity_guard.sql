-- ============================================================================
-- 0019 — ingest cohort-integrity guard (result-selection / response-attach, task 17)
--
-- The 15→7 collapse was a response-attach failure: real sitters' answer rows were
-- attributed to a re-resolved identity, leaving the sitter's roster row with NO
-- attached responses (the "all-dots" empty row) so they fell out of every count.
-- The TypeScript ingest boundary already guards this (assertResponsesAttachToRoster
-- / assertParticipantIdentityIntact / resolved-cohort assertCohortResolved), but the
-- LIVE persist is a single SQL function and nothing asserted the invariant DB-side.
--
-- This migration re-creates `public.ingest_persist` (unchanged from 0010 except the
-- appended guard) so a persist whose roster (result_totals) and cells (responses)
-- disagree fails the WHOLE transaction loudly, instead of quietly writing a subject
-- whose sitters render as empty rows. The guard is the DB mirror of the
-- #distinct-input == #distinct-output participants invariant, per assessment:
--
--   every (assessment, participant) on the roster (result_totals) MUST carry at
--   least one attached response row. A roster sitter with zero responses is the
--   dropped-sitter / all-dots signature → raise.
--
-- Scope + safety: result_totals is only written for MCQ-response-bearing subjects
-- (the write path derives its assessments from the cleaned MCQ responses), so a
-- roster sitter always has MCQ cells — the guard cannot false-fire on the current
-- 3-CSV path, and it is a no-op for the legacy single-file path (no result_totals).
-- Verified: 0 orphan (assessment, participant) pairs across all 5 subjects of the
-- 700435 fixture. Idempotent (CREATE OR REPLACE, same signature/grants/semantics);
-- engine parity unaffected (no scoring change). EU region.
-- ============================================================================
begin;

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

  -- clear-before-insert: re-uploading replaces cleanly; a failure below rolls
  -- the whole function back (no partial rows).
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

  insert into responses (cycle_id, participant_id, item_id, answer_given,
                         answer_score, response_time, result_status, question_type, question_status)
  select cycle_id, participant_id, item_id, answer_given,
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

  -- ── cohort-integrity guard (task 17): roster ↔ responses must agree ────────
  -- Every sitter on the roster (result_totals) must carry ≥1 attached response.
  -- A roster (assessment, participant) with no response row is the dropped-sitter
  -- / all-dots collapse — fail the whole transaction so it can never persist.
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

  -- audit (actor explicit — service role has no auth.uid()).
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

commit;
