-- ============================================================================
-- Rollback for 0031_sitting_date.sql
--   Restores the 6-arg create_cycle_with_assessments (no sitting_date) and drops
--   the column. Run in the Supabase SQL editor (EU) to reverse 0031.
-- ============================================================================

begin;

set local lock_timeout = '30s';

-- Drop the 7-arg (date-carrying) signature and restore the 0010 6-arg body.
drop function if exists public.create_cycle_with_assessments(
  text, text, jsonb, uuid, sitting_period, uuid, date);

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
  if v_year_id is null then
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
    select test_centre_id into v_centre from exam_years where id = v_year_id;
    if not found then
      raise exception 'exam year % not found', v_year_id;
    end if;
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

grant execute on function public.create_cycle_with_assessments(
  text, text, jsonb, uuid, sitting_period, uuid) to authenticated;

alter table public.exam_cycles drop column if exists sitting_date;

commit;
