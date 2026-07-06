-- ============================================================================
-- ROLLBACK for 0026_pipeline_natural_key_spine.sql — restore the pre-0026 fact
-- tables (responses keyed (item_id, qm_result_id), result_totals, topic_rollups)
-- and the 0023/0022 function bodies + the 0025 schema_health probe (reports '0025').
--
-- Test-only data: this DROPS the 0026 tables (sittings/responses/topic_rollups) and
-- recreates the prior shapes empty. Re-ingest repopulates them.
-- ============================================================================

begin;

set local lock_timeout = '30s';

drop table if exists topic_rollups cascade;
drop table if exists responses     cascade;
drop table if exists sittings       cascade;

-- responses — pre-0026 shape (uuid surrogates, sitting-grain unique (item_id, qm_result_id)).
create table responses (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references exam_cycles(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  item_id        uuid not null references items(id) on delete cascade,
  qm_result_id   text,
  answer_given   text,
  answer_score   numeric not null,
  response_time  numeric,
  result_status  text,
  question_type  text,
  question_status text,
  created_at     timestamptz not null default now(),
  unique (item_id, qm_result_id)
);

-- result_totals — pre-0026 shape.
create table result_totals (
  id               uuid primary key default gen_random_uuid(),
  cycle_id         uuid not null references exam_cycles(id) on delete cascade,
  assessment_id    uuid not null references assessments(id) on delete cascade,
  participant_id   uuid not null references participants(id) on delete cascade,
  qm_result_id     text not null,
  total_score      numeric not null,
  maximum_score    numeric not null,
  percentage_score numeric,
  scoreband        text,
  result_status    text,
  attempt_number   integer,
  sitting          text,
  reconciled       boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (cycle_id, qm_result_id)
);

create table topic_rollups (
  id               uuid primary key default gen_random_uuid(),
  cycle_id         uuid not null references exam_cycles(id) on delete cascade,
  assessment_id    uuid not null references assessments(id) on delete cascade,
  participant_id   uuid not null references participants(id) on delete cascade,
  qm_result_id     text not null,
  qm_topic_id      text,
  topic_name       text not null,
  topic_path       text,
  score            numeric not null,
  maximum_score    numeric not null,
  percentage_score numeric,
  question_count   integer not null default 0,
  created_at       timestamptz not null default now(),
  unique (cycle_id, qm_result_id, topic_name)
);

alter table responses     enable row level security;
alter table result_totals enable row level security;
alter table topic_rollups enable row level security;

create policy responses_select on responses for select using (app.is_member(cycle_id));
create policy responses_insert on responses for insert with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));
create policy result_totals_select on result_totals for select using (app.is_member(cycle_id));
create policy result_totals_write on result_totals for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));
create policy topic_rollups_select on topic_rollups for select using (app.is_member(cycle_id));
create policy topic_rollups_write on topic_rollups for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- Restore clear_cycle_ingest / cycle_row_count (0022 body: result_totals, not sittings).
create or replace function app.clear_cycle_ingest(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare v_total bigint := 0; v_n bigint;
begin
  delete from participant_scores ps using score_runs sr
    where ps.score_run_id = sr.id and sr.cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from score_runs where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from item_stats st using items i where st.item_id = i.id and i.cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from grades where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from result_totals where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from topic_rollups where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from responses where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from items where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from participants where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from assessments where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from import_batches where cycle_id = p_cycle;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  return v_total;
end $$;

create or replace function app.cycle_row_count(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  v_total bigint := 0; v_n bigint; t text;
  direct_tables text[] := array[
    'assessments','items','participants','responses','result_totals','topic_rollups',
    'import_batches','score_runs','grades','clean_exclusions','grade_schemes',
    'alterations','essay_marks','incidents','incident_rows','incident_applications',
    'incident_import_source','distinction_overrides','distinction_state',
    'document_settings','memberships','audit_log'];
begin
  foreach t in array direct_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I where cycle_id = $1', t) into v_n using p_cycle;
      v_total := v_total + coalesce(v_n, 0);
    end if;
  end loop;
  if to_regclass('public.item_stats') is not null then
    select count(*) into v_n from item_stats st join items i on i.id = st.item_id where i.cycle_id = p_cycle;
    v_total := v_total + coalesce(v_n, 0);
  end if;
  if to_regclass('public.item_reviews') is not null then
    select count(*) into v_n from item_reviews ir join items i on i.id = ir.item_id where i.cycle_id = p_cycle;
    v_total := v_total + coalesce(v_n, 0);
  end if;
  if to_regclass('public.participant_scores') is not null then
    select count(*) into v_n from participant_scores ps join score_runs sr on sr.id = ps.score_run_id where sr.cycle_id = p_cycle;
    v_total := v_total + coalesce(v_n, 0);
  end if;
  return v_total;
end $$;

-- Restore ingest_persist to the 0023 body (result_totals; responses without question_id).
create or replace function public.ingest_persist(p_cycle uuid, p_payload jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_counts jsonb; v_dropped int; v_detail text; v_sitting_gap int; v_sitting_detail text;
begin
  if p_actor is null then
    raise exception 'ingest_persist requires an explicit actor (the service role has no auth.uid())';
  end if;
  perform app.clear_cycle_ingest(p_cycle);
  insert into assessments (id, cycle_id, name, item_count, qm_max_score, sitting)
  select id, cycle_id, name, item_count, qm_max_score, sitting
  from jsonb_populate_recordset(null::assessments, p_payload->'assessments');
  insert into items (id, cycle_id, assessment_id, qm_question_id, wording, major_element, sub_element,
                     demand_level, item_set, max_score, question_type, question_status, topic_name, topic_path)
  select id, cycle_id, assessment_id, qm_question_id, wording, major_element, sub_element,
         demand_level, item_set, max_score, question_type, question_status, topic_name, topic_path
  from jsonb_populate_recordset(null::items, p_payload->'items');
  insert into participants (id, cycle_id, qm_participant_id, pseudonym_id, full_name, first_name,
                            last_name, email, dob, gender, group_name)
  select id, cycle_id, qm_participant_id, pseudonym_id, full_name, first_name, last_name, email, dob, gender, group_name
  from jsonb_populate_recordset(null::participants, p_payload->'participants');
  insert into responses (cycle_id, participant_id, item_id, qm_result_id, answer_given, answer_score,
                         response_time, result_status, question_type, question_status)
  select cycle_id, participant_id, item_id, qm_result_id, answer_given, answer_score,
         response_time, result_status, question_type, question_status
  from jsonb_populate_recordset(null::responses, p_payload->'responses');
  insert into result_totals (cycle_id, assessment_id, participant_id, qm_result_id, total_score, maximum_score,
                             percentage_score, scoreband, result_status, attempt_number, sitting, reconciled)
  select cycle_id, assessment_id, participant_id, qm_result_id, total_score, maximum_score,
         percentage_score, scoreband, result_status, attempt_number, sitting, reconciled
  from jsonb_populate_recordset(null::result_totals, p_payload->'result_totals');
  insert into topic_rollups (cycle_id, assessment_id, participant_id, qm_result_id, qm_topic_id, topic_name,
                             topic_path, score, maximum_score, percentage_score, question_count)
  select cycle_id, assessment_id, participant_id, qm_result_id, qm_topic_id, topic_name,
         topic_path, score, maximum_score, percentage_score, question_count
  from jsonb_populate_recordset(null::topic_rollups, p_payload->'topic_rollups');
  insert into import_batches (cycle_id, file_ref, file_size_mb, parsed_rows, validation_passed, report_json,
                              items_file, assessments_file, topics_file, results_total, results_reconciled, created_by)
  select p_cycle, b.file_ref, b.file_size_mb, b.parsed_rows, b.validation_passed, b.report_json,
         b.items_file, b.assessments_file, b.topics_file, b.results_total, b.results_reconciled, p_actor
  from jsonb_populate_record(null::import_batches, p_payload->'import_batch') b;
  with roster as (select distinct assessment_id, participant_id from result_totals where cycle_id = p_cycle),
       attached as (select distinct i.assessment_id, r.participant_id from responses r join items i on i.id = r.item_id where r.cycle_id = p_cycle),
       dropped as (select r.assessment_id, r.participant_id from roster r except select a.assessment_id, a.participant_id from attached a)
  select count(*), string_agg(assessment_id::text || '/' || participant_id::text, ', ') into v_dropped, v_detail from dropped;
  if v_dropped > 0 then
    raise exception 'ingest_persist: % roster sitter(s) have no attached responses (dropped-sitter / all-dots response-attach collapse): %', v_dropped, v_detail;
  end if;
  with rt as (select distinct qm_result_id from result_totals where cycle_id = p_cycle and qm_result_id is not null and qm_result_id <> ''),
       rr as (select distinct qm_result_id from responses where cycle_id = p_cycle and qm_result_id is not null and qm_result_id <> ''),
       gap as (select qm_result_id, 'result_totals without responses' as side from rt where qm_result_id not in (select qm_result_id from rr)
               union all select qm_result_id, 'responses without result_totals' as side from rr where qm_result_id not in (select qm_result_id from rt))
  select count(*), string_agg(qm_result_id || ' (' || side || ')', ', ') into v_sitting_gap, v_sitting_detail from gap;
  if v_sitting_gap > 0 then
    raise exception 'ingest_persist: % sitting(s) are not present at the sitting grain in both responses and result_totals (whole-sitting drop): %', v_sitting_gap, v_sitting_detail;
  end if;
  insert into audit_log (cycle_id, actor_id, action, entity, entity_id, before, after)
  values (p_cycle, p_actor, 'ingest', 'exam_cycle', p_cycle::text, null,
          jsonb_build_object('assessments', coalesce(jsonb_array_length(p_payload->'assessments'), 0),
                             'items', coalesce(jsonb_array_length(p_payload->'items'), 0),
                             'participants', coalesce(jsonb_array_length(p_payload->'participants'), 0),
                             'responses', coalesce(jsonb_array_length(p_payload->'responses'), 0)));
  v_counts := jsonb_build_object('assessments', coalesce(jsonb_array_length(p_payload->'assessments'), 0),
                                 'items', coalesce(jsonb_array_length(p_payload->'items'), 0),
                                 'participants', coalesce(jsonb_array_length(p_payload->'participants'), 0),
                                 'responses', coalesce(jsonb_array_length(p_payload->'responses'), 0),
                                 'result_totals', coalesce(jsonb_array_length(p_payload->'result_totals'), 0),
                                 'topic_rollups', coalesce(jsonb_array_length(p_payload->'topic_rollups'), 0));
  return v_counts;
end $$;
revoke all on function public.ingest_persist(uuid, jsonb, uuid) from public;
grant execute on function public.ingest_persist(uuid, jsonb, uuid) to service_role;

-- Restore schema_health to the 0025 body (reports '0025').
create or replace function public.schema_health()
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare v_missing_cols text[] := '{}'; v_missing_fns text[] := '{}';
begin
  if to_regclass('public.items') is null or not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='items' and column_name='item_set') then
    v_missing_cols := array_append(v_missing_cols, 'items.item_set');
  end if;
  if to_regclass('public.responses') is null or not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='responses' and column_name='qm_result_id') then
    v_missing_cols := array_append(v_missing_cols, 'responses.qm_result_id');
  end if;
  if not exists (select 1 from pg_constraint where conname='responses_item_id_qm_result_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:unique(item_id,qm_result_id)');
  end if;
  if exists (select 1 from pg_constraint where conname='responses_participant_id_item_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:stale-unique(participant_id,item_id)');
  end if;
  if not exists (select 1 from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typname='member_role' and e.enumlabel='lead_admin') then
    v_missing_cols := array_append(v_missing_cols, 'enum member_role:lead_admin');
  end if;
  if not exists (select 1 from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typname='member_role' and e.enumlabel='analyst') then
    v_missing_cols := array_append(v_missing_cols, 'enum member_role:analyst');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='memberships'
       and policyname='memberships_select' and coalesce(qual,'') ilike '%auth.uid()%'
       and coalesce(qual,'') not ilike '%is_member%' and coalesce(qual,'') not ilike '%has_role%') then
    v_missing_cols := array_append(v_missing_cols, 'memberships:self-read select policy');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='memberships'
       and cmd in ('INSERT','UPDATE','DELETE') and (coalesce(qual,'') ilike '%has_role%' or coalesce(with_check,'') ilike '%has_role%')) then
    v_missing_cols := array_append(v_missing_cols, 'memberships:has_role write policy');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='delete_sitting' and p.prorettype='bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.delete_sitting()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='clear_sitting_data' and p.prorettype='bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.clear_sitting_data()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='reset_cycle_for_reingest' and p.prorettype='bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.reset_cycle_for_reingest()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='clear_cycle_ingest' and p.prorettype='bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'app.clear_cycle_ingest()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='has_role' and pg_get_functiondef(p.oid) ilike '%cycle_id is null%') then
    v_missing_fns := array_append(v_missing_fns, 'app.has_role(workspace-scope)');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='is_member') then
    v_missing_fns := array_append(v_missing_fns, 'app.is_member');
  end if;
  return jsonb_build_object('ok', (cardinality(v_missing_cols)=0 and cardinality(v_missing_fns)=0),
    'migration', '0025', 'missing_columns', to_jsonb(v_missing_cols), 'missing_functions', to_jsonb(v_missing_fns));
end $$;
revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;
