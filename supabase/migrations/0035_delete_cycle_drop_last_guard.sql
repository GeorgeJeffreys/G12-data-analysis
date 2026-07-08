-- 0035 — drop the last-cycle guard from delete_cycle. An empty workspace (zero
-- cycles) is allowed; delete stays admin-gated, audited, and full-cascade.
-- Do NOT amend 0032 — this replaces the function forward-only. Run after 0034.
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

  -- (last-cycle guard removed — deleting the final cycle is allowed.)

  v_total := app.cycle_row_count(p_cycle);

  perform app.audit(null, 'delete', 'exam_cycle', p_cycle::text, to_jsonb(c),
                    jsonb_build_object('rows_deleted', v_total, 'via', 'delete_cycle'));

  delete from exam_cycles where id = p_cycle;   -- cascades all child rows
  return v_total;
end $$;

grant execute on function public.delete_cycle(uuid) to authenticated;
commit;
