-- ============================================================================
-- G12++ Exam Processing Suite — schema extension for the current DataProvider
-- Migration 0003_adjustments_essays_config.sql
--
-- 0001 covered the original cycle → review → score → grade → lock surface. The
-- app has since grown the three-component scoring model (MCQ + Essay +
-- Alterations), the Adjustments incident-triage step, the distinction safeguard,
-- per-cycle document settings, and workspace-level configuration (scoring
-- thresholds, grading vocabulary, roles & capabilities, retention, branding,
-- safeguard). This migration adds the backing tables and the SECURITY DEFINER
-- transition functions for all of it, following the exact security pattern of
-- 0001:
--   * RLS on every new table; reads gated by app.is_member.
--   * Decision / computed columns are NEVER directly client-writable — they
--     change only through the SECURITY DEFINER functions below, which run as the
--     table owner and each write an audit row.
--   * The engine's participant_scores writer (missing from 0001) is added here as
--     write_scores, so the server-side engine write path has a privileged RPC.
--
-- Run this AFTER 0001 and 0002, once, in the Supabase SQL editor (see
-- supabase/README.md). Designed for a database that already has 0001/0002.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type incident_source as enum ('incident_log','complaint');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alteration_apply as enum ('student','subject','none');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Tables. Decision columns (marked) are made non-client-writable in section 4
--    and only change through the SECURITY DEFINER functions in section 5.
-- ----------------------------------------------------------------------------

-- essay_marks — offline-marked English/Arabic essays, out of 20, that add to the
-- MCQ total. One row per participant per assessment (subject). Engine input.
create table if not exists essay_marks (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references exam_cycles(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  assessment_id  uuid not null references assessments(id) on delete cascade,
  mark           numeric not null,                 -- out of 20  (DEFINER-written)
  essays_counted integer not null default 1,       -- how many essays were averaged
  file_ref       text,
  decided_by     uuid references auth.users(id),   -- DEFINER-written
  decided_at     timestamptz not null default now(),
  unique (cycle_id, participant_id, assessment_id)
);

-- incidents — the raw, untriaged operational record (incident log + student
-- complaints). Free-text; nothing here alters a mark until triaged below.
create table if not exists incidents (
  id                 uuid primary key default gen_random_uuid(),
  cycle_id           uuid not null references exam_cycles(id) on delete cascade,
  source             incident_source not null,
  student_name       text,
  exam               text,          -- exam code (AM/ST/AFL/ESL) — incident_log
  issue_type         text,
  action_taken       text,
  questions_affected text,
  staff              text,
  email              text,          -- complaint only
  school             text,          -- complaint only
  description        text,          -- complaint only
  created_at         timestamptz not null default now()
);

-- alterations — the human triage decision for an incident: a +/- raw-mark change
-- applied to one student or a whole subject. Engine input; audit-logged.
create table if not exists alterations (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references exam_cycles(id) on delete cascade,
  incident_id    uuid references incidents(id) on delete set null,
  apply_to       alteration_apply not null,        -- DEFINER-written
  participant_id uuid references participants(id) on delete cascade,
  assessment_id  uuid references assessments(id) on delete cascade,
  marks          numeric not null default 0,       -- DEFINER-written (+/-)
  reason         text,
  decided_by     uuid references auth.users(id),   -- DEFINER-written
  decided_at     timestamptz not null default now()
);
create index if not exists alterations_cycle_idx on alterations (cycle_id);
create index if not exists incidents_cycle_idx    on incidents (cycle_id);
create index if not exists essay_marks_cycle_idx  on essay_marks (cycle_id);

-- distinction safeguard — per-cycle "caps confirmed" marker plus the Lead-only
-- overrides that keep a capped student at the top award.
create table if not exists distinction_state (
  cycle_id     uuid primary key references exam_cycles(id) on delete cascade,
  confirmed    boolean not null default false,     -- DEFINER-written
  confirmed_by uuid references auth.users(id),      -- DEFINER-written
  confirmed_at timestamptz
);
create table if not exists distinction_overrides (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references exam_cycles(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  scope          text not null,                    -- assessment_id | 'overall'
  reason         text not null,
  decided_by     uuid references auth.users(id),   -- DEFINER-written
  decided_at     timestamptz not null default now(),
  unique (cycle_id, participant_id, scope)
);

-- document_settings — per-cycle certificate/report settings (test centre, dates).
create table if not exists document_settings (
  cycle_id   uuid primary key references exam_cycles(id) on delete cascade,
  settings   jsonb not null default '{}',          -- DEFINER-written
  updated_at timestamptz not null default now()
);

-- workspace_settings — workspace-level (not cycle-scoped) configuration the app
-- reads as opaque blobs: scoring thresholds, grading vocabulary, roles &
-- capabilities, retention, branding, safeguard, member metadata. One row per
-- key, written only by a workspace lead/admin through set_workspace_setting.
create table if not exists workspace_settings (
  key        text primary key,                     -- DEFINER-written
  value      jsonb not null default '{}',          -- DEFINER-written
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. Helpers + RLS
-- ----------------------------------------------------------------------------

-- Workspace-level admin check: a lead_admin membership with NULL cycle_id (0002)
-- grants workspace-wide rights used for the config/roles surfaces.
create or replace function app.is_workspace_admin()
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.role = 'lead_admin'
      and m.cycle_id is null
  );
$$;

alter table essay_marks            enable row level security;
alter table incidents              enable row level security;
alter table alterations            enable row level security;
alter table distinction_state      enable row level security;
alter table distinction_overrides  enable row level security;
alter table document_settings      enable row level security;
alter table workspace_settings     enable row level security;

-- Cycle-scoped tables: any member of the cycle may read; nobody writes directly
-- (all writes go through the SECURITY DEFINER functions in section 5).
create policy essay_marks_select on essay_marks for select using (app.is_member(cycle_id));
create policy incidents_select on incidents for select using (app.is_member(cycle_id));
create policy alterations_select on alterations for select using (app.is_member(cycle_id));
create policy distinction_state_select on distinction_state for select using (app.is_member(cycle_id));
create policy distinction_overrides_select on distinction_overrides for select using (app.is_member(cycle_id));
create policy document_settings_select on document_settings for select using (app.is_member(cycle_id));

-- workspace_settings: readable by any signed-in member (workspace config drives
-- the whole UI); only a workspace lead/admin writes, via the RPC.
create policy workspace_settings_select on workspace_settings for select
  using (auth.uid() is not null);

-- ----------------------------------------------------------------------------
-- 4. Column privileges — no direct client writes on the new decision/computed
--    tables. Everything flows through section 5's definer functions.
-- ----------------------------------------------------------------------------
revoke insert, update, delete on essay_marks           from authenticated, anon;
revoke insert, update, delete on incidents             from authenticated, anon;
revoke insert, update, delete on alterations           from authenticated, anon;
revoke insert, update, delete on distinction_state     from authenticated, anon;
revoke insert, update, delete on distinction_overrides from authenticated, anon;
revoke insert, update, delete on document_settings     from authenticated, anon;
revoke insert, update, delete on workspace_settings    from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 5. SECURITY DEFINER transition functions. The ONLY way the tables above change.
--    Each performs its own role check and writes an audit row.
-- ----------------------------------------------------------------------------

-- Engine write path: persist a scoring snapshot (score_runs + participant_scores)
-- for a cycle. 0001 had write_item_stats but no scores writer; this is it. Called
-- by the server-side engine write path (lead/admin, or the secret-key server).
-- p_runs: [{ assessment_id, excluded_item_ids:[uuid], scores:[{participant_id, raw, pct, items_seen}] }]
create or replace function public.write_scores(
  p_cycle uuid, p_engine_version text, p_runs jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare run jsonb; sc jsonb; v_run uuid; v_assessment uuid;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  for run in select * from jsonb_array_elements(p_runs) loop
    v_assessment := (run->>'assessment_id')::uuid;
    insert into score_runs (cycle_id, assessment_id, excluded_item_ids, engine_version)
    values (p_cycle, v_assessment,
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(run->'excluded_item_ids') x), '{}'),
            p_engine_version)
    returning id into v_run;
    for sc in select * from jsonb_array_elements(run->'scores') loop
      insert into participant_scores (score_run_id, participant_id, assessment_id, raw, pct, items_seen)
      values (v_run, (sc->>'participant_id')::uuid, v_assessment,
              (sc->>'raw')::numeric, (sc->>'pct')::numeric, (sc->>'items_seen')::integer);
    end loop;
  end loop;
  perform app.audit(p_cycle, 'compute_scores', 'cycle', p_cycle::text, null,
                    jsonb_build_object('engine_version', p_engine_version,
                                       'runs', jsonb_array_length(p_runs)));
end $$;

-- Essay marks (English/Arabic). Replace the cycle's essay marks in one call.
-- p_marks: [{ participant_id, assessment_id, mark, essays_counted }]
create or replace function public.upsert_essay_marks(
  p_cycle uuid, p_file_ref text, p_marks jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare m jsonb;
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from essay_marks where cycle_id = p_cycle;
  for m in select * from jsonb_array_elements(p_marks) loop
    insert into essay_marks (cycle_id, participant_id, assessment_id, mark, essays_counted, file_ref, decided_by)
    values (p_cycle, (m->>'participant_id')::uuid, (m->>'assessment_id')::uuid,
            (m->>'mark')::numeric, coalesce((m->>'essays_counted')::integer, 1), p_file_ref, auth.uid());
  end loop;
  perform app.audit(p_cycle, 'upload', 'essay_marks', p_cycle::text, null,
                    jsonb_build_object('file', p_file_ref, 'count', jsonb_array_length(p_marks)));
end $$;

create or replace function public.clear_essay_marks(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from essay_marks where cycle_id = p_cycle;
  perform app.audit(p_cycle, 'clear', 'essay_marks', p_cycle::text, null, null);
end $$;

-- Incident log import. p_rows: [{ source, student_name, exam, issue_type,
-- action_taken, questions_affected, staff, email, school, description }]
create or replace function public.insert_incidents(p_cycle uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare r jsonb;
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into incidents (cycle_id, source, student_name, exam, issue_type, action_taken,
                           questions_affected, staff, email, school, description)
    values (p_cycle, (r->>'source')::incident_source, r->>'student_name', r->>'exam',
            r->>'issue_type', r->>'action_taken', r->>'questions_affected', r->>'staff',
            r->>'email', r->>'school', r->>'description');
  end loop;
  perform app.audit(p_cycle, 'upload', 'incidents', p_cycle::text, null,
                    jsonb_build_object('count', jsonb_array_length(p_rows)));
end $$;

create or replace function public.clear_incidents(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from alterations where cycle_id = p_cycle and incident_id is not null;
  delete from incidents where cycle_id = p_cycle;
  perform app.audit(p_cycle, 'clear', 'incidents', p_cycle::text, null, null);
end $$;

-- Triage one incident into an alteration (or clear its decision). apply_to='none'
-- or null marks removes any existing alteration for that incident.
create or replace function public.decide_incident(
  p_cycle uuid, p_incident uuid, p_apply_to alteration_apply,
  p_participant uuid, p_assessment uuid, p_marks numeric, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from alterations where cycle_id = p_cycle and incident_id = p_incident;
  if p_apply_to is not null and p_apply_to <> 'none' then
    insert into alterations (cycle_id, incident_id, apply_to, participant_id, assessment_id, marks, reason, decided_by)
    values (p_cycle, p_incident, p_apply_to,
            case when p_apply_to = 'student' then p_participant else null end,
            p_assessment, coalesce(p_marks, 0), p_reason, auth.uid());
  end if;
  perform app.audit(p_cycle, 'decide_incident', 'incident', p_incident::text, null,
                    jsonb_build_object('apply_to', p_apply_to, 'marks', p_marks, 'reason', p_reason));
end $$;

-- Distinction safeguard.
create or replace function public.confirm_distinction_caps(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  insert into distinction_state (cycle_id, confirmed, confirmed_by, confirmed_at)
  values (p_cycle, true, auth.uid(), now())
  on conflict (cycle_id) do update set confirmed = true, confirmed_by = auth.uid(), confirmed_at = now();
  perform app.audit(p_cycle, 'confirm_distinction_caps', 'cycle', p_cycle::text, null, null);
end $$;

create or replace function public.override_distinction_cap(
  p_cycle uuid, p_participant uuid, p_scope text, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'override requires a reason';
  end if;
  insert into distinction_overrides (cycle_id, participant_id, scope, reason, decided_by)
  values (p_cycle, p_participant, p_scope, p_reason, auth.uid())
  on conflict (cycle_id, participant_id, scope) do update
    set reason = excluded.reason, decided_by = auth.uid(), decided_at = now();
  perform app.audit(p_cycle, 'override_distinction', 'participant', p_participant::text, null,
                    jsonb_build_object('scope', p_scope, 'reason', p_reason));
end $$;

create or replace function public.undo_distinction_override(
  p_cycle uuid, p_participant uuid, p_scope text)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from distinction_overrides
    where cycle_id = p_cycle and participant_id = p_participant and scope = p_scope;
  perform app.audit(p_cycle, 'undo_distinction_override', 'participant', p_participant::text, null, null);
end $$;

-- Per-cycle document settings (merged patch).
create or replace function public.set_document_settings(p_cycle uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  insert into document_settings (cycle_id, settings, updated_at)
  values (p_cycle, p_settings, now())
  on conflict (cycle_id) do update
    set settings = document_settings.settings || excluded.settings, updated_at = now();
  perform app.audit(p_cycle, 'set_document_settings', 'cycle', p_cycle::text, null, p_settings);
end $$;

-- Record a document-generation event in the audit log.
create or replace function public.record_documents(p_cycle uuid, p_detail text)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_member(p_cycle) then
    raise exception 'not authorized';
  end if;
  perform app.audit(p_cycle, 'documents', 'cycle', p_cycle::text, null,
                    jsonb_build_object('detail', p_detail));
end $$;

-- Workspace-level configuration blob (scoring/grading/roles/retention/branding/
-- safeguard/members). Workspace lead/admin only.
create or replace function public.set_workspace_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_workspace_admin() then
    raise exception 'not authorized';
  end if;
  insert into workspace_settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform app.audit(null, 'set_workspace_setting', 'workspace', p_key, null, p_value);
end $$;

-- ----------------------------------------------------------------------------
-- 6. Grants (callable by signed-in users; each enforces its own role check).
-- ----------------------------------------------------------------------------
grant execute on function
  public.write_scores(uuid, text, jsonb),
  public.upsert_essay_marks(uuid, text, jsonb),
  public.clear_essay_marks(uuid),
  public.insert_incidents(uuid, jsonb),
  public.clear_incidents(uuid),
  public.decide_incident(uuid, uuid, alteration_apply, uuid, uuid, numeric, text),
  public.confirm_distinction_caps(uuid),
  public.override_distinction_cap(uuid, uuid, text, text),
  public.undo_distinction_override(uuid, uuid, text),
  public.set_document_settings(uuid, jsonb),
  public.record_documents(uuid, text),
  public.set_workspace_setting(text, jsonb)
to authenticated;
