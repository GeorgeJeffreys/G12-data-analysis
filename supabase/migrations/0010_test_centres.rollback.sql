-- ============================================================================
-- Rollback for 0010_test_centres.sql
--
-- Undoes the Test Centre dimension with no loss to any 0001–0009 data:
--   * Restores the 0005 create_exam_year / create_cycle_with_assessments
--     signatures (centre-unaware).
--   * Restores exam_years' unique (name, region) and drops the centre FK column,
--     indexes and the test_centres table + its RPCs.
--
-- Run in the Supabase SQL editor to revert.
--
-- !!  CLEAN REVERT IS ONLY POSSIBLE IMMEDIATELY POST-APPLY  !!
-- This rollback restores exam_years' unique (name, region), which REJECTS two
-- years that share a name+region. Right after 0010 the backfill has put every
-- existing year under the single "Unassigned" placeholder, so the live data
-- satisfies that and the revert is clean. But the WHOLE POINT of this feature is
-- the intended Shatila 1/2026 + Shatila 2/2026 state — two centres sharing a
-- period. The moment a second centre owns an overlapping year, dropping the
-- centre column collapses those rows to a duplicate (name, region) and the
-- `add constraint ... unique (name, region)` below WILL FAIL. Reverting from
-- that point on is NOT a no-questions undo: it requires manual data surgery
-- (merge/relabel/delete the colliding years) before this script can complete.
-- ============================================================================

begin;

-- 1. Drop the centre-aware RPC overloads and the helper.
drop function if exists public.create_cycle_with_assessments(text, text, jsonb, uuid, sitting_period, uuid);
drop function if exists public.create_exam_year(text, text, uuid);
drop function if exists public.create_test_centre(text, text, text, text);
drop function if exists public.update_test_centre(uuid, text, text, boolean);
drop function if exists public.set_test_centre_active(uuid, boolean);
drop function if exists app.default_test_centre();

-- 2. Restore the centre-scoped year uniqueness back to (name, region).
alter table exam_years drop constraint if exists exam_years_name_region_centre_key;

-- 3. Drop the indexes and the FK column (dropping the column removes the FK to
--    test_centres and its NOT NULL).
drop index if exists exam_years_test_centre_id_idx;
drop index if exists test_centres_active_idx;
alter table exam_years drop column if exists test_centre_id;

alter table exam_years add constraint exam_years_name_region_key unique (name, region);

-- 4. Drop the table.
drop table if exists test_centres;

-- 5. Restore the 0005 create_exam_year(text, text).
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

-- 6. Restore the 0005 create_cycle_with_assessments(text, text, jsonb, uuid, sitting_period).
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

grant execute on function public.create_exam_year(text, text) to authenticated;
grant execute on function
  public.create_cycle_with_assessments(text, text, jsonb, uuid, sitting_period)
to authenticated;

commit;
