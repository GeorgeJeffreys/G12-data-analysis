-- ============================================================================
-- G12++ — REBUILD DATA PROCESSING: natural keys, one grain, clean schema.
-- Migration 0026_pipeline_natural_key_spine.sql
--
-- WHY THIS EXISTS (the collapse/collision/stale saga, reset instead of re-patched)
--   The ingest fact tables were rebuilt-by-patch repeatedly: a per-participant
--   synthetic id merged a student's subjects into one record; then identical-profile
--   whole SITTINGS collided on persist (Dalal Hasan's Math sitting 1572504488 dropped
--   while Fatima Aljassem's 1032381502 survived → 9/7/8/8/4 instead of 15/11/12/9/10);
--   re-uploads didn't refresh; delete didn't cascade; multiple keying schemes fought.
--   The data is all test/known-wrong, so this establishes a CLEAN natural-key BASELINE
--   for the per-sitting fact tables rather than layering another patch.
--
-- THE CLEAN MODEL (natural keys, resolved once at ingest, carried unchanged)
--   * participant = email (ResultParticipantName, lower-cased) — already the identity
--     the app resolves (lib/ingest/participant-identity.ts); carried here as
--     `participant_email` on the spine.
--   * sitting = the real QM `ResultId` (one per student × subject) — the natural key
--     of the new first-class `sittings` table (PK `(cycle_id, qm_result_id)`).
--   * question = `QuestionId` — carried as `responses.question_id`.
--   The authoritative uniqueness that PREVENTS the whole-sitting collisions is
--   `responses UNIQUE (cycle_id, qm_result_id, question_id)` — one row per sitting ×
--   question. Delete is a REAL cascade: responses → sittings → exam_cycles.
--
-- SCOPE / SAFETY (why this is the right cut)
--   Only the three LEAF per-sitting fact tables are reset — `responses`,
--   `result_totals` (renamed to the correctly-named `sittings`), and `topic_rollups`.
--   Nothing has an inbound FK to them, so dropping+recreating is clean and touches no
--   other table. The metadata tables (`participants`/`items`/`assessments`) and the
--   engine-output + decision tables keep their surrogate `id`s, so the scoring engine
--   feed (lib/server/engine-write.ts reads `responses.item_id`/`participant_id`) and
--   every unrelated feature (incidents/essays/distinctions/audit) are untouched.
--   `responses` therefore KEEPS `item_id`/`participant_id` as denormalised join
--   surrogates for that feed; the AUTHORITATIVE keys are the natural ones above.
--   The parity-locked scoring engine + validated formulae (183/183) are NOT touched —
--   they are fed clean data, exactly as before.
--
--   Test-only data: this migration DROPS the three fact tables (no backup). The human
--   re-ingests the CSVs after running it. Idempotent enough to re-run (drop if exists
--   + create). Run AFTER 0001–0025 in the Supabase SQL editor (EU).
-- ============================================================================

begin;

set local lock_timeout = '30s';

-- ----------------------------------------------------------------------------
-- 1. Drop the leaf fact tables (test data only; NOTHING has an inbound FK to
--    these three, so this disturbs no other table). `result_totals` is superseded
--    by `sittings`.
-- ----------------------------------------------------------------------------
drop table if exists topic_rollups cascade;
drop table if exists responses     cascade;
drop table if exists result_totals cascade;

-- ----------------------------------------------------------------------------
-- 2. sittings — the first-class per-sitting spine. NATURAL KEY = the QM ResultId
--    (`qm_result_id`), one per student × subject. Participant identity is the email.
-- ----------------------------------------------------------------------------
create table sittings (
  cycle_id          uuid not null references exam_cycles(id) on delete cascade,
  qm_result_id      text not null,                       -- the sitting natural key
  participant_email text not null,                       -- participant natural key
  participant_id    uuid references participants(id) on delete cascade, -- join surrogate
  assessment_id     uuid references assessments(id)  on delete cascade,
  subject_name      text,
  result_status     text,
  attempt_number    integer,
  total_score       numeric,
  maximum_score     numeric,
  percentage_score  numeric,
  scoreband         text,
  sitting           text,
  reconciled        boolean not null default true,
  created_at        timestamptz not null default now(),
  primary key (cycle_id, qm_result_id)
);

-- ----------------------------------------------------------------------------
-- 3. responses — one row per SITTING × QUESTION. The UNIQUE (cycle_id,
--    qm_result_id, question_id) is what makes identical-profile sittings
--    impossible to collide. FK (cycle_id, qm_result_id) → sittings ON DELETE
--    CASCADE gives the real delete cascade. `item_id`/`participant_id` are retained
--    as denormalised join surrogates for the (untouched) engine feed.
-- ----------------------------------------------------------------------------
create table responses (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references exam_cycles(id) on delete cascade,
  qm_result_id      text not null,                       -- sitting natural key
  question_id       text not null,                       -- QM QuestionId natural key
  participant_email text,
  participant_id    uuid references participants(id) on delete cascade, -- engine-feed surrogate
  item_id           uuid references items(id)        on delete cascade, -- engine-feed surrogate
  assessment_id     uuid references assessments(id)  on delete cascade,
  answer_given      text,
  answer_score      numeric not null,
  response_time     numeric,
  result_status     text,
  question_type     text,
  question_status   text,
  created_at        timestamptz not null default now(),
  unique (cycle_id, qm_result_id, question_id),
  foreign key (cycle_id, qm_result_id)
    references sittings (cycle_id, qm_result_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 4. topic_rollups — one row per sitting × topic (curriculum element).
--    Cascades from the sitting parent too.
-- ----------------------------------------------------------------------------
create table topic_rollups (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references exam_cycles(id) on delete cascade,
  qm_result_id      text not null,
  assessment_id     uuid references assessments(id)  on delete cascade,
  participant_id    uuid references participants(id) on delete cascade,
  qm_topic_id       text,
  topic_name        text not null,
  topic_path        text,
  score             numeric not null,
  maximum_score     numeric not null,
  percentage_score  numeric,
  question_count    integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (cycle_id, qm_result_id, topic_name),
  foreign key (cycle_id, qm_result_id)
    references sittings (cycle_id, qm_result_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 5. RLS — same shape as every cycle-scoped table: members read their cycle's
--    data; admins write. Routes through the single 0025 authorization primitive.
-- ----------------------------------------------------------------------------
alter table sittings      enable row level security;
alter table responses     enable row level security;
alter table topic_rollups enable row level security;

create policy sittings_select on sittings for select
  using (app.is_member(cycle_id));
create policy sittings_write on sittings for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- responses are immutable facts: members read, admins insert (no update/delete
-- policy — deletes happen through the sitting cascade / definer functions).
create policy responses_select on responses for select
  using (app.is_member(cycle_id));
create policy responses_insert on responses for insert
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

create policy topic_rollups_select on topic_rollups for select
  using (app.is_member(cycle_id));
create policy topic_rollups_write on topic_rollups for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- ----------------------------------------------------------------------------
-- 6. ingest_persist — FILTER → CLEAR-THEN-WRITE at the new clean grain. Inserts
--    the sitting spine BEFORE its children (FK order), then the sitting-grain
--    completeness guard (every sitting present on BOTH sides) and the roster guard.
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

  -- responses — one row per sitting × question (natural key carried through).
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
-- 7. clear_cycle_ingest — clear-then-write helper + delete backbone. Deleting a
--    cycle's `sittings` cascades responses + topic_rollups; the rest is unchanged.
-- ----------------------------------------------------------------------------
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

  -- Sitting spine — cascades responses + topic_rollups (FK ON DELETE CASCADE).
  delete from sittings where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- Any orphan responses/topic_rollups (defensive; the cascade normally clears them).
  delete from responses where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from topic_rollups where cycle_id = p_cycle;
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
-- 8. cycle_row_count — swap `result_totals` for `sittings` in the delete pre-count.
-- ----------------------------------------------------------------------------
create or replace function app.cycle_row_count(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  v_total bigint := 0;
  v_n bigint;
  t text;
  direct_tables text[] := array[
    'assessments','items','participants','responses','sittings','topic_rollups',
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
-- 9. schema_health — retains every 0025 probe (auth + delete lifecycle + item_set)
--    and swaps the responses-grain probes to the new clean schema. Reports '0026'.
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
    'migration', '0026',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration). Expect ok=true, migration '0026', empty arrays.
--   select public.schema_health();
--
-- Then, on the live app: delete + re-ingest the 700435 CSVs into a fresh cycle →
-- per-subject counts 15 / 11 / 12 / 9 / 10, Dalal Hasan present, no ResultId spans
-- >1 subject, sitting-records ≫ participants; delete clears to the empty Upload
-- state; re-uploading keeps the counts.
-- ----------------------------------------------------------------------------
