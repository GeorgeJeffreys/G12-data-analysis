-- ============================================================================
-- G12++ — PER-SUBJECT RESPONSES↔SITTINGS INTEGRITY: make a whole-sitting collapse
-- impossible to persist, asserted per subject inside the persist transaction.
-- Migration 0030_responses_subject_sitting_integrity.sql
--
-- WHY THIS EXISTS (the string-sort 15→6 score-matrix collapse, root cause)
--   The collapse was proven order-dependent: per subject, the sittings that survived
--   into `responses` / the score matrix were exactly the first-N ResultIds in STRING
--   sort order (Applicable Math kept 1032…,1086…,1180…,1185…,1272…,1323…; dropped
--   1572…,1718…,2008…,2131…,3536…,4922…,6819…,8371… — larger NUMBERS but later
--   STRINGS). `qm_result_id` is a text column, so any order/dedup that treats it as
--   text and then truncates keeps the lexically-first sittings. The primary defect
--   was on the READ (an unbounded, text-index-ordered `responses` fetch truncated by
--   PostgREST's max-rows cap — fixed in supabase-hydrate.ts); this migration adds the
--   matching WRITE-SIDE guard so the collapse can never be persisted either.
--
--   Migration 0029 already asserts whole-sitting completeness (every qm_result_id
--   present in BOTH sittings and responses). This adds the explicit PER-SUBJECT count
--   equality the brief calls for: count(distinct qm_result_id) in responses MUST equal
--   count(distinct qm_result_id) in sittings, for every subject that has responses —
--   a clearer, subject-named failure when the two diverge.
--
-- WHAT THIS DOES (idempotent — safe on a current DB and on a drifted one)
--   1. Re-affirms `public.ingest_persist` with EVERY 0029 guard PLUS a per-subject
--      distinct-sitting count assertion (grouped by assessment). If any subject
--      persists a different distinct-sitting count in responses vs sittings, the
--      ingest ABORTS naming the subject and both counts — nothing is committed.
--   2. Hardens `schema_health()` to probe that the LIVE ingest_persist body carries
--      the per-subject guard (not just the 0029 whole-sitting guard). Reports '0030'.
--      Retains every 0025/0026/0028/0029 probe.
--
-- SCOPE / SAFETY
--   Function DROP-then-CREATE only — no data drop, no row mutation. Does NOT touch
--   `sittings` (correct), the scoring engine (183/183), or the C1 auth model.
--   Forward-only; reversible via 0030_responses_subject_sitting_integrity.rollback.sql.
--   Run AFTER 0001–0029 in the Supabase SQL editor (EU). Then re-ingest — the collapse
--   cannot persist (the function raises otherwise).
-- ============================================================================

begin;

set local lock_timeout = '30s';

-- ----------------------------------------------------------------------------
-- 1. Re-affirm ingest_persist with the 0029 guards PLUS the per-subject count guard.
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
  v_subject_gap int;
  v_subject_detail text;
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
  -- If any sitting exists in `sittings` but has zero rows in `responses` (or vice
  -- versa), the ingest ABORTS instead of persisting a collapsed matrix.
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

  -- ── PER-SUBJECT sitting-count guard: count(distinct qm_result_id) in responses
  --    MUST equal count(distinct qm_result_id) in sittings, for every subject that
  --    has responses. This is the decisive assertion against the string-sort collapse
  --    (some of a subject's sittings kept, the rest silently dropped) — the ingest
  --    ABORTS naming the subject and both counts. Subjects whose sittings carry no
  --    MCQ responses are excluded (they have no responses rows to reconcile).
  with sit as (
    select assessment_id, count(distinct qm_result_id) as n
    from sittings
    where cycle_id = p_cycle and qm_result_id is not null and qm_result_id <> ''
    group by assessment_id
  ), resp as (
    select assessment_id, count(distinct qm_result_id) as n
    from responses
    where cycle_id = p_cycle and qm_result_id is not null and qm_result_id <> ''
    group by assessment_id
  ), mism as (
    select s.assessment_id, r.n as responses_n, s.n as sittings_n
    from sit s
    join resp r on r.assessment_id = s.assessment_id   -- only subjects that HAVE responses
    where s.n <> r.n
  )
  select count(*),
         string_agg(
           coalesce((select name from assessments a where a.id = m.assessment_id), m.assessment_id::text)
             || ' (responses ' || m.responses_n || ' != sittings ' || m.sittings_n || ')', ', ')
    into v_subject_gap, v_subject_detail
  from mism m;

  if v_subject_gap > 0 then
    raise exception
      'ingest_persist: % subject(s) persist a different distinct-sitting count in responses vs sittings (per-subject whole-sitting collapse): %',
      v_subject_gap, v_subject_detail;
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
-- 2. schema_health — every 0029 probe retained, PLUS a probe that the LIVE
--    ingest_persist body carries the PER-SUBJECT sitting-count guard. Reports '0030'.
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
    'migration', '0030',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration). Expect ok=true, migration '0030', empty arrays.
--   select public.schema_health();
--
-- Then re-ingest the 700435 CSVs into a fresh cycle and confirm responses distinct
-- sittings == sittings, per subject (Math 15 / English 12 / Scientific 12 /
-- Arabic 9 / Life 11). The persist now RAISES if any subject diverges:
--   select a.name,
--          count(distinct s.qm_result_id)                                    as sittings,
--          count(distinct r.qm_result_id) filter (where r.qm_result_id is not null) as responses
--     from assessments a
--     left join sittings  s on s.assessment_id = a.id
--     left join responses r on r.assessment_id = a.id
--    where a.cycle_id = '<CYCLE_UUID>'
--    group by a.name;   -- sittings == responses for every subject with responses
-- ----------------------------------------------------------------------------
