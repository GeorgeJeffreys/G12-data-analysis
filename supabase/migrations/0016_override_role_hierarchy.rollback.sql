-- Rollback for 0016_override_role_hierarchy.sql — restores the 0012 FLAT
-- lead_admin override gate and drops the app.role_of helper. The override RPCs are
-- redefined back to their 0012 bodies verbatim (SAME state mutation, reason rule
-- and audit provenance); only the authorization check reverts to `app.has_role`.

-- Restore override_item_exclusion (0012 body — flat lead_admin gate).
create or replace function public.override_item_exclusion(
  p_item uuid, p_exclude boolean, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_cycle uuid; v_before jsonb; v_prior uuid;
begin
  v_cycle := app.cycle_of_item(p_item);
  if not app.has_role(v_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'an override requires a reason';
  end if;

  select to_jsonb(r), r.reviewer_id into v_before, v_prior
    from item_reviews r where r.item_id = p_item;

  insert into item_reviews (item_id, reviewer_id, exclude, reason, notes, decided_at)
  values (p_item, auth.uid(), p_exclude, p_reason, null, now())
  on conflict (item_id) do update
    set exclude = excluded.exclude, reason = excluded.reason,
        notes = excluded.notes, reviewer_id = auth.uid(), decided_at = now();

  update items set status = case when p_exclude then 'excluded' else 'active' end::item_status
    where id = p_item;

  perform app.audit_override(
    v_cycle, 'override_item_exclusion', 'item', p_item::text, v_before,
    jsonb_build_object('exclude', p_exclude), btrim(p_reason), v_prior);
end $$;

-- Restore override_mark_adjustment (0012 body — flat lead_admin gate).
create or replace function public.override_mark_adjustment(
  p_cycle uuid, p_participant uuid, p_assessment uuid,
  p_new_mark numeric, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v_actor    uuid := auth.uid();
  v_prior    uuid;
  v_existing numeric;
  v_base     numeric;
  v_delta    numeric;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'an override requires a reason';
  end if;
  if v_actor is null then
    raise exception 'override_mark_adjustment requires a signed-in actor (auth.uid() is null)';
  end if;

  select decided_by into v_prior
    from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment
   order by decided_at desc
   limit 1;

  select coalesce(sum(marks), 0) into v_existing
    from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment;

  select coalesce(ps.raw, 0) - v_existing into v_base
    from participant_scores ps
    join score_runs sr on sr.id = ps.score_run_id
   where sr.cycle_id = p_cycle and sr.assessment_id = p_assessment
     and ps.participant_id = p_participant
   order by sr.computed_at desc
   limit 1;
  v_base := coalesce(v_base, 0);

  delete from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment;

  if p_new_mark is null then
    perform app.audit_override(
      p_cycle, 'override_mark_adjustment', 'participant_score',
      p_participant::text || ':' || p_assessment::text,
      jsonb_build_object('delta', v_existing), jsonb_build_object('reverted', true),
      btrim(p_reason), v_prior);
  else
    v_delta := p_new_mark - v_base;
    if v_delta <> 0 then
      insert into alterations (cycle_id, incident_id, apply_to, participant_id, assessment_id, marks, reason, decided_by)
      values (p_cycle, null, 'student', p_participant, p_assessment, v_delta, btrim(p_reason), v_actor);
    end if;
    perform app.audit_override(
      p_cycle, 'override_mark_adjustment', 'participant_score',
      p_participant::text || ':' || p_assessment::text,
      jsonb_build_object('mark', v_base),
      jsonb_build_object('mark', p_new_mark, 'delta', v_delta),
      btrim(p_reason), v_prior);
  end if;
end $$;

drop function if exists app.role_of(uuid, uuid);
