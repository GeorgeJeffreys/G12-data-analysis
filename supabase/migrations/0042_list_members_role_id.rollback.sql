-- Rollback 0042 — restore the pre-0042 four-column list_members (the 0027 shape).
-- Drops role_id + role_name from the result and returns only the legacy enum role.
-- The return-type signature changes, so drop then recreate (create-or-replace can't
-- alter a function's OUT columns).

begin;

drop function if exists public.list_members();

create or replace function public.list_members()
returns table (user_id uuid, email text, role member_role, cycle_id uuid)
language sql stable security definer set search_path = public, app, auth as $$
  select m.user_id, u.email::text as email, m.role, m.cycle_id
  from memberships m
  join auth.users u on u.id = m.user_id
  where exists (select 1 from memberships me where me.user_id = auth.uid())
  order by (m.cycle_id is not null), u.email, m.cycle_id;
$$;

revoke all on function public.list_members() from public;
grant execute on function public.list_members() to authenticated;

commit;
