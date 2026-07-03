-- ============================================================================
-- G12++ — DELETE + RE-INGEST AT THE SITTING GRAIN: make the data lifecycle whole
-- again, and make the drift probe actually catch a stale delete. Migration
-- 0022_delete_reingest_sitting_grain.sql
--
-- WHY THIS EXISTS (the meta-blocker: every fix showed "no change")
--   0021 moved `responses` to the SITTING × question grain (item_id, qm_result_id)
--   and re-affirmed `ingest_persist` + `schema_health`. It did NOT re-affirm the
--   DELETE / CLEAR objects (`delete_sitting`, `clear_sitting_data`,
--   `reset_cycle_for_reingest`, `app.clear_cycle_ingest`, `app.cycle_row_count`) —
--   those shipped only in 0020. So a live DB that ran 0021 on top of a DRIFTED 0020
--   (or a pre-0020, void-returning `delete_sitting` from 0007) is left with a delete
--   path that silently no-ops:
--     * an OLD `delete_sitting` RETURNS void → the RPC returns null → the UI either
--       errors or (older deploys) navigates away while every row survives;
--     * `schema_health()` only checked that a function EXISTS *by name*, so a stale
--       void delete passed the probe with ok=true — the exact "migration N landed in
--       code but was never reflected end-to-end" pattern that made fix after fix show
--       "no change": the persisted (old, collapsed) data never cleared.
--
--   This file is the single, idempotent "bring-DB-current" runner. It (1) re-affirms
--   EVERY delete/clear/ingest object at the CURRENT sitting grain so one paste closes
--   the drift, and (2) HARDENS `schema_health()` to verify the objects' DEFINITIONS
--   (return type = bigint, the sitting-grain unique constraint, the sitting key
--   column) — not just their names — so a stale delete can never again read as "ok".
--
-- WHAT THIS DOES (all idempotent — safe on an out-of-date DB AND safe to re-run)
--   1. Re-affirms the 0021 sitting-grain shape: `responses.qm_result_id` column +
--      the (item_id, qm_result_id) uniqueness (drops the old participant-grain key).
--   2. Re-affirms `app.clear_cycle_ingest` (RETURNS bigint) — the cycle-scoped
--      clear-then-count both delete and re-ingest rely on. Grain-agnostic: it deletes
--      by cycle_id, so it removes every sitting-grain response row regardless of key.
--   3. Re-affirms `app.cycle_row_count` (exhaustive per-sitting counter).
--   4. Drop-then-creates `clear_sitting_data` / `delete_sitting` /
--      `reset_cycle_for_reingest` at RETURNS bigint (replacing any stale void body).
--   5. Re-affirms `public.ingest_persist(...)` at the 0021 grain (responses INSERT
--      names + selects qm_result_id) — clear-then-insert, scoped to the cycle, so a
--      re-upload fully REPLACES and never upsert-merges onto stale rows.
--   6. Hardens `public.schema_health()`: verifies qm_result_id, the sitting-grain
--      unique constraint (and the absence of the old participant-grain one), and that
--      delete_sitting / clear_sitting_data / reset_cycle_for_reingest /
--      clear_cycle_ingest each RETURN bigint. Reports migration '0022'.
--
-- SAFETY: no destructive DROP of user DATA. Only function DROP-then-CREATE (dropping
-- a FUNCTION is not dropping data; grants re-applied here) and a constraint swap.
-- The engine + grade-bearing tables are untouched — parity 183/183 unaffected (this
-- is ingest/identity/persistence only).
--
-- The human runs this in the Supabase SQL editor (EU) AFTER 0001–0021. It is the
-- next numbered, append-only migration. Reversible via
-- 0022_delete_reingest_sitting_grain.rollback.sql.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Re-affirm the 0021 sitting-grain shape (idempotent) — in case 0021 itself
--    only partially applied on a drifted DB. The column is nullable (safe ADD);
--    a re-ingest (clear-then-insert) repopulates every row.
-- ----------------------------------------------------------------------------
alter table responses add column if not exists qm_result_id text;

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
-- 2. Shared clear — RETURNS the number of rows it removed (bigint). Cycle-scoped
--    DELETEs only (where cycle_id = p_cycle), so it is grain-agnostic: it removes
--    every sitting-grain response for the cycle whatever the uniqueness key is.
--    Both `delete_sitting`'s pre-cascade cleanup peers and the re-ingest replace
--    depend on this. Re-affirmed here so a DB with a stale/absent 0020 gets it.
--    Return type is bigint; if a drifted DB has a void copy, replace it.
-- ----------------------------------------------------------------------------
drop function if exists app.clear_cycle_ingest(uuid);
create or replace function app.clear_cycle_ingest(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  v_total bigint := 0;
  v_n bigint;
begin
  -- Engine OUTPUTS (materialised) — explicit, in case a cascade is ever missing.
  delete from participant_scores ps using score_runs sr
    where ps.score_run_id = sr.id and sr.cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from score_runs where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from item_stats st using items i
    where st.item_id = i.id and i.cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from grades where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- Ingested rows (FK-safe order; the parents also cascade the children above).
  delete from result_totals where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from topic_rollups where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from responses where cycle_id = p_cycle;   -- sitting-grain rows, cleared by cycle
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from items where cycle_id = p_cycle;          -- cascades item_stats / item_reviews
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from participants where cycle_id = p_cycle;   -- cascades grades / participant_scores
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from assessments where cycle_id = p_cycle;    -- cascades score_runs
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from import_batches where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Exhaustive per-sitting row counter — re-affirmed identical to 0020. Sums
--    EVERY table that holds data for a sitting so `delete_sitting` can report how
--    many rows the cascade removes (0 → explicit error, never a silent success).
-- ----------------------------------------------------------------------------
create or replace function app.cycle_row_count(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  v_total bigint := 0;
  v_n bigint;
  t text;
  direct_tables text[] := array[
    'assessments','items','participants','responses','result_totals','topic_rollups',
    'import_batches','score_runs','grades','clean_exclusions','grade_schemes',
    'alterations','essay_marks','incidents','incident_rows','incident_applications',
    'incident_import_source','distinction_overrides','distinction_state',
    'document_settings','memberships','audit_log'
  ];
begin
  foreach t in array direct_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I where cycle_id = $1', t)
        into v_n using p_cycle;
      v_total := v_total + coalesce(v_n, 0);
    end if;
  end loop;

  if to_regclass('public.item_stats') is not null then
    select count(*) into v_n from item_stats st join items i on i.id = st.item_id
      where i.cycle_id = p_cycle;
    v_total := v_total + coalesce(v_n, 0);
  end if;
  if to_regclass('public.item_reviews') is not null then
    select count(*) into v_n from item_reviews ir join items i on i.id = ir.item_id
      where i.cycle_id = p_cycle;
    v_total := v_total + coalesce(v_n, 0);
  end if;
  if to_regclass('public.participant_scores') is not null then
    select count(*) into v_n from participant_scores ps join score_runs sr on sr.id = ps.score_run_id
      where sr.cycle_id = p_cycle;
    v_total := v_total + coalesce(v_n, 0);
  end if;

  return v_total;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Clear a sitting's DATA (keep the shell) — RETURNS the row count. Empties the
--    cycle's ingested + engine-output rows at the current grain and returns the
--    cycle to 'draft' so the Upload screen shows its EMPTY state, ready for a
--    fresh upload. 0 rows / a missing function → the caller surfaces an error.
--    Drop-then-create replaces any stale void body.
-- ----------------------------------------------------------------------------
drop function if exists public.clear_sitting_data(uuid);
create or replace function public.clear_sitting_data(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare v_deleted bigint;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;

  v_deleted := app.clear_cycle_ingest(p_cycle);

  update exam_cycles set status = 'draft', updated_at = now() where id = p_cycle;

  perform app.audit(p_cycle, 'clear', 'exam_cycle', p_cycle::text, null,
                    jsonb_build_object('cleared', true, 'rows_deleted', v_deleted));
  return v_deleted;
end $$;

grant execute on function public.clear_sitting_data(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Delete a sitting AND all its data — RETURNS the total row count removed
--    across EVERY per-sitting table (counted before the cascade). Deleting the
--    `exam_cycles` row cascades every child; the pre-count proves the delete was
--    exhaustive and non-empty. Drop-then-create replaces any stale void body.
-- ----------------------------------------------------------------------------
drop function if exists public.delete_sitting(uuid);
create or replace function public.delete_sitting(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  c exam_cycles;
  v_total bigint;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;

  select * into c from exam_cycles where id = p_cycle;
  if not found then return 0; end if;

  v_total := app.cycle_row_count(p_cycle);

  -- Audit at the workspace level (cycle_id NULL) so the cascade can't sweep it.
  perform app.audit(null, 'delete', 'exam_cycle', p_cycle::text, to_jsonb(c),
                    jsonb_build_object('rows_deleted', v_total));

  delete from exam_cycles where id = p_cycle;   -- cascades all child rows counted above
  return v_total;
end $$;

grant execute on function public.delete_sitting(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. SQL-editor clean re-ingest reset — RETURNS the row count. Drop-then-create
--    replaces any stale void body. No auth.uid() dependency (runs in the editor).
-- ----------------------------------------------------------------------------
drop function if exists public.reset_cycle_for_reingest(uuid, uuid);
create or replace function public.reset_cycle_for_reingest(
  p_cycle uuid, p_actor uuid default null)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare v_deleted bigint;
begin
  if not exists (select 1 from exam_cycles where id = p_cycle) then
    raise exception 'reset_cycle_for_reingest: no cycle %', p_cycle;
  end if;

  v_deleted := app.clear_cycle_ingest(p_cycle);

  update exam_cycles set status = 'draft', updated_at = now() where id = p_cycle;

  if p_actor is not null then
    insert into audit_log (cycle_id, actor_id, action, entity, entity_id, before, after)
    values (p_cycle, p_actor, 'reset_for_reingest', 'exam_cycle', p_cycle::text, null,
            jsonb_build_object('cleared', true, 'returned_to', 'draft', 'rows_deleted', v_deleted));
  end if;
  return v_deleted;
end $$;

revoke all on function public.reset_cycle_for_reingest(uuid, uuid) from public;
grant execute on function public.reset_cycle_for_reingest(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 7. Re-affirm `ingest_persist` at the 0021 sitting grain (responses INSERT names
--    + selects qm_result_id). clear-before-insert scoped to the cycle → a
--    re-upload REPLACES cleanly and never upsert-merges onto stale rows; a mid-
--    ingest failure rolls the whole function back (no partial rows).
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
-- 8. HARDENED drift probe. Beyond "does a function of this name exist", it now
--    verifies the DEFINITIONS the delete/re-ingest lifecycle needs:
--      * responses.qm_result_id present (the sitting key);
--      * the (item_id, qm_result_id) unique constraint present AND the old
--        (participant_id, item_id) one gone (the grain is actually swapped);
--      * delete_sitting / clear_sitting_data / reset_cycle_for_reingest /
--        clear_cycle_ingest each RETURN bigint (a stale void body — the silent
--        no-op that caused "no change" — is flagged, not passed as ok).
--    Reports migration '0022'. SECURITY DEFINER + read-only.
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
    'migration', '0022',
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
-- Dry-run a delete's row count for a cycle WITHOUT deleting (non-zero proves the
-- delete would actually remove rows):
--   select app.cycle_row_count('<CYCLE_UUID>');
--
-- After a fresh re-ingest, distinct sitting keys should far exceed participants:
--   select count(distinct qm_result_id) as sittings, count(distinct participant_id) as participants
--     from responses where cycle_id = '<CYCLE_UUID>';
