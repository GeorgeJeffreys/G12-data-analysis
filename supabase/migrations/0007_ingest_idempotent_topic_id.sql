-- ============================================================================
-- G12++ — fix 3-CSV ingest: topic key on ID, idempotent + transactional persist,
--         delete / clear a sitting.
-- Migration 0007_ingest_idempotent_topic_id.sql
--
-- Why this exists
--   Uploading the real Questionmark exports failed on the FIRST upload at:
--     insert topic_rollups: duplicate key value violates unique constraint
--     "topic_rollups_cycle_id_qm_result_id_topic_name_key"
--   Root cause (confirmed against the real Topics export AND the test fixture):
--   QM's topic tree contains distinct topics (different `TopicId`s) that share
--   the same display `TopicName` within ONE result. In the data:
--     * (ResultId, TopicId)   is unique          — the correct natural key
--     * (ResultId, TopicName) has 24 collisions   — e.g. "Evaluating meaning"
--       exists at both TopicId 289364 and 289361 for one result.
--   So 0006's `unique (cycle_id, qm_result_id, topic_name)` was on the wrong
--   column: it must key on the topic's ID. `qm_topic_id` already exists (0006)
--   and the ingest already populates it from `TopicId`; we just re-key onto it.
--
-- What else this does
--   * Makes the persist all-or-nothing AND idempotent via a single SECURITY
--     DEFINER function `public.ingest_persist(...)` that clears the sitting's
--     existing ingested rows and re-inserts the fresh set inside ONE
--     transaction (a plpgsql function body is atomic). Re-uploading a sitting
--     then cleanly REPLACES it; a mid-ingest failure rolls back whole, leaving
--     no partial rows. The web app calls this once with the whole payload (with
--     client-generated row ids so foreign keys are wired without round-trips).
--   * Adds `public.delete_sitting(...)` (remove a sitting + all its data) and
--     `public.clear_sitting_data(...)` (empty a sitting back to the Upload
--     state, keeping the shell) — both confirmed in the UI and audited with the
--     resolved user.
--
-- Name-vs-id sweep (other ingest tables)
--   Every other ingest uniqueness is already on a QM *id*, not a name/label:
--     * items          unique (cycle_id, qm_question_id)        — id  ✓
--     * participants   unique (cycle_id, qm_participant_id)     — id  ✓
--     * responses      unique (participant_id, item_id)         — fk ids ✓
--     * result_totals  unique (cycle_id, qm_result_id)          — id  ✓
--     * assessments    (no uniqueness; deduped by name in app)  — n/a
--   `topic_rollups` was the only offender. Fixed here.
--
-- Environment
--   The human runs this in the Supabase SQL editor AFTER 0001–0006. Do not
--   auto-apply. The companion 0007_…rollback.sql reverts it.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Re-key topic_rollups onto the topic ID (not the name).
--    `qm_topic_id` already exists (0006) and is populated from TopicId. Any
--    pre-existing rows with a NULL id come from the failed/legacy ingest and are
--    unusable for the new key — drop them so the NOT NULL + unique can apply.
-- ----------------------------------------------------------------------------
alter table topic_rollups
  drop constraint if exists topic_rollups_cycle_id_qm_result_id_topic_name_key;

delete from topic_rollups where qm_topic_id is null;

alter table topic_rollups alter column qm_topic_id set not null;

alter table topic_rollups
  add constraint topic_rollups_cycle_id_qm_result_id_qm_topic_id_key
  unique (cycle_id, qm_result_id, qm_topic_id);

-- topic_name stays a non-unique data column (we still display it).

-- ----------------------------------------------------------------------------
-- 2. Shared clear: remove every ingested row for one cycle (FK-safe order).
--    The engine outputs (item_stats / item_reviews / score_runs /
--    participant_scores / grades) cascade from items / assessments /
--    participants, so deleting those clears them too. Lives in the private
--    `app` schema so clients can't call it directly.
-- ----------------------------------------------------------------------------
create or replace function app.clear_cycle_ingest(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  delete from result_totals where cycle_id = p_cycle;
  delete from topic_rollups where cycle_id = p_cycle;
  delete from responses     where cycle_id = p_cycle;
  delete from items         where cycle_id = p_cycle;   -- cascades item_stats / item_reviews
  delete from participants  where cycle_id = p_cycle;   -- cascades grades / participant_scores
  delete from assessments   where cycle_id = p_cycle;   -- cascades score_runs
  delete from import_batches where cycle_id = p_cycle;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Transactional, idempotent persist for one upload.
--    Clears the sitting then bulk-inserts the supplied payload, all in one
--    transaction. Returns the row counts. The payload carries client-generated
--    `id`s for assessments / items / participants so the caller can wire the
--    foreign keys without reading ids back (which is what made the old REST
--    path non-atomic). Each insert lists only the columns it provides, so the
--    not-client-writable columns (items.status, …) keep their defaults.
--
--    SECURITY: runs as definer (bypasses the column GRANT model, like the other
--    privileged writers) and is granted to `service_role` ONLY — the secret-key
--    admin client. It is NOT executable by `authenticated`, so it cannot be
--    abused to write arbitrary cycles. `auth.uid()` is null under the service
--    role, so the audit actor is passed explicitly as `p_actor`.
-- ----------------------------------------------------------------------------
create or replace function public.ingest_persist(
  p_cycle uuid, p_payload jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_counts jsonb;
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
                     major_element, sub_element, demand_level, max_score,
                     question_type, question_status, topic_name, topic_path)
  select id, cycle_id, assessment_id, qm_question_id, wording,
         major_element, sub_element, demand_level, max_score,
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

  insert into import_batches (cycle_id, file_ref, parsed_rows, validation_passed,
                              report_json, items_file, assessments_file, topics_file,
                              results_total, results_reconciled, created_by)
  select p_cycle, b.file_ref, b.parsed_rows, b.validation_passed,
         b.report_json, b.items_file, b.assessments_file, b.topics_file,
         b.results_total, b.results_reconciled, p_actor
  from jsonb_populate_record(null::import_batches, p_payload->'import_batch') b;

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

-- ----------------------------------------------------------------------------
-- 4. Clear a sitting's data (Task 4 — "start from clean"). Keeps the cycle
--    shell, empties its ingested rows, and returns it to the draft/Upload
--    state. Lead/admin only; audited with the resolved user (session present,
--    so auth.uid() is the real caller).
-- ----------------------------------------------------------------------------
create or replace function public.clear_sitting_data(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;

  perform app.clear_cycle_ingest(p_cycle);

  update exam_cycles set status = 'draft', updated_at = now() where id = p_cycle;

  perform app.audit(p_cycle, 'clear', 'exam_cycle', p_cycle::text, null,
                    jsonb_build_object('cleared', true));
end $$;

grant execute on function public.clear_sitting_data(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Delete a sitting (Task 3 — destructive). Removes the sitting and ALL its
--    data: deleting the `exam_cycles` row cascades every child table
--    (assessments / items / participants / responses / result_totals /
--    topic_rollups / score_runs / grades / memberships / import_batches …).
--    Lead/admin only. The deletion is audited BEFORE the delete with
--    cycle_id = NULL, so the audit row is NOT swept by the cascade and the
--    record survives.
-- ----------------------------------------------------------------------------
create or replace function public.delete_sitting(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare c exam_cycles;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;

  select * into c from exam_cycles where id = p_cycle;
  if not found then return; end if;

  -- Audit at the workspace level (cycle_id NULL) so the cascade below can't
  -- delete this very record. The deleted cycle is named in entity_id / before.
  perform app.audit(null, 'delete', 'exam_cycle', p_cycle::text, to_jsonb(c), null);

  delete from exam_cycles where id = p_cycle;   -- cascades all child rows
end $$;

grant execute on function public.delete_sitting(uuid) to authenticated;

commit;
