-- ============================================================================
-- G12++ — SITTING DATE: carry the exam date the human picks when creating a
-- sitting, from the picker all the way into the row.
-- Migration 0031_sitting_date.sql
--
-- WHY THIS EXISTS
--   The "Start a new sitting" screen collected a sitting date but it was a dead
--   field: no picker was wired, no RPC parameter carried it, and there was no
--   column to hold it — the value was collected in state and silently dropped.
--   This adds the missing column and threads the date through the create RPC so a
--   picked date is submitted with the sitting and persisted.
--
-- WHAT THIS DOES (additive, non-destructive)
--   1. `exam_cycles.sitting_date date` (nullable) — display/reference only, never
--      a key. Existing rows get NULL; nothing is rewritten.
--   2. Re-affirms `public.create_cycle_with_assessments` with a new trailing
--      `p_sitting_date date default null` parameter, inserted into the new column.
--      The parameter is defaulted so every existing caller keeps working unchanged.
--
-- SCOPE / SAFETY
--   One additive column + one `create or replace function` (added trailing arg).
--   Touches no fact table, no key, no scoring path (183/183 unchanged) and no auth
--   model. Forward-only; reversible via 0031_sitting_date.rollback.sql.
--   Run AFTER 0001–0030 in the Supabase SQL editor (EU).
-- ============================================================================

begin;

set local lock_timeout = '30s';

-- ----------------------------------------------------------------------------
-- 1. The date column (nullable, additive).
-- ----------------------------------------------------------------------------
alter table public.exam_cycles
  add column if not exists sitting_date date;

comment on column public.exam_cycles.sitting_date is
  '0031 — the exam date chosen when the sitting was created. Display/reference only; never a key.';

-- ----------------------------------------------------------------------------
-- 2. Thread the date through the create RPC. New trailing `p_sitting_date`
--    parameter (defaulted, so existing calls are unaffected). Body is otherwise
--    identical to 0010 — only the sitting_date insert is added.
-- ----------------------------------------------------------------------------
-- Drop the prior 6-arg signature so the date-carrying version is the ONLY overload
-- (a new trailing arg makes a distinct signature; without this both would coexist).
drop function if exists public.create_cycle_with_assessments(
  text, text, jsonb, uuid, sitting_period, uuid);

create or replace function public.create_cycle_with_assessments(
  p_name text,
  p_region text default 'eu-west',
  p_assessments jsonb default '[]'::jsonb,
  p_year_id uuid default null,
  p_sitting sitting_period default 'may',
  p_test_centre_id uuid default null,
  p_sitting_date date default null)
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
    if p_test_centre_id is not null and p_test_centre_id <> v_centre then
      raise exception 'test_centre_id % conflicts with year %''s centre %',
        p_test_centre_id, v_year_id, v_centre;
    end if;
  end if;

  insert into exam_cycles (name, region, created_by, year_id, sitting, sitting_date)
  values (p_name, p_region, auth.uid(), v_year_id, p_sitting, p_sitting_date)
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

grant execute on function public.create_cycle_with_assessments(
  text, text, jsonb, uuid, sitting_period, uuid, date) to authenticated;

commit;
