-- ============================================================================
-- 0016 — Incident Adjustments: config registry + import (input/config half, 02a)
--
-- The existing "Technical adjustments" step is being systematised into a rules-
-- based "Incident adjustments" subsystem. This migration adds ONLY the input /
-- configuration surface (02a). It does NOT apply anything to a score — the apply
-- step (02b) still feeds the EXISTING seam: the engine sums `alterations` into a
-- participant's raw total (lib/engine/scores.ts). The parity-locked engine and
-- the `alterations` table are untouched here, so 183/183 parity is unchanged.
--
-- New objects:
--   * incident_codes           — the registry of incident codes + formulae + the
--                                per-incident (per-code) cap. Workspace config.
--   * incident_settings         — singleton: the per-STUDENT global cap.
--   * incident_import_mappings  — singleton: the reconfigurable column mapping.
--   * incident_rows            — parsed incident rows, cycle-scoped, KEYED ON
--                                P-A's stable internal participant id
--                                (participants.qm_participant_id), never the
--                                per-ingest UUID or a non-unique derived key.
--
-- Security follows 0003 exactly: RLS on every table; NO direct client writes;
-- every mutation flows through a SECURITY DEFINER function that role-checks and
-- audits. CONFIG writes are ADMIN ONLY (app.is_workspace_admin); importing rows
-- is a cycle-role action (lead/admin or reviewer), like the incident-log upload.
--
-- ADD-ONLY is enforced at rest: every mark quantity / cap has a CHECK ≥ 0, and a
-- helper validates the formula JSON so a negative grant cannot be stored.
--
-- Run AFTER 0001–0015, once, in the Supabase SQL editor (EU). Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add-only formula validator (immutable → usable in a CHECK constraint).
--    Mirrors lib/incidents/config.ts: fixed | per_duration | pct_section, all
--    grant quantities ≥ 0; per_duration's unit must be > 0; percent 0..100.
-- ----------------------------------------------------------------------------
create or replace function app.incident_formula_add_only(f jsonb)
returns boolean language sql immutable as $$
  select case f->>'kind'
    when 'fixed'        then coalesce((f->>'marks')::numeric, -1) >= 0
    when 'per_duration' then coalesce((f->>'marksPerUnit')::numeric, -1) >= 0
                           and coalesce((f->>'perMinutes')::numeric, 0) > 0
    when 'pct_section'  then coalesce((f->>'percent')::numeric, -1) >= 0
                           and coalesce((f->>'percent')::numeric, 101) <= 100
    else false
  end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Tables. Decision/config columns are never client-writable (section 4);
--    they change only through the SECURITY DEFINER functions in section 5.
-- ----------------------------------------------------------------------------

-- incident_codes — the registry. Each code matches a set of incident types and
-- grants marks via a formula, capped per incident. Workspace-level (not cycle).
create table if not exists incident_codes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  label        text not null,
  match_types  text[] not null default '{}',
  formula      jsonb not null,
  per_code_cap numeric not null,                       -- add-only ceiling / incident
  active       boolean not null default true,
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  constraint incident_codes_cap_nonneg check (per_code_cap >= 0),
  constraint incident_codes_formula_add_only check (app.incident_formula_add_only(formula))
);
-- Code is unique case-insensitively.
create unique index if not exists incident_codes_code_key on incident_codes (lower(code));

-- incident_settings — singleton row holding the per-student GLOBAL cap (the hard
-- ceiling on total incident marks any one student may receive across all codes).
-- NULL cap = no global cap.
create table if not exists incident_settings (
  id              boolean primary key default true,
  per_student_cap numeric,
  updated_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  constraint incident_settings_singleton check (id = true),
  constraint incident_settings_cap_nonneg check (per_student_cap is null or per_student_cap >= 0)
);

-- incident_import_mappings — singleton row holding the reconfigurable column
-- mapping (logical field → file header), so the parser can point at the real
-- file with no code change.
create table if not exists incident_import_mappings (
  id         boolean primary key default true,
  mapping    jsonb not null default '{}',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint incident_import_mappings_singleton check (id = true)
);

-- incident_rows — the parsed + classified incident rows for one cycle. KEYED ON
-- the P-A stable internal participant id (`participant_key` = qm_participant_id);
-- `participant_id` is the resolved cohort UUID (NULL when the row does not match
-- a cohort participant — surfaced, never dropped). `code_id` NULL = the
-- "unclassified" bucket for manual attention.
create table if not exists incident_rows (
  id               uuid primary key default gen_random_uuid(),
  cycle_id         uuid not null references exam_cycles(id) on delete cascade,
  participant_key  text not null,
  participant_id   uuid references participants(id) on delete set null,
  raw_student_id   text,
  student_name     text,
  incident_type    text,
  question_number  text,
  duration_minutes numeric,
  code_id          uuid references incident_codes(id) on delete set null,
  status           text not null default 'ok',          -- ok | unclassified | error
  errors           text[] not null default '{}',
  created_at       timestamptz not null default now(),
  constraint incident_rows_duration_nonneg check (duration_minutes is null or duration_minutes >= 0),
  constraint incident_rows_status_valid check (status in ('ok','unclassified','error'))
);
create index if not exists incident_rows_cycle_idx on incident_rows (cycle_id);
create index if not exists incident_rows_participant_idx on incident_rows (cycle_id, participant_key);

-- ----------------------------------------------------------------------------
-- 3. RLS. Config tables: readable by any signed-in member (lower roles VIEW the
--    config read-only; the UI enforces the same). incident_rows: cycle members.
-- ----------------------------------------------------------------------------
alter table incident_codes           enable row level security;
alter table incident_settings        enable row level security;
alter table incident_import_mappings enable row level security;
alter table incident_rows            enable row level security;

do $$ begin
  create policy incident_codes_select on incident_codes for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy incident_settings_select on incident_settings for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy incident_import_mappings_select on incident_import_mappings for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy incident_rows_select on incident_rows for select using (app.is_member(cycle_id));
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 4. No direct client writes — everything flows through section 5.
-- ----------------------------------------------------------------------------
revoke insert, update, delete on incident_codes           from authenticated, anon;
revoke insert, update, delete on incident_settings        from authenticated, anon;
revoke insert, update, delete on incident_import_mappings from authenticated, anon;
revoke insert, update, delete on incident_rows            from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 5. SECURITY DEFINER transition functions. CONFIG = admin only; each audits.
-- ----------------------------------------------------------------------------

-- Insert or update one incident code (admin only, add-only enforced).
create or replace function public.upsert_incident_code(
  p_id uuid, p_code text, p_label text, p_match_types text[],
  p_formula jsonb, p_per_code_cap numeric, p_active boolean)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app.is_workspace_admin() then
    raise exception 'not authorized';
  end if;
  if coalesce(btrim(p_code), '') = '' or coalesce(btrim(p_label), '') = '' then
    raise exception 'code and label are required';
  end if;
  if p_per_code_cap is null or p_per_code_cap < 0 then
    raise exception 'per-incident cap must be >= 0 (add-only)';
  end if;
  if not app.incident_formula_add_only(p_formula) then
    raise exception 'formula is invalid or not add-only';
  end if;

  if p_id is null then
    insert into incident_codes (code, label, match_types, formula, per_code_cap, active, updated_by)
    values (btrim(p_code), btrim(p_label), coalesce(p_match_types, '{}'), p_formula,
            p_per_code_cap, coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    update incident_codes set
      code = btrim(p_code), label = btrim(p_label), match_types = coalesce(p_match_types, '{}'),
      formula = p_formula, per_code_cap = p_per_code_cap, active = coalesce(p_active, true),
      updated_by = auth.uid(), updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'incident code % not found', p_id; end if;
  end if;

  perform app.audit(null, 'upsert_incident_code', 'incident_code', v_id::text, null,
    jsonb_build_object('code', p_code, 'formula', p_formula, 'per_code_cap', p_per_code_cap, 'active', p_active));
  return v_id;
end $$;

create or replace function public.delete_incident_code(p_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_workspace_admin() then
    raise exception 'not authorized';
  end if;
  delete from incident_codes where id = p_id;
  perform app.audit(null, 'delete_incident_code', 'incident_code', p_id::text, null, null);
end $$;

-- Per-student global cap (admin only). NULL = clear the cap.
create or replace function public.set_incident_settings(p_per_student_cap numeric)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_workspace_admin() then
    raise exception 'not authorized';
  end if;
  if p_per_student_cap is not null and p_per_student_cap < 0 then
    raise exception 'per-student cap must be >= 0 (add-only)';
  end if;
  insert into incident_settings (id, per_student_cap, updated_by, updated_at)
  values (true, p_per_student_cap, auth.uid(), now())
  on conflict (id) do update
    set per_student_cap = excluded.per_student_cap, updated_by = auth.uid(), updated_at = now();
  perform app.audit(null, 'set_incident_settings', 'incident_settings', 'global', null,
    jsonb_build_object('per_student_cap', p_per_student_cap));
end $$;

-- Reconfigurable column mapping (admin only).
create or replace function public.set_incident_mapping(p_mapping jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_workspace_admin() then
    raise exception 'not authorized';
  end if;
  insert into incident_import_mappings (id, mapping, updated_by, updated_at)
  values (true, coalesce(p_mapping, '{}'::jsonb), auth.uid(), now())
  on conflict (id) do update
    set mapping = excluded.mapping, updated_by = auth.uid(), updated_at = now();
  perform app.audit(null, 'set_incident_mapping', 'incident_import_mapping', 'global', null, p_mapping);
end $$;

-- Import parsed incident rows for a cycle (cycle role — lead/admin or reviewer).
-- Replaces the cycle's rows in one call. Resolves the cohort participant from the
-- P-A internal id (participants.qm_participant_id) — never the per-ingest UUID.
-- p_rows: [{ participant_key, raw_student_id, student_name, incident_type,
--            question_number, duration_minutes, code_id, status, errors:[text] }]
create or replace function public.import_incident_rows(p_cycle uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare r jsonb; v_pid uuid;
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from incident_rows where cycle_id = p_cycle;
  for r in select * from jsonb_array_elements(p_rows) loop
    -- Match to a cohort participant on the STABLE internal id, within this cycle.
    select p.id into v_pid from participants p
     where p.cycle_id = p_cycle and p.qm_participant_id = r->>'participant_key'
     limit 1;
    insert into incident_rows (cycle_id, participant_key, participant_id, raw_student_id, student_name,
      incident_type, question_number, duration_minutes, code_id, status, errors)
    values (p_cycle, r->>'participant_key', v_pid, r->>'raw_student_id', r->>'student_name',
      r->>'incident_type', r->>'question_number',
      nullif(r->>'duration_minutes', '')::numeric,
      nullif(r->>'code_id', '')::uuid,
      coalesce(r->>'status', 'ok'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(r->'errors') x), '{}'));
  end loop;
  perform app.audit(p_cycle, 'import_incidents', 'incident_rows', p_cycle::text, null,
    jsonb_build_object('count', jsonb_array_length(p_rows)));
end $$;

create or replace function public.clear_incident_rows(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from incident_rows where cycle_id = p_cycle;
  perform app.audit(p_cycle, 'clear', 'incident_rows', p_cycle::text, null, null);
end $$;

-- ----------------------------------------------------------------------------
-- 6. Grants (callable by signed-in users; each enforces its own role check).
-- ----------------------------------------------------------------------------
grant execute on function
  public.upsert_incident_code(uuid, text, text, text[], jsonb, numeric, boolean),
  public.delete_incident_code(uuid),
  public.set_incident_settings(numeric),
  public.set_incident_mapping(jsonb),
  public.import_incident_rows(uuid, jsonb),
  public.clear_incident_rows(uuid)
to authenticated;
