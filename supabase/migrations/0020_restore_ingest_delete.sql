-- ============================================================================
-- G12++ — RESTORE INGEST + DELETE: bring the live DB back in line with the code.
-- Migration 0020_restore_ingest_delete.sql
--
-- WHY THIS EXISTS (two symptoms, one root cause: the live DB lags the code)
--   1. Fresh import fails with
--        ingest_persist: column "item_set" of relation "items" does not exist
--      `items.item_set` is created by migration 0010, and `ingest_persist`
--      (0010 / 0019) writes it — but a CREATE OR REPLACE FUNCTION body is not
--      bound to table columns until it RUNS, so a DB that got the function but
--      never ran 0010's `ALTER TABLE items ADD COLUMN item_set` accepts the
--      function yet fails the insert at ingest time. → 0010 is EXISTS-BUT-UNRUN.
--   2. "Delete sitting" / "Clear data" silently no-op — the `delete_sitting` /
--      `clear_sitting_data` functions (0007) are missing or stale in the live DB,
--      so the RPC returns nothing and the UI reports success while rows survive.
--      Both functions shipped in the SAME consolidated file family as (1); if one
--      drifted, assume both did.
--
--   Root cause both times: CC-generated SQL that was never fully run in the
--   Supabase SQL editor. This file is the single, idempotent "bring-DB-current"
--   runner George pastes into the editor (EU) to close the drift for good.
--
-- WHAT THIS DOES (all idempotent — safe on an out-of-date DB AND safe to re-run)
--   1. Adds every column the code references that a live schema may be missing
--      (`items.item_set`), with IF NOT EXISTS.
--   2. Re-affirms `public.ingest_persist(...)` at its CURRENT, correct definition
--      (identical to 0019: writes item_set + the cohort-integrity guard).
--   3. Hardens the shared clear to RETURN the deleted-row count, and rebuilds
--      `clear_sitting_data` / `delete_sitting` / `reset_cycle_for_reingest` to
--      RETURN a row count so the UI can confirm the operation actually did
--      something (0 rows / absent function → explicit error, never silent).
--   4. `delete_sitting` counts across EVERY per-sitting table before the cascade,
--      so the returned total proves the delete was exhaustive.
--   5. Adds `public.schema_health()` — a drift probe the app can call to answer
--      "did you run the migration?" itself, instead of a failed import at the
--      worst moment.
--
-- SAFETY: no destructive DROP of user DATA. Functions whose RETURN TYPE changes
-- (void → bigint) must be DROP-then-CREATE — dropping a FUNCTION is not dropping
-- data, and the grants are re-applied here. The item_set column is only ever
-- added (never dropped). Engine untouched — parity 183/183 unaffected.
--
-- The human runs this in the Supabase SQL editor (EU) AFTER 0001–0019. It is the
-- next numbered, append-only migration in the repo. Reversible via
-- 0020_restore_ingest_delete.rollback.sql.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Columns the ingest write path references that a lagging live schema may be
--    missing. `items.item_set` (0010) is the one that breaks a fresh import; the
--    ADD is idempotent so this is safe whether 0010 ran or not.
-- ----------------------------------------------------------------------------
alter table items add column if not exists item_set text;

-- ----------------------------------------------------------------------------
-- 2. Shared clear — now RETURNS the number of rows it removed (bigint), so the
--    callers below can surface a real count. Same table set + intent as 0018
--    (engine outputs removed explicitly; `clean_exclusions` deliberately KEPT so
--    manual cohort removals re-resolve on re-ingest). Return type changes from
--    void → bigint, so drop-then-create.
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

  delete from responses where cycle_id = p_cycle;
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
-- 3. Re-affirm the CURRENT, correct `ingest_persist` (identical to 0019: writes
--    item_set + the cohort-integrity guard). CREATE OR REPLACE keeps the same
--    signature / grants / SECURITY DEFINER semantics. Re-running it here means a
--    DB that only got an OLDER ingest_persist (pre-item_set, or pre-guard) is
--    brought fully current by this one file.
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

-- ----------------------------------------------------------------------------
-- 4. Exhaustive per-sitting row counter. Sums EVERY table that holds data for a
--    sitting so `delete_sitting` can report exactly how many rows the cascade
--    removes. `to_regclass` guards each table so the count still works on a DB
--    where some optional feature's table isn't present. Lives in `app` (private).
-- ----------------------------------------------------------------------------
create or replace function app.cycle_row_count(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  v_total bigint := 0;
  v_n bigint;
  t text;
  -- Every table keyed directly on cycle_id (ingest rows, engine outputs with a
  -- cycle_id, decisions, config, provenance, audit + access rows).
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

  -- Engine outputs keyed indirectly (removed by cascade from items / score_runs).
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
-- 5. Clear a sitting's data (keep the shell) — NOW RETURNS the row count. The UI
--    checks it: 0 means nothing was cleared (surface an error, never a silent
--    success). Return type void → bigint, so drop-then-create; re-grant after.
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
-- 6. Delete a sitting AND all its data — NOW RETURNS the total row count removed
--    across EVERY per-sitting table (counted before the cascade). Deleting the
--    `exam_cycles` row cascades every child; the pre-count proves the delete was
--    exhaustive and non-empty. The deletion is audited at the workspace level
--    (cycle_id NULL) BEFORE the delete so the record survives the cascade.
--    Return type void → bigint, so drop-then-create; re-grant after.
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
-- 7. SQL-editor clean re-ingest reset (0018) — NOW RETURNS the row count too, so
--    the operator sees the reset did something. No auth.uid() dependency (runs in
--    the editor). Return type void → bigint, so drop-then-create; re-grant after.
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
-- 8. Schema drift probe. Compares the columns + functions the code REQUIRES
--    against what the live DB actually has, and returns a JSON report so the app
--    can flag "the DB is behind — run migration 0020" itself, instead of a raw
--    Postgres error at ingest time. SECURITY DEFINER so it can read the catalog
--    regardless of the caller's role. Read-only.
-- ----------------------------------------------------------------------------
create or replace function public.schema_health()
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_missing_cols text[] := '{}';
  v_missing_fns  text[] := '{}';
begin
  -- Required columns (schema, table, column).
  if to_regclass('public.items') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'items' and column_name = 'item_set') then
    v_missing_cols := array_append(v_missing_cols, 'items.item_set');
  end if;

  -- Required functions (by schema.name — signature-agnostic is enough for drift).
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
    'migration', '0020',
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
-- Then a fresh import in the app should succeed end-to-end, and the danger-zone
-- Delete/Clear return a non-zero row count (visible in the audit_log `after`
-- payload). To dry-run the delete count for a cycle WITHOUT deleting:
--   select app.cycle_row_count('<CYCLE_UUID>');
