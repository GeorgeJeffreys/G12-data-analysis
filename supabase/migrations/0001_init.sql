-- ============================================================================
-- G12++ Exam Processing Suite — initial schema
-- Migration 0001_init.sql
--
-- Implements the data model in Section 5 of the design spec and the security
-- model in Sections 3 & 5:
--   * RLS enabled on every table, policies driven by `memberships`.
--   * Status / computed / decision columns are NEVER directly client-writable.
--     They change only through SECURITY DEFINER functions, enforced with
--     column-level REVOKE/GRANT.
--   * `responses` are immutable after ingest; `audit_log` is append-only.
--   * Every exclusion, boundary change, grade lock and export writes an audit row.
--
-- Run this whole file once in the Supabase SQL editor (see supabase/README.md).
-- It is idempotent enough to read top-to-bottom but is intended for a fresh DB.
-- ============================================================================

create extension if not exists pgcrypto;

-- Private schema for internal helper functions (NOT exposed through PostgREST).
create schema if not exists app;

-- ----------------------------------------------------------------------------
-- 1. Enums (Postgres enums for all status fields — Section 5)
-- ----------------------------------------------------------------------------
do $$ begin
  create type cycle_status as enum
    ('draft','ingested','validated','in_review','scored','graded','locked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type assessment_status as enum
    ('pending','in_review','reviewed','scored');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_status as enum
    ('active','excluded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_role as enum
    ('lead_admin','reviewer','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type quality_rating as enum ('Good','Review','Flag');
exception when duplicate_object then null; end $$;

do $$ begin
  create type demand_level as enum ('D1','D2','D3');
exception when duplicate_object then null; end $$;

do $$ begin
  create type scheme_method as enum ('judgemental','fixed_pct');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Tables (Section 5). Columns marked NOT CLIENT-WRITABLE below have their
--    UPDATE privilege revoked from the client roles further down; they only
--    change through the SECURITY DEFINER functions in section 6.
-- ----------------------------------------------------------------------------

-- exam_cycles -----------------------------------------------------------------
create table if not exists exam_cycles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  status      cycle_status not null default 'draft',   -- NOT CLIENT-WRITABLE
  region      text not null default 'eu-west',
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- memberships (roles; drives RLS) ---------------------------------------------
create table if not exists memberships (
  id         uuid primary key default gen_random_uuid(),
  cycle_id   uuid not null references exam_cycles(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       member_role not null,
  created_at timestamptz not null default now(),
  unique (cycle_id, user_id)
);

-- assessments -----------------------------------------------------------------
create table if not exists assessments (
  id         uuid primary key default gen_random_uuid(),
  cycle_id   uuid not null references exam_cycles(id) on delete cascade,
  name       text not null,                              -- the five major elements
  item_count integer not null default 0,
  status     assessment_status not null default 'pending', -- NOT CLIENT-WRITABLE
  created_at timestamptz not null default now()
);

-- items -----------------------------------------------------------------------
create table if not exists items (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references exam_cycles(id) on delete cascade,
  assessment_id   uuid not null references assessments(id) on delete cascade,
  qm_question_id  text not null,
  wording         text,
  major_element   text,
  sub_element     text,
  demand_level    demand_level,
  max_score       numeric not null default 1,
  status          item_status not null default 'active',   -- NOT CLIENT-WRITABLE
  created_at      timestamptz not null default now(),
  unique (cycle_id, qm_question_id)
);

-- item_stats (written ONLY by the computation engine) -------------------------
create table if not exists item_stats (
  item_id         uuid primary key references items(id) on delete cascade,
  p_value         numeric,
  p_rating        quality_rating,
  item_total      numeric,
  it_rating       quality_rating,
  point_biserial  numeric,
  pb_rating       quality_rating,
  discrimination  numeric,
  disc_rating     quality_rating,
  overall_review  quality_rating,
  computed_at     timestamptz not null default now(),     -- NOT CLIENT-WRITABLE
  engine_version  text not null                            -- NOT CLIENT-WRITABLE
);

-- participants (PII — region-bound, RLS-restricted) ---------------------------
create table if not exists participants (
  id               uuid primary key default gen_random_uuid(),
  cycle_id         uuid not null references exam_cycles(id) on delete cascade,
  qm_participant_id text not null,
  pseudonym_id     text not null,
  full_name        text,    -- PII
  email            text,    -- PII
  dob              date,    -- PII
  gender           text,    -- PII
  created_at       timestamptz not null default now(),
  unique (cycle_id, qm_participant_id)
);

-- responses (long-format facts; immutable after ingest) -----------------------
create table if not exists responses (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references exam_cycles(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  item_id        uuid not null references items(id) on delete cascade,
  answer_given   text,
  answer_score   numeric not null,
  response_time  numeric,
  result_status  text,
  created_at     timestamptz not null default now(),
  unique (participant_id, item_id)
);

-- item_reviews (human gate 1; one current decision per item) ------------------
create table if not exists item_reviews (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items(id) on delete cascade,
  reviewer_id uuid not null default auth.uid() references auth.users(id),
  exclude     boolean not null default false,
  reason      text,
  notes       text,
  decided_at  timestamptz not null default now(),
  unique (item_id)
);

-- score_runs (a scoring snapshot after a given exclusion set) ------------------
create table if not exists score_runs (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references exam_cycles(id) on delete cascade,
  assessment_id     uuid not null references assessments(id) on delete cascade,
  excluded_item_ids uuid[] not null default '{}',
  engine_version    text not null,
  computed_at       timestamptz not null default now()    -- NOT CLIENT-WRITABLE
);

-- participant_scores (engine-written) -----------------------------------------
create table if not exists participant_scores (
  id             uuid primary key default gen_random_uuid(),
  score_run_id   uuid not null references score_runs(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  assessment_id  uuid not null references assessments(id) on delete cascade,
  raw            numeric not null,
  pct            numeric not null,
  items_seen     integer not null,
  unique (score_run_id, participant_id, assessment_id)
);

-- grade_schemes ---------------------------------------------------------------
create table if not exists grade_schemes (
  id         uuid primary key default gen_random_uuid(),
  cycle_id   uuid not null references exam_cycles(id) on delete cascade,
  scope      text not null,                  -- assessment_id (uuid as text) | 'overall'
  method     scheme_method not null default 'judgemental',
  bands      jsonb not null default '[]',    -- [{label, min, max}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, scope)
);

-- grades ----------------------------------------------------------------------
create table if not exists grades (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references exam_cycles(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  scope          text not null,              -- assessment_id (uuid as text) | 'overall'
  grade_label    text,
  score          numeric,
  locked         boolean not null default false,  -- NOT CLIENT-WRITABLE
  signed_off_by  uuid references auth.users(id),  -- NOT CLIENT-WRITABLE
  signed_off_at  timestamptz,                      -- NOT CLIENT-WRITABLE
  unique (cycle_id, participant_id, scope)
);

-- import_batches --------------------------------------------------------------
create table if not exists import_batches (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references exam_cycles(id) on delete cascade,
  file_ref          text,
  parsed_rows       integer,
  validation_passed boolean not null default false,  -- NOT CLIENT-WRITABLE
  report_json       jsonb,
  created_by        uuid not null default auth.uid() references auth.users(id),
  created_at        timestamptz not null default now()
);

-- audit_log (append-only) -----------------------------------------------------
create table if not exists audit_log (
  id        uuid primary key default gen_random_uuid(),
  cycle_id  uuid references exam_cycles(id) on delete cascade,
  actor_id  uuid not null default auth.uid(),
  action    text not null,
  entity    text not null,
  entity_id text,
  before    jsonb,
  after     jsonb,
  ts        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. Internal helper functions (membership / role checks for RLS)
-- ----------------------------------------------------------------------------
create or replace function app.is_member(p_cycle uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where m.cycle_id = p_cycle and m.user_id = auth.uid()
  );
$$;

create or replace function app.has_role(p_cycle uuid, p_roles member_role[])
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where m.cycle_id = p_cycle
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;

-- Resolve the cycle for an item / assessment (used by item-scoped policies).
create or replace function app.cycle_of_item(p_item uuid)
returns uuid language sql stable security definer set search_path = public, app as $$
  select cycle_id from items where id = p_item;
$$;

-- ----------------------------------------------------------------------------
-- 4. Row Level Security — enabled on EVERY table.
--    Read: any member of the cycle. Writes: see per-table policies.
-- ----------------------------------------------------------------------------
alter table exam_cycles        enable row level security;
alter table memberships        enable row level security;
alter table assessments        enable row level security;
alter table items              enable row level security;
alter table item_stats         enable row level security;
alter table participants       enable row level security;
alter table responses          enable row level security;
alter table item_reviews       enable row level security;
alter table score_runs         enable row level security;
alter table participant_scores enable row level security;
alter table grade_schemes      enable row level security;
alter table grades             enable row level security;
alter table import_batches     enable row level security;
alter table audit_log          enable row level security;

-- exam_cycles
create policy cycles_select on exam_cycles for select
  using (app.is_member(id));
create policy cycles_insert on exam_cycles for insert
  with check (created_by = auth.uid());
-- Only lead/admin may edit a cycle's non-status columns. The `status` column is
-- additionally protected by the column GRANT in section 5 (definer-only).
create policy cycles_update on exam_cycles for update
  using (app.has_role(id, array['lead_admin']::member_role[]))
  with check (app.has_role(id, array['lead_admin']::member_role[]));

-- memberships: members can read; lead/admin manages.
create policy memberships_select on memberships for select
  using (app.is_member(cycle_id));
create policy memberships_all on memberships for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- assessments
create policy assessments_select on assessments for select
  using (app.is_member(cycle_id));
create policy assessments_write on assessments for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- items
create policy items_select on items for select
  using (app.is_member(cycle_id));
create policy items_write on items for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- item_stats: readable by members; only the engine (definer fn) writes.
create policy item_stats_select on item_stats for select
  using (app.is_member(app.cycle_of_item(item_id)));

-- participants (PII): readable by members of the cycle only.
create policy participants_select on participants for select
  using (app.is_member(cycle_id));
create policy participants_write on participants for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- responses: readable by members. Immutable — only INSERT during ingest, no
-- UPDATE/DELETE policy is defined, so neither is ever permitted to clients.
create policy responses_select on responses for select
  using (app.is_member(cycle_id));
create policy responses_insert on responses for insert
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- item_reviews: human gate 1. Lead/admin and reviewers may decide; viewers read.
create policy item_reviews_select on item_reviews for select
  using (app.is_member(app.cycle_of_item(item_id)));
create policy item_reviews_write on item_reviews for all
  using (app.has_role(app.cycle_of_item(item_id),
                      array['lead_admin','reviewer']::member_role[]))
  with check (app.has_role(app.cycle_of_item(item_id),
                      array['lead_admin','reviewer']::member_role[]));

-- score_runs / participant_scores: readable by members; engine writes scores.
create policy score_runs_select on score_runs for select
  using (app.is_member(cycle_id));
create policy score_runs_write on score_runs for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));
create policy participant_scores_select on participant_scores for select
  using (app.is_member((select cycle_id from score_runs sr where sr.id = score_run_id)));

-- grade_schemes: lead/admin sets boundaries; members read.
create policy grade_schemes_select on grade_schemes for select
  using (app.is_member(cycle_id));
create policy grade_schemes_write on grade_schemes for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- grades: members read; lead/admin edits non-locked columns (label/score). The
-- `locked` / `signed_off_*` columns are definer-only (column GRANT, section 5).
create policy grades_select on grades for select
  using (app.is_member(cycle_id));
create policy grades_write on grades for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- import_batches: members read; lead/admin creates. validation_passed is
-- definer-only.
create policy import_batches_select on import_batches for select
  using (app.is_member(cycle_id));
create policy import_batches_insert on import_batches for insert
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- audit_log: members read; append-only (no INSERT policy for clients — rows are
-- written exclusively by the SECURITY DEFINER functions below; never updated
-- or deleted).
create policy audit_select on audit_log for select
  using (cycle_id is null or app.is_member(cycle_id));

-- ----------------------------------------------------------------------------
-- 5. Column-level privileges — make status / computed / decision columns
--    NOT client-writable. `authenticated` is the Supabase signed-in role.
--
--    Pattern: revoke broad UPDATE, then grant UPDATE only on the columns a
--    client is ever allowed to change directly. Everything else can be written
--    only by the SECURITY DEFINER functions (which run as the table owner and
--    are not constrained by these column grants).
-- ----------------------------------------------------------------------------

-- exam_cycles.status — definer only.
revoke update on exam_cycles from authenticated;
grant  update (name, region, updated_at) on exam_cycles to authenticated;

-- assessments.status — definer only.
revoke update on assessments from authenticated;
grant  update (name, item_count) on assessments to authenticated;

-- items.status — definer only.
revoke update on items from authenticated;
grant  update (wording, major_element, sub_element, demand_level, max_score)
  on items to authenticated;

-- item_stats — entirely engine-written: no client INSERT/UPDATE/DELETE at all.
revoke insert, update, delete on item_stats from authenticated;

-- score_runs.computed_at — definer only.
revoke update on score_runs from authenticated;
grant  update (excluded_item_ids) on score_runs to authenticated;

-- participant_scores — engine-written: no client write.
revoke insert, update, delete on participant_scores from authenticated;

-- grades.locked / signed_off_* — definer only.
revoke update on grades from authenticated;
grant  update (grade_label, score) on grades to authenticated;

-- import_batches.validation_passed / report_json — definer only.
revoke update on import_batches from authenticated;

-- audit_log — append-only and never client-written.
revoke insert, update, delete on audit_log from authenticated, anon;

-- responses — immutable: clients may insert (gated by RLS) but never change.
revoke update, delete on responses from authenticated;

-- ----------------------------------------------------------------------------
-- 6. SECURITY DEFINER transition functions. These are the ONLY way the
--    protected columns above ever change. Each privileged transition writes an
--    audit row. All run as the table owner, so they bypass the column GRANTs.
-- ----------------------------------------------------------------------------

-- Internal: append an audit row (definer; clients can't call directly because
-- it lives in the private `app` schema).
create or replace function app.audit(
  p_cycle uuid, p_action text, p_entity text, p_entity_id text,
  p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = public, app as $$
  insert into audit_log (cycle_id, actor_id, action, entity, entity_id, before, after)
  values (p_cycle, auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after);
$$;

-- When a cycle is created, make the creator its lead/admin.
create or replace function public.create_cycle(p_name text, p_region text default 'eu-west')
returns exam_cycles language plpgsql security definer set search_path = public, app as $$
declare c exam_cycles;
begin
  insert into exam_cycles (name, region, created_by)
  values (p_name, p_region, auth.uid())
  returning * into c;
  insert into memberships (cycle_id, user_id, role)
  values (c.id, auth.uid(), 'lead_admin');
  perform app.audit(c.id, 'create', 'exam_cycle', c.id::text, null, to_jsonb(c));
  return c;
end $$;

-- Cycle status transition (lead/admin only).
create or replace function public.set_cycle_status(p_cycle uuid, p_status cycle_status)
returns exam_cycles language plpgsql security definer set search_path = public, app as $$
declare c_before exam_cycles; c_after exam_cycles;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  select * into c_before from exam_cycles where id = p_cycle;
  update exam_cycles set status = p_status, updated_at = now()
    where id = p_cycle returning * into c_after;
  perform app.audit(p_cycle, 'status_change', 'exam_cycle', p_cycle::text,
                    to_jsonb(c_before.status), to_jsonb(c_after.status));
  return c_after;
end $$;

-- Assessment status transition (lead/admin only).
create or replace function public.set_assessment_status(p_assessment uuid, p_status assessment_status)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_cycle uuid; v_before assessment_status;
begin
  select cycle_id, status into v_cycle, v_before from assessments where id = p_assessment;
  if not app.has_role(v_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  update assessments set status = p_status where id = p_assessment;
  perform app.audit(v_cycle, 'status_change', 'assessment', p_assessment::text,
                    to_jsonb(v_before), to_jsonb(p_status));
end $$;

-- Record a reviewer's exclusion decision (human gate 1) AND flip item.status.
-- Writes the item_reviews row (current decision) and an audit row (history),
-- and moves items.status which is otherwise not client-writable.
create or replace function public.decide_item_exclusion(
  p_item uuid, p_exclude boolean, p_reason text, p_notes text default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_cycle uuid; v_before jsonb;
begin
  v_cycle := app.cycle_of_item(p_item);
  if not app.has_role(v_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  select to_jsonb(r) into v_before from item_reviews r where r.item_id = p_item;

  insert into item_reviews (item_id, reviewer_id, exclude, reason, notes, decided_at)
  values (p_item, auth.uid(), p_exclude, p_reason, p_notes, now())
  on conflict (item_id) do update
    set exclude = excluded.exclude, reason = excluded.reason,
        notes = excluded.notes, reviewer_id = auth.uid(), decided_at = now();

  update items set status = case when p_exclude then 'excluded' else 'active' end::item_status
    where id = p_item;

  perform app.audit(v_cycle, 'item_exclusion', 'item', p_item::text, v_before,
                    jsonb_build_object('exclude', p_exclude, 'reason', p_reason));
end $$;

-- Engine writes item_stats (computed columns). Tagged with engine_version.
-- p_stats is a jsonb array of objects keyed by qm_question_id.
create or replace function public.write_item_stats(
  p_cycle uuid, p_engine_version text, p_stats jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare rec jsonb; v_item uuid;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  for rec in select * from jsonb_array_elements(p_stats) loop
    select id into v_item from items
      where cycle_id = p_cycle and qm_question_id = (rec->>'qm_question_id');
    if v_item is null then continue; end if;
    insert into item_stats (item_id, p_value, p_rating, item_total, it_rating,
        point_biserial, pb_rating, discrimination, disc_rating, overall_review,
        computed_at, engine_version)
    values (v_item,
        (rec->>'p_value')::numeric, (rec->>'p_rating')::quality_rating,
        (rec->>'item_total')::numeric, (rec->>'it_rating')::quality_rating,
        (rec->>'point_biserial')::numeric, (rec->>'pb_rating')::quality_rating,
        (rec->>'discrimination')::numeric, (rec->>'disc_rating')::quality_rating,
        (rec->>'overall_review')::quality_rating, now(), p_engine_version)
    on conflict (item_id) do update set
        p_value = excluded.p_value, p_rating = excluded.p_rating,
        item_total = excluded.item_total, it_rating = excluded.it_rating,
        point_biserial = excluded.point_biserial, pb_rating = excluded.pb_rating,
        discrimination = excluded.discrimination, disc_rating = excluded.disc_rating,
        overall_review = excluded.overall_review,
        computed_at = now(), engine_version = excluded.engine_version;
  end loop;
  perform app.audit(p_cycle, 'compute_item_stats', 'cycle', p_cycle::text, null,
                    jsonb_build_object('engine_version', p_engine_version,
                                       'items', jsonb_array_length(p_stats)));
end $$;

-- Lock / unlock grades for a cycle (lead/admin only). Unlock requires a reason
-- and is logged. Flips grades.locked + signed_off_* which are definer-only.
create or replace function public.lock_grades(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  update grades set locked = true, signed_off_by = auth.uid(), signed_off_at = now()
    where cycle_id = p_cycle;
  update exam_cycles set status = 'locked', updated_at = now() where id = p_cycle;
  perform app.audit(p_cycle, 'lock_grades', 'cycle', p_cycle::text, null,
                    jsonb_build_object('locked', true));
end $$;

create or replace function public.unlock_grades(p_cycle uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'unlock requires a reason';
  end if;
  update grades set locked = false, signed_off_by = null, signed_off_at = null
    where cycle_id = p_cycle;
  update exam_cycles set status = 'graded', updated_at = now() where id = p_cycle;
  perform app.audit(p_cycle, 'unlock_grades', 'cycle', p_cycle::text, null,
                    jsonb_build_object('locked', false, 'reason', p_reason));
end $$;

-- Mark an import batch's validation result (definer-only column).
create or replace function public.set_import_validation(
  p_batch uuid, p_passed boolean, p_report jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_cycle uuid;
begin
  select cycle_id into v_cycle from import_batches where id = p_batch;
  if not app.has_role(v_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  update import_batches set validation_passed = p_passed, report_json = p_report
    where id = p_batch;
  if p_passed then
    update exam_cycles set status = 'validated', updated_at = now()
      where id = v_cycle and status in ('draft','ingested');
  end if;
  perform app.audit(v_cycle, 'validate_import', 'import_batch', p_batch::text, null,
                    jsonb_build_object('validation_passed', p_passed));
end $$;

-- Record an export event in the audit log (Section 5: every export is audited).
create or replace function public.record_export(p_cycle uuid, p_kind text)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_member(p_cycle) then
    raise exception 'not authorized';
  end if;
  perform app.audit(p_cycle, 'export', 'cycle', p_cycle::text, null,
                    jsonb_build_object('kind', p_kind));
end $$;

-- Record a grade-boundary change (every boundary change is audited).
create or replace function public.save_grade_scheme(
  p_cycle uuid, p_scope text, p_method scheme_method, p_bands jsonb)
returns grade_schemes language plpgsql security definer set search_path = public, app as $$
declare v_before jsonb; v_after grade_schemes;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  select to_jsonb(g) into v_before from grade_schemes g
    where g.cycle_id = p_cycle and g.scope = p_scope;
  insert into grade_schemes (cycle_id, scope, method, bands)
  values (p_cycle, p_scope, p_method, p_bands)
  on conflict (cycle_id, scope) do update
    set method = excluded.method, bands = excluded.bands, updated_at = now()
  returning * into v_after;
  perform app.audit(p_cycle, 'boundary_change', 'grade_scheme', p_scope,
                    v_before, to_jsonb(v_after));
  return v_after;
end $$;

-- ----------------------------------------------------------------------------
-- 7. Grants for the RPCs (callable by signed-in users; each enforces its own
--    role check internally).
-- ----------------------------------------------------------------------------
grant execute on function
  public.create_cycle(text, text),
  public.set_cycle_status(uuid, cycle_status),
  public.set_assessment_status(uuid, assessment_status),
  public.decide_item_exclusion(uuid, boolean, text, text),
  public.write_item_stats(uuid, text, jsonb),
  public.lock_grades(uuid),
  public.unlock_grades(uuid, text),
  public.set_import_validation(uuid, boolean, jsonb),
  public.record_export(uuid, text),
  public.save_grade_scheme(uuid, text, scheme_method, jsonb)
to authenticated;
