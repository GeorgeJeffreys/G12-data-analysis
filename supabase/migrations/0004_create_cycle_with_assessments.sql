-- ============================================================================
-- 0004 — create a cycle together with its chosen assessments, atomically.
--
-- The original create_cycle(text, text) only inserts the exam_cycles row and
-- the creator's lead_admin membership. The new-cycle screen lets a lead pick
-- which of the canonical G12++ subjects the sitting contains, so we need to
-- persist those assessment rows in the same call (one audited transaction) and
-- hand the caller back the new cycle id to navigate to.
--
-- p_assessments is a jsonb array of { "name": text }. Empty/null is allowed
-- (assessments can be added later when their raw export is uploaded).
-- ============================================================================

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
