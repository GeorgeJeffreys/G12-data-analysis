-- Rollback for 0016_clean_exclusions_stable_key.sql
-- Restore the 0008 signature of set_clean_removal and drop the stable-key column.
drop function if exists public.set_clean_removal(uuid, uuid, text, uuid[], text[], boolean);

create or replace function public.set_clean_removal(
  p_cycle uuid, p_assessment uuid, p_kind text, p_targets uuid[], p_remove boolean)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_target uuid;
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if p_kind not in ('row', 'col') then
    raise exception 'invalid kind %', p_kind;
  end if;
  if p_remove then
    foreach v_target in array coalesce(p_targets, array[]::uuid[]) loop
      insert into clean_exclusions (cycle_id, assessment_id, kind, target_id, decided_by)
      values (p_cycle, p_assessment, p_kind, v_target, auth.uid())
      on conflict (cycle_id, assessment_id, kind, target_id) do nothing;
    end loop;
  else
    delete from clean_exclusions
      where cycle_id = p_cycle and assessment_id = p_assessment
        and kind = p_kind and target_id = any(coalesce(p_targets, array[]::uuid[]));
  end if;
  perform app.audit(p_cycle, 'clean_removal', 'assessment', p_assessment::text, null,
                    jsonb_build_object('kind', p_kind, 'remove', p_remove,
                                       'count', coalesce(array_length(p_targets, 1), 0)));
end $$;

grant execute on function
  public.set_clean_removal(uuid, uuid, text, uuid[], boolean)
to authenticated;

alter table clean_exclusions drop column if exists target_key;
