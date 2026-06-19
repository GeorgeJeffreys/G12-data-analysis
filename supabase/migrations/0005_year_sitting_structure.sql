-- ============================================================================
-- G12++ — year → sitting structure
-- Migration 0005_year_sitting_structure.sql
--
-- Reframes the core model: an exam cycle is now a full YEAR, and within a year
-- there are two SITTINGS — February and May (resits). Each sitting is a full,
-- independent pipeline run (i.e. exactly what an `exam_cycles` row already is).
-- The year also has an OVERALL view that takes, per student per subject, the
-- higher AWARD across the two sittings.
--
-- Design summary
--   * New parent table `exam_years`. Each existing `exam_cycles` row becomes a
--     SITTING under a year (new columns `year_id` + `sitting`). Nothing about a
--     sitting's pipeline changes — every child table (assessments, items,
--     participants, responses, score_runs, grades, …) still hangs off the same
--     `exam_cycles.id`. This keeps the scoring/engine path byte-for-byte
--     identical (parity stays 183/183).
--   * OVERALL is DERIVED, not stored. It is a pure aggregation of the two
--     sittings' AWARDS (best-of-two by award level), and those awards move every
--     time boundaries / exclusions change. Storing it would duplicate the grades
--     data and create a staleness/sync burden, so we compute it on read. (The
--     rollup itself is implemented in the next prompt; this migration only adds
--     the structure it will read.)
--
-- Mapping applied by this migration (NON-DESTRUCTIVE, see section 5):
--   * For every existing `exam_cycles` row we derive its year from a 4-digit year
--     in its name (fallback: the row's created_at year) and its sitting from the
--     month word in its name (Jan–Apr → february, otherwise → may), find-or-
--     create the matching `exam_years` row (carrying the cycle's region + owner),
--     and link the cycle to it.
--   * Concretely the seeded "May 2026" cycle
--     (3385d4a5-b4c2-5331-a7a9-53a03f3f4869) becomes the MAY sitting of a new
--     "2026" year. No rows are deleted or rewritten beyond setting the two new
--     columns.
--
-- Reversibility: every change here is additive (new table, new nullable columns,
-- new enum, new RPC overload). The companion file
-- `0005_year_sitting_structure.rollback.sql` undoes it with no loss to any of
-- the original 0001–0004 data.
--
-- The human runs this in the Supabase SQL editor AFTER 0001–0004. Do not
-- auto-apply.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Sitting enum
-- ----------------------------------------------------------------------------
do $$ begin
  create type sitting_period as enum ('february','may');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. exam_years — the new parent. A year groups its February + May sittings.
-- ----------------------------------------------------------------------------
create table if not exists exam_years (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                              -- e.g. "2026"
  region      text not null default 'eu-west',
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (name, region)
);

-- ----------------------------------------------------------------------------
-- 3. Link columns on exam_cycles (each cycle is a sitting of a year).
--    Nullable so the migration is non-destructive; section 5 backfills them.
--    They are NOT in exam_cycles' client UPDATE grant (0001), so only the
--    SECURITY DEFINER create RPC (section 6) ever sets them.
-- ----------------------------------------------------------------------------
alter table exam_cycles add column if not exists year_id uuid references exam_years(id);
alter table exam_cycles add column if not exists sitting sitting_period;

-- ----------------------------------------------------------------------------
-- 4. RLS for exam_years. A year is visible to anyone who is a member of one of
--    its sittings (or who created the year). Writes go through the RPCs only.
-- ----------------------------------------------------------------------------
alter table exam_years enable row level security;

create or replace function app.is_year_member(p_year uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from exam_cycles c
    join memberships m on m.cycle_id = c.id
    where c.year_id = p_year and m.user_id = auth.uid()
  ) or exists (
    select 1 from exam_years y
    where y.id = p_year and y.created_by = auth.uid()
  );
$$;

create policy years_select on exam_years for select
  using (app.is_year_member(id));

-- No direct client writes: exam_years is created/edited only via the definer
-- RPCs below (SELECT remains, gated by the policy above).
revoke insert, update, delete on exam_years from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 5. Backfill / mapping — map every existing cycle into a year + sitting.
--    Runs once; only touches rows whose year_id is still NULL, so re-running is
--    a no-op. created_by/region are carried from the cycle so this works when
--    run as the service role (auth.uid() is NULL in the SQL editor).
-- ----------------------------------------------------------------------------
do $$
declare
  c          record;
  v_year     text;
  v_sitting  sitting_period;
  v_year_id  uuid;
begin
  for c in select id, name, region, created_by, created_at
             from exam_cycles where year_id is null loop
    -- year: first 4-digit year in the name, else the created_at year.
    v_year := coalesce(substring(c.name from '(?:19|20)\d{2}'),
                       to_char(c.created_at, 'YYYY'));
    -- sitting: a Jan–Apr month word → february; everything else → may.
    if c.name ~* '\m(jan|feb|mar|apr)' then
      v_sitting := 'february';
    else
      v_sitting := 'may';
    end if;

    select id into v_year_id from exam_years
      where name = v_year and region = c.region;
    if v_year_id is null then
      insert into exam_years (name, region, created_by)
      values (v_year, c.region, c.created_by)
      returning id into v_year_id;
    end if;

    update exam_cycles set year_id = v_year_id, sitting = v_sitting
      where id = c.id;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Create RPCs. `create_exam_year` find-or-creates a year; the cycle-create
--    RPC from 0004 is replaced by an overload that attaches the new sitting to a
--    year (resolving / creating one from the name when not given explicitly).
-- ----------------------------------------------------------------------------
create or replace function public.create_exam_year(
  p_name text, p_region text default 'eu-west')
returns exam_years language plpgsql security definer set search_path = public, app as $$
declare y exam_years;
begin
  select * into y from exam_years where name = p_name and region = p_region;
  if found then return y; end if;
  insert into exam_years (name, region, created_by)
  values (p_name, p_region, auth.uid())
  returning * into y;
  perform app.audit(null, 'create', 'exam_year', y.id::text, null, to_jsonb(y));
  return y;
end $$;

-- Replace the 0004 signature (text, text, jsonb) with one that also takes the
-- year + sitting. Dropping first avoids an ambiguous overload.
drop function if exists public.create_cycle_with_assessments(text, text, jsonb);

create or replace function public.create_cycle_with_assessments(
  p_name text,
  p_region text default 'eu-west',
  p_assessments jsonb default '[]'::jsonb,
  p_year_id uuid default null,
  p_sitting sitting_period default 'may')
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  c           exam_cycles;
  rec         jsonb;
  v_name      text;
  v_year_id   uuid := p_year_id;
  v_year_name text;
begin
  -- Resolve the year: explicit id wins, else find-or-create from the name.
  if v_year_id is null then
    v_year_name := coalesce(substring(p_name from '(?:19|20)\d{2}'),
                            to_char(now(), 'YYYY'));
    select id into v_year_id from exam_years
      where name = v_year_name and region = p_region;
    if v_year_id is null then
      insert into exam_years (name, region, created_by)
      values (v_year_name, p_region, auth.uid())
      returning id into v_year_id;
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
                                       'assessments', coalesce(p_assessments, '[]'::jsonb)));
  return c.id;
end $$;

-- ----------------------------------------------------------------------------
-- 7. Grants for the RPCs (each enforces its own checks; year_id/sitting on
--    exam_cycles stay definer-only because they are not in 0001's UPDATE grant).
-- ----------------------------------------------------------------------------
grant execute on function public.create_exam_year(text, text) to authenticated;
grant execute on function
  public.create_cycle_with_assessments(text, text, jsonb, uuid, sitting_period)
to authenticated;

commit;
