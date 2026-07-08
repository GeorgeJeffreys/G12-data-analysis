-- Rollback 0040 — drop the dynamic-roles model and restore the enum-only spine.
-- NOTE: run the 0041 rollback FIRST (it recreates app.has_capability + the bundle
-- layer that the pre-0040 RPCs depend on). This rollback removes role_id, the roles
-- and role_actions tables, app.can_do, and the role/member RPCs, and restores the
-- member_role-typed member RPCs so the enum spine works again.

-- Restore the member_role NOT NULL invariant (only safe if no custom-role rows exist).
alter table public.memberships alter column role set not null;
alter table public.memberships drop column if exists role_id;

drop function if exists public.create_role(text);
drop function if exists public.rename_role(uuid, text);
drop function if exists public.delete_role(uuid);
drop function if exists public.set_role_action(uuid, text, boolean);
drop function if exists public.set_member_role(uuid, uuid, uuid);
drop function if exists public.invite_member(text, uuid, uuid);
drop function if exists app.can_do(uuid, text);

-- Restore the member_role-typed member RPCs (gated on the restored has_capability).
create or replace function public.set_member_role(p_user uuid, p_cycle uuid, p_role member_role)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_capability(p_cycle, 'workspace_admin') then
    raise exception 'not authorized: only an admin may change member roles';
  end if;
  update memberships set role = p_role where user_id = p_user and cycle_id is not distinct from p_cycle;
  if not found then raise exception 'no membership for that user at the given scope'; end if;
end $$;
create or replace function public.invite_member(p_email text, p_role member_role, p_cycle uuid default null)
returns text language plpgsql security definer set search_path = public, app, auth as $$
declare v_uid uuid;
begin
  if not app.has_capability(p_cycle, 'workspace_admin') then
    raise exception 'not authorized: only an admin may invite members';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_uid is null then raise exception 'no account for %', p_email; end if;
  if exists (select 1 from memberships where user_id = v_uid and cycle_id is not distinct from p_cycle) then
    update memberships set role = p_role where user_id = v_uid and cycle_id is not distinct from p_cycle;
    return 'updated';
  else
    insert into memberships (user_id, cycle_id, role) values (v_uid, p_cycle, p_role);
    return 'added';
  end if;
end $$;

drop table if exists public.role_actions;
drop table if exists public.roles;
