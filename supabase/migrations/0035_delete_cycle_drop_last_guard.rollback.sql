-- 0035 rollback — restore the last-cycle guard on delete_cycle (the 0032 version):
-- refuse to delete the final remaining cycle so the workspace keeps one to open.
begin;
set local lock_timeout = '30s';

drop function if exists public.delete_cycle(uuid);
create or replace function public.delete_cycle(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  c exam_cycles;
  v_total bigint;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;

  select * into c from exam_cycles where id = p_cycle;
  if not found then return 0; end if;

  -- Last-cycle guard: never delete the final cycle — that would leave the
  -- workspace with no cycle to open. The caller must keep at least one.
  if (select count(*) from exam_cycles) <= 1 then
    raise exception 'cannot delete the last remaining cycle';
  end if;

  v_total := app.cycle_row_count(p_cycle);

  perform app.audit(null, 'delete', 'exam_cycle', p_cycle::text, to_jsonb(c),
                    jsonb_build_object('rows_deleted', v_total, 'via', 'delete_cycle'));

  delete from exam_cycles where id = p_cycle;   -- cascades all child rows
  return v_total;
end $$;

grant execute on function public.delete_cycle(uuid) to authenticated;
commit;
