-- ============================================================================
-- G12++ — Test Centre scoping dimension
-- Migration 0010_test_centres.sql
--
-- Introduces TEST CENTRE as a first-class scoping dimension that sits ABOVE the
-- existing year → sitting structure (migration 0005). Each test centre (e.g.
-- "Shatila 1", "Shatila 2") owns its own exam_years; every year keeps its
-- comparable period field (exam_years.name, e.g. "2026") so the SAME year across
-- different centres can be aligned later for cross-centre analytics (P2).
--
--   test_centres ──< exam_years ──< exam_cycles (sittings) ──< results/responses
--
-- In this codebase the task's "cycle" (the grouping that carries a comparable
-- year) is `exam_years`, and the task's "sitting" is `exam_cycles`. So the centre
-- FK lands on exam_years; sittings and every result row inherit the centre
-- IMPLICITLY through the exam_cycles.year_id → exam_years.test_centre_id chain.
-- Nothing is denormalised onto result rows.
--
-- Design summary
--   * New table `test_centres` (name / code / slug / active).
--   * New column `exam_years.test_centre_id` (FK → test_centres.id).
--   * The comparable period field already exists: `exam_years.name` holds the
--     year ("2026"). We add an index on it for cross-centre alignment rather than
--     adding a redundant column that could drift from `name`.
--   * The old `unique (name, region)` on exam_years is replaced by
--     `unique (name, region, test_centre_id)` so two centres can both run a
--     "2026" year (the whole point of the dimension).
--
-- This is a SCOPING / LABELLING change only. The scoring engine, award rule,
-- cut scores and diagnostics are untouched — centre is a partition key, never a
-- grade input. The `items.status` security model (0001) and all existing RLS are
-- preserved: test_centres writes are definer-only, exactly like exam_years.
--
-- Backfill is NON-DESTRUCTIVE: a placeholder "Unassigned" centre is created and
-- every existing year is assigned to it BEFORE the NOT NULL is enforced, so no
-- existing row breaks.
--
-- Reversibility: see `0010_test_centres.rollback.sql`.
--
-- The human runs this in the Supabase SQL editor AFTER 0001–0009. Do not
-- auto-apply.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. test_centres — the new top-level scoping dimension.
--    `code` is a short tag (e.g. "SHA1"); `slug` is route-safe and unique.
--    `active` lets a centre be deactivated (hidden from new work) without
--    deleting its historical years/sittings.
-- ----------------------------------------------------------------------------
create table if not exists test_centres (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null,                         -- short tag, e.g. "SHA1"
  slug        text not null,                         -- route-safe, e.g. "shatila-1"
  region      text not null default 'eu-west',
  active      boolean not null default true,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (code),
  unique (slug)
);

-- ----------------------------------------------------------------------------
-- 2. Link column on exam_years. Nullable for now so the backfill (section 5) is
--    non-destructive; NOT NULL is enforced afterwards. It is NOT in exam_years'
--    client write grants (0005 revoked insert/update/delete entirely), so only
--    the SECURITY DEFINER RPCs below ever set it.
-- ----------------------------------------------------------------------------
alter table exam_years add column if not exists test_centre_id uuid references test_centres(id);

-- ----------------------------------------------------------------------------
-- 3. RLS for test_centres. Readable by any authenticated user (centres are not
--    PII and the centre picker must see every active centre). All writes go
--    through the definer RPCs below — direct client writes are revoked, exactly
--    like exam_years.
--
--    TODO(P3): gate the management mutations (create_test_centre /
--    update_test_centre / set_test_centre_active) to ADMINS only. For now they
--    follow the current config-write pattern (granted to `authenticated`, same
--    as create_exam_year) so leads can manage centres before the admin-lock work.
-- ----------------------------------------------------------------------------
alter table test_centres enable row level security;

create policy test_centres_select on test_centres for select
  using (auth.uid() is not null);

revoke insert, update, delete on test_centres from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 4. Default-centre helper. Returns the "Unassigned" placeholder centre,
--    creating it on first use. Used by the backfill AND by the create RPCs when
--    a caller does not specify a centre (so legacy callers keep working).
-- ----------------------------------------------------------------------------
create or replace function app.default_test_centre()
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  select id into v_id from test_centres where slug = 'unassigned';
  if v_id is null then
    insert into test_centres (name, code, slug, region)
    values ('Unassigned', 'UNAS', 'unassigned', 'eu-west')
    on conflict (slug) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from test_centres where slug = 'unassigned';
    end if;
  end if;
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Backfill — assign every existing year to the placeholder centre, THEN
--    enforce NOT NULL. Runs once; only touches rows whose test_centre_id is
--    still NULL, so re-running is a no-op.
-- ----------------------------------------------------------------------------
do $$
declare v_centre uuid;
begin
  v_centre := app.default_test_centre();
  update exam_years set test_centre_id = v_centre where test_centre_id is null;
end $$;

alter table exam_years alter column test_centre_id set not null;

-- ----------------------------------------------------------------------------
-- 6. Re-key the year uniqueness on the centre. The 0005 `unique (name, region)`
--    would forbid two centres sharing a year ("Shatila 1 / 2026" and
--    "Shatila 2 / 2026"); replace it with a centre-scoped unique so the same
--    period can recur per centre while staying unique WITHIN a centre.
-- ----------------------------------------------------------------------------
alter table exam_years drop constraint if exists exam_years_name_region_key;
alter table exam_years add constraint exam_years_name_region_centre_key
  unique (name, region, test_centre_id);

-- ----------------------------------------------------------------------------
-- 7. Indexes — the centre FK (every per-centre listing filters on it) and the
--    active flag on test_centres. Cross-centre alignment on the comparable
--    period field `name` (P2 analytics) is already served by the leading column
--    of the centre-scoped unique constraint added in section 6
--    (name, region, test_centre_id), so no standalone `name` index is needed.
-- ----------------------------------------------------------------------------
create index if not exists exam_years_test_centre_id_idx on exam_years (test_centre_id);
create index if not exists test_centres_active_idx        on test_centres (active);

-- ----------------------------------------------------------------------------
-- 8. Management RPCs (SECURITY DEFINER — the only way test_centres ever changes,
--    since direct writes are revoked in section 3). Each writes an audit row.
--    See the TODO(P3) above: these are granted to `authenticated` for now.
-- ----------------------------------------------------------------------------

-- create_test_centre: slug derived from the name when not given. Returns the row.
create or replace function public.create_test_centre(
  p_name text, p_code text, p_slug text default null, p_region text default 'eu-west')
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t test_centres; v_slug text;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'name is required'; end if;
  if coalesce(trim(p_code), '') = '' then raise exception 'code is required'; end if;
  v_slug := coalesce(nullif(trim(p_slug), ''),
                     trim(both '-' from lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'))));
  -- Re-raise the raw unique_violation (on code OR slug — including a slug derived
  -- from the name that collides with an existing centre) as a friendly message,
  -- matching the missing-name/code pattern above. This is an admin-facing flow.
  begin
    insert into test_centres (name, code, slug, region)
    values (trim(p_name), trim(p_code), v_slug, p_region)
    returning * into t;
  exception when unique_violation then
    raise exception 'a test centre with code "%" or slug "%" already exists',
      trim(p_code), v_slug;
  end;
  perform app.audit(null, 'create', 'test_centre', t.id::text, null, to_jsonb(t));
  return t;
end $$;

-- update_test_centre: edit name / code / active. NULL args leave a field as-is.
create or replace function public.update_test_centre(
  p_id uuid, p_name text default null, p_code text default null, p_active boolean default null)
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t_before test_centres; t_after test_centres;
begin
  select * into t_before from test_centres where id = p_id;
  if not found then raise exception 'test centre not found'; end if;
  update test_centres set
    name   = coalesce(nullif(trim(p_name), ''), name),
    code   = coalesce(nullif(trim(p_code), ''), code),
    active = coalesce(p_active, active),
    updated_at = now()
  where id = p_id
  returning * into t_after;
  perform app.audit(null, 'update', 'test_centre', p_id::text, to_jsonb(t_before), to_jsonb(t_after));
  return t_after;
end $$;

-- set_test_centre_active: convenience toggle for (de)activation.
create or replace function public.set_test_centre_active(p_id uuid, p_active boolean)
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t test_centres;
begin
  update test_centres set active = p_active, updated_at = now()
    where id = p_id returning * into t;
  if not found then raise exception 'test centre not found'; end if;
  perform app.audit(null, case when p_active then 'activate' else 'deactivate' end,
                    'test_centre', p_id::text, null, to_jsonb(t));
  return t;
end $$;

-- ----------------------------------------------------------------------------
-- 9. Thread the centre through year + cycle creation. Both RPCs gain an optional
--    p_test_centre_id; when NULL they fall back to the placeholder centre so
--    existing callers (and the 0004/0005 signatures' consumers) keep working.
--    The year is now found-or-created WITHIN the centre (name, region, centre).
-- ----------------------------------------------------------------------------

-- Replace the 0005 create_exam_year(text, text) with a centre-aware overload.
drop function if exists public.create_exam_year(text, text);

create or replace function public.create_exam_year(
  p_name text, p_region text default 'eu-west', p_test_centre_id uuid default null)
returns exam_years language plpgsql security definer set search_path = public, app as $$
declare y exam_years; v_centre uuid := coalesce(p_test_centre_id, app.default_test_centre());
begin
  select * into y from exam_years
    where name = p_name and region = p_region and test_centre_id = v_centre;
  if found then return y; end if;
  insert into exam_years (name, region, test_centre_id, created_by)
  values (p_name, p_region, v_centre, auth.uid())
  returning * into y;
  perform app.audit(null, 'create', 'exam_year', y.id::text, null, to_jsonb(y));
  return y;
end $$;

-- Replace the 0005 create_cycle_with_assessments(...) with a centre-aware one.
drop function if exists public.create_cycle_with_assessments(text, text, jsonb, uuid, sitting_period);

create or replace function public.create_cycle_with_assessments(
  p_name text,
  p_region text default 'eu-west',
  p_assessments jsonb default '[]'::jsonb,
  p_year_id uuid default null,
  p_sitting sitting_period default 'may',
  p_test_centre_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  c           exam_cycles;
  rec         jsonb;
  v_name      text;
  v_year_id   uuid := p_year_id;
  v_year_name text;
  v_centre    uuid;
begin
  -- Resolve the year and its centre. The audit payload below records v_centre,
  -- so it must ALWAYS be the year's REAL centre — never a passed-in guess that
  -- could disagree with it. (The audit trail is load-bearing for the Cambridge
  -- check-ins.)
  if v_year_id is null then
    -- New year: resolve the centre (explicit, else placeholder) and
    -- find-or-create the year within it.
    v_centre := coalesce(p_test_centre_id, app.default_test_centre());
    v_year_name := coalesce(substring(p_name from '(?:19|20)\d{2}'),
                            to_char(now(), 'YYYY'));
    select id into v_year_id from exam_years
      where name = v_year_name and region = p_region and test_centre_id = v_centre;
    if v_year_id is null then
      insert into exam_years (name, region, test_centre_id, created_by)
      values (v_year_name, p_region, v_centre, auth.uid())
      returning id into v_year_id;
    end if;
  else
    -- Explicit year: the centre is whatever that year already belongs to.
    select test_centre_id into v_centre from exam_years where id = v_year_id;
    if not found then
      raise exception 'exam year % not found', v_year_id;
    end if;
    -- Passing a year under one centre together with a DIFFERENT centre is a
    -- caller bug: fail loudly rather than silently attaching to the year's centre.
    -- The current UI never reaches this (createCycle passes only p_test_centre_id,
    -- never p_year_id); this guards future callers that pass BOTH — e.g. a re-run
    -- against an existing year, or an admin/bulk import path.
    if p_test_centre_id is not null and p_test_centre_id <> v_centre then
      raise exception 'test_centre_id % conflicts with year %''s centre %',
        p_test_centre_id, v_year_id, v_centre;
    end if;
  end if;

  insert into exam_cycles (name, region, created_by, year_id, sitting)
  values (p_name, p_region, auth.uid(), v_year_id, p_sitting)
  returning * into c;

  insert into memberships (cycle_id, user_id, role)
  values (c.id, auth.uid(), 'lead_admin');

  for rec in select * from jsonb_array_elements(coalesce(p_assessments, '[]'::jsonb)) loop
    v_name := coalesce(trim(rec->>'name'), '');
    if v_name <> '' then
      insert into assessments (cycle_id, name, item_count)
      values (c.id, v_name, coalesce((rec->>'item_count')::int, 0));
    end if;
  end loop;

  perform app.audit(c.id, 'create', 'exam_cycle', c.id::text, null,
                    jsonb_build_object('cycle', to_jsonb(c),
                                       'assessments', coalesce(p_assessments, '[]'::jsonb),
                                       'test_centre_id', v_centre));
  return c.id;
end $$;

-- ----------------------------------------------------------------------------
-- 10. Grants. Each function enforces its own integrity; test_centres columns stay
--     definer-only because direct writes are revoked (section 3).
-- ----------------------------------------------------------------------------
grant execute on function public.create_test_centre(text, text, text, text)     to authenticated;
grant execute on function public.update_test_centre(uuid, text, text, boolean)  to authenticated;
grant execute on function public.set_test_centre_active(uuid, boolean)          to authenticated;
grant execute on function public.create_exam_year(text, text, uuid)             to authenticated;
grant execute on function
  public.create_cycle_with_assessments(text, text, jsonb, uuid, sitting_period, uuid)
to authenticated;

commit;
