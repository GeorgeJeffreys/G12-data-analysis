-- 0040 — dynamic roles × granular actions (auth-spine + model).
--
-- Replaces the R1/R2 permission-bundle model (0036/0039) with a plain role × action
-- grid: ROLES are add/deletable rows and ACTIONS are the fixed, granular catalogue
-- (lib/auth/actions.ts). The load-bearing change is that roles move OFF the physical
-- `member_role` enum (which can't grow/shrink at runtime) ONTO a `roles` table that
-- memberships point at via `memberships.role_id`. The old enum column is kept
-- (nullable) for one release; everything now reads `role_id`.
--
-- Enforcement resolves membership.role_id → the role's granted actions → the action
-- a gate checks (app.can_do, replacing app.has_capability). Actions stay code (each a
-- line of enforcement); roles + the grid are data (edited in the UI, persisted here).
--
-- No lib/engine change → scoring parity is untouched (183/183).
-- Forward-only; run in the Supabase SQL editor after merge (0040 then 0041).

-- ----------------------------------------------------------------------------
-- 1. roles — add/deletable role rows. Seed the three existing roles.
-- ----------------------------------------------------------------------------
create table if not exists public.roles (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  is_system  boolean not null default false,   -- the undeletable Admin role
  sort       int,
  created_at timestamptz default now()
);
insert into public.roles (name, is_system, sort) values
  ('G12 team member', false, 0),
  ('Data analyst',    false, 1),
  ('Admin',           true,  2)
on conflict (name) do nothing;

-- ----------------------------------------------------------------------------
-- 2. role_actions — the role_id × action grid. Seed to reproduce today's access.
-- ----------------------------------------------------------------------------
create table if not exists public.role_actions (
  role_id uuid not null references public.roles(id) on delete cascade,
  action  text not null,
  granted boolean not null default false,
  primary key (role_id, action)
);
-- Seed grants (by role name) so the three roles reproduce current EFFECTIVE access:
--   G12 team member : view, clean.*, review.exclude, incidents.*, grades.adjust, cgj.upload
--   Data analyst    : + upload.*, cuts.set, grades.confirm_distinction, general.audit
--   Admin           : every action
insert into public.role_actions (role_id, action, granted)
select r.id, g.action, true
from public.roles r
join (values
  ('G12 team member','general.view'),
  ('G12 team member','clean.rows'),
  ('G12 team member','clean.cohort'),
  ('G12 team member','review.exclude'),
  ('G12 team member','incidents.upload'),
  ('G12 team member','incidents.triage'),
  ('G12 team member','incidents.apply'),
  ('G12 team member','grades.adjust'),
  ('G12 team member','cgj.upload'),
  ('Data analyst','general.view'),
  ('Data analyst','clean.rows'),
  ('Data analyst','clean.cohort'),
  ('Data analyst','review.exclude'),
  ('Data analyst','incidents.upload'),
  ('Data analyst','incidents.triage'),
  ('Data analyst','incidents.apply'),
  ('Data analyst','grades.adjust'),
  ('Data analyst','cgj.upload'),
  ('Data analyst','upload.ingest'),
  ('Data analyst','upload.manage'),
  ('Data analyst','cuts.set'),
  ('Data analyst','grades.confirm_distinction'),
  ('Data analyst','general.audit'),
  ('Admin','upload.ingest'),
  ('Admin','upload.manage'),
  ('Admin','clean.rows'),
  ('Admin','clean.cohort'),
  ('Admin','review.exclude'),
  ('Admin','incidents.upload'),
  ('Admin','incidents.triage'),
  ('Admin','incidents.apply'),
  ('Admin','cuts.set'),
  ('Admin','cgj.upload'),
  ('Admin','grades.adjust'),
  ('Admin','grades.confirm_distinction'),
  ('Admin','awards.generate'),
  ('Admin','general.view'),
  ('Admin','general.signoff'),
  ('Admin','general.override_marks'),
  ('Admin','general.override_distinction'),
  ('Admin','general.audit'),
  ('Admin','general.config_methodology'),
  ('Admin','general.config_incidents'),
  ('Admin','general.manage_users'),
  ('Admin','general.manage_roles'),
  ('Admin','general.manage_centres'),
  ('Admin','general.delete')
) as g(rname, action) on g.rname = r.name
on conflict (role_id, action) do nothing;

-- ----------------------------------------------------------------------------
-- 3. memberships.role_id — the auth spine moves off the enum onto the roles table.
-- ----------------------------------------------------------------------------
alter table public.memberships add column if not exists role_id uuid references public.roles(id);
-- Keep the legacy enum column for one release (don't drop here) but relax NOT NULL so
-- a membership can point at a custom role that has no enum equivalent.
alter table public.memberships alter column role drop not null;
-- Backfill role_id from the enum: viewer/reviewer → G12 team member; analyst → Data
-- analyst; lead_admin → Admin.
update public.memberships m set role_id = r.id
from public.roles r
where m.role_id is null
  and r.name = case m.role
    when 'viewer'     then 'G12 team member'
    when 'reviewer'   then 'G12 team member'
    when 'analyst'    then 'Data analyst'
    when 'lead_admin' then 'Admin'
  end;

-- ----------------------------------------------------------------------------
-- 4. RLS — roles + role_actions readable by any signed-in member; no direct client
--    writes (all writes flow through the definer RPCs below).
-- ----------------------------------------------------------------------------
alter table public.roles        enable row level security;
alter table public.role_actions enable row level security;
create policy roles_select        on public.roles        for select using (auth.uid() is not null);
create policy role_actions_select on public.role_actions for select using (auth.uid() is not null);
revoke insert, update, delete on public.roles        from authenticated, anon;
revoke insert, update, delete on public.role_actions from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 5. app.can_do — the enforcement primitive (replaces app.has_capability). Exists a
--    membership for auth.uid() whose role_id has a granted role_actions row for
--    p_action, workspace-aware exactly like app.has_role (NULL-cycle membership
--    matches any p_cycle; a cycle membership matches only that cycle).
-- ----------------------------------------------------------------------------
create or replace function app.can_do(p_cycle uuid, p_action text)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1
    from memberships m
    join role_actions ra
      on ra.role_id = m.role_id and ra.action = p_action and ra.granted
    where m.user_id = auth.uid()
      and (m.cycle_id is null or m.cycle_id = p_cycle)
  );
$$;
grant execute on function app.can_do(uuid, text) to authenticated;

-- Retire app.has_permission (already dropped in 0039; belt-and-braces). app.is_member
-- (any membership) is kept for RLS SELECT policies. app.has_capability is dropped in
-- 0041, after every RPC that referenced it has been re-gated onto app.can_do.
drop function if exists app.has_permission(uuid, text);

-- ----------------------------------------------------------------------------
-- 6. Admin RPCs for roles + the grid — all gated on general.manage_roles, audited,
--    and lockout-guarded (defence in depth; the UI mirrors the same guards).
-- ----------------------------------------------------------------------------
create or replace function public.create_role(p_name text)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_sort int;
begin
  if not app.can_do(null, 'general.manage_roles') then raise exception 'not authorized'; end if;
  select coalesce(max(sort), -1) + 1 into v_sort from roles;
  insert into roles (name, is_system, sort) values (p_name, false, v_sort) returning id into v_id;
  perform app.audit(null, 'create_role', 'role', v_id::text, null, to_jsonb(p_name));
  return v_id;
end $$;

create or replace function public.rename_role(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.can_do(null, 'general.manage_roles') then raise exception 'not authorized'; end if;
  update roles set name = p_name where id = p_id;
  if not found then raise exception 'no such role'; end if;
  perform app.audit(null, 'rename_role', 'role', p_id::text, null, to_jsonb(p_name));
end $$;

create or replace function public.delete_role(p_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_role roles;
begin
  if not app.can_do(null, 'general.manage_roles') then raise exception 'not authorized'; end if;
  select * into v_role from roles where id = p_id;
  if not found then return; end if;
  -- Lockout guard: the Admin system role is undeletable.
  if v_role.is_system then raise exception 'the Admin role cannot be deleted'; end if;
  -- Lockout guard: refuse if the role still has members (reassign in Users first).
  if exists (select 1 from memberships where role_id = p_id) then
    raise exception 'cannot delete a role that still has members — reassign them first';
  end if;
  -- Lockout guard: never delete the last role holding general.manage_roles.
  if exists (select 1 from role_actions where role_id = p_id and action = 'general.manage_roles' and granted)
     and not exists (select 1 from role_actions where role_id <> p_id and action = 'general.manage_roles' and granted) then
    raise exception 'cannot delete the last role that can manage roles';
  end if;
  delete from roles where id = p_id;  -- role_actions cascade
  perform app.audit(null, 'delete_role', 'role', p_id::text, to_jsonb(v_role), null);
end $$;

create or replace function public.set_role_action(p_role_id uuid, p_action text, p_granted boolean)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_role roles;
begin
  if not app.can_do(null, 'general.manage_roles') then raise exception 'not authorized'; end if;
  select * into v_role from roles where id = p_role_id;
  if not found then raise exception 'no such role'; end if;
  -- Lockout guard: the Admin role's general.manage_roles + general.manage_users cells
  -- are permanently granted (can't be turned off).
  if v_role.is_system and p_granted = false and p_action in ('general.manage_roles', 'general.manage_users') then
    raise exception 'the Admin role must keep %', p_action;
  end if;
  -- Lockout guard: never leave zero roles holding general.manage_roles.
  if p_action = 'general.manage_roles' and p_granted = false
     and not exists (select 1 from role_actions where role_id <> p_role_id and action = 'general.manage_roles' and granted) then
    raise exception 'at least one role must keep general.manage_roles';
  end if;
  if p_granted then
    insert into role_actions (role_id, action, granted) values (p_role_id, p_action, true)
      on conflict (role_id, action) do update set granted = true;
  else
    delete from role_actions where role_id = p_role_id and action = p_action;
  end if;
  perform app.audit(null, 'set_role_action', 'role_action', p_role_id::text || ':' || p_action, null, to_jsonb(p_granted));
end $$;

grant execute on function public.create_role(text)                         to authenticated;
grant execute on function public.rename_role(uuid, text)                   to authenticated;
grant execute on function public.delete_role(uuid)                         to authenticated;
grant execute on function public.set_role_action(uuid, text, boolean)      to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Member RPCs move onto role_id, gated on general.manage_users. The old
--    member_role-typed signatures are dropped (replaced, not overloaded).
-- ----------------------------------------------------------------------------
drop function if exists public.set_member_role(uuid, uuid, member_role);
create or replace function public.set_member_role(p_user uuid, p_cycle uuid, p_role_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.can_do(p_cycle, 'general.manage_users') then
    raise exception 'not authorized: only an admin may change member roles';
  end if;
  if not exists (select 1 from roles where id = p_role_id) then raise exception 'no such role'; end if;
  update memberships set role_id = p_role_id
   where user_id = p_user and cycle_id is not distinct from p_cycle;
  if not found then raise exception 'no membership for that user at the given scope'; end if;
end $$;

drop function if exists public.invite_member(text, member_role, uuid);
create or replace function public.invite_member(p_email text, p_role_id uuid, p_cycle uuid default null)
returns text language plpgsql security definer set search_path = public, app, auth as $$
declare v_uid uuid;
begin
  if not app.can_do(p_cycle, 'general.manage_users') then
    raise exception 'not authorized: only an admin may invite members';
  end if;
  if not exists (select 1 from roles where id = p_role_id) then raise exception 'no such role'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_uid is null then
    raise exception 'no account for % — invite them to the workspace via Supabase auth first, then assign a membership here', p_email;
  end if;
  if exists (select 1 from memberships where user_id = v_uid and cycle_id is not distinct from p_cycle) then
    update memberships set role_id = p_role_id where user_id = v_uid and cycle_id is not distinct from p_cycle;
    return 'updated';
  else
    insert into memberships (user_id, cycle_id, role_id) values (v_uid, p_cycle, p_role_id);
    return 'added';
  end if;
end $$;

create or replace function public.remove_member(p_user uuid, p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.can_do(p_cycle, 'general.manage_users') then
    raise exception 'not authorized: only an admin may remove members';
  end if;
  if p_user = auth.uid() then raise exception 'you cannot remove your own membership'; end if;
  delete from memberships where user_id = p_user and cycle_id is not distinct from p_cycle;
end $$;

grant execute on function public.set_member_role(uuid, uuid, uuid)  to authenticated;
grant execute on function public.invite_member(text, uuid, uuid)    to authenticated;
grant execute on function public.remove_member(uuid, uuid)          to authenticated;
