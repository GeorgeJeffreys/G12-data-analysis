-- ============================================================================
-- ROLLBACK for 0005_year_sitting_structure.sql
--
-- Reverses the year → sitting structure with NO loss to the original 0001–0004
-- data. Every change in 0005 was additive, so undoing it only removes the new
-- table / columns / enum / RPC overload and restores the 0004 cycle-create RPC.
-- The exam_cycles rows and all their children (assessments, items, participants,
-- responses, score_runs, grades, …) are untouched.
--
-- Run this whole file once in the Supabase SQL editor to undo migration 0005.
-- ============================================================================

begin;

-- 1. Restore the 0004 cycle-create RPC signature, then drop the 0005 overload.
drop function if exists
  public.create_cycle_with_assessments(text, text, jsonb, uuid, sitting_period);
drop function if exists public.create_exam_year(text, text);

create or replace function public.create_cycle_with_assessments(
  p_name text, p_region text default 'eu-west', p_assessments jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare c exam_cycles; rec jsonb; v_name text;
begin
  insert into exam_cycles (name, region, created_by)
  values (p_name, p_region, auth.uid())
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

grant execute on function public.create_cycle_with_assessments(text, text, jsonb)
  to authenticated;

-- 2. Drop the sitting link columns on exam_cycles (the cycles themselves stay).
alter table exam_cycles drop column if exists sitting;
alter table exam_cycles drop column if exists year_id;

-- 3. Drop the year table + its membership helper, then the enum.
drop policy if exists years_select on exam_years;
drop table if exists exam_years;
drop function if exists app.is_year_member(uuid);
drop type if exists sitting_period;

commit;
