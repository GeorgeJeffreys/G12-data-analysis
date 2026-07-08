-- 0036 — role_permissions: the editable role → permission matrix that is the
-- single source of truth for authorization (P1 of 3, additive foundation).
--
-- This migration is ADDITIVE. It introduces the matrix, its read RLS, the
-- server-side `app.has_permission` gate and the admin-gated `set_role_permission`
-- writer, but swaps NO existing gate. `app.has_role` and every policy built on it
-- are untouched, so the app behaves identically (P2 flips enforcement onto this).
--
-- The three canonical tiers (team_member / analyst / admin) mirror lib/auth/roles.ts;
-- the storage `member_role` enum collapses onto them (viewer/reviewer → team_member,
-- analyst → analyst, lead_admin → admin), exactly as `app.has_permission` does below.

-- ----------------------------------------------------------------------------
-- 1. Table — one row per (tier, permission), complete (not sparse): every cell
--    carries its granted flag so a missing row can never be mistaken for "denied".
-- ----------------------------------------------------------------------------
create table if not exists public.role_permissions (
  tier       text not null,
  permission text not null,
  granted    boolean not null default true,
  updated_at timestamptz default now(),
  primary key (tier, permission)
);

-- ----------------------------------------------------------------------------
-- 2. Seed — the full matrix from lib/auth/permissions.ts ROLE_PERMISSION_DEFAULTS.
--    Every (tier, permission) pair is inserted with the correct granted flag, so
--    the table is complete from day one. Idempotent: existing rows are left as-is
--    (a re-run must never clobber edits an admin has since made in the UI).
-- ----------------------------------------------------------------------------
insert into public.role_permissions (tier, permission, granted) values
  -- team_member: view, clean, adjust
  ('team_member', 'view',            true),
  ('team_member', 'intake',          false),
  ('team_member', 'clean',           true),
  ('team_member', 'adjust',          true),
  ('team_member', 'boundaries',      false),
  ('team_member', 'safeguard',       false),
  ('team_member', 'signoff',         false),
  ('team_member', 'override',        false),
  ('team_member', 'configure',       false),
  ('team_member', 'workspace_admin', false),
  -- analyst: view, clean, adjust, intake, boundaries, safeguard
  ('analyst',     'view',            true),
  ('analyst',     'intake',          true),
  ('analyst',     'clean',           true),
  ('analyst',     'adjust',          true),
  ('analyst',     'boundaries',      true),
  ('analyst',     'safeguard',       true),
  ('analyst',     'signoff',         false),
  ('analyst',     'override',        false),
  ('analyst',     'configure',       false),
  ('analyst',     'workspace_admin', false),
  -- admin: all
  ('admin',       'view',            true),
  ('admin',       'intake',          true),
  ('admin',       'clean',           true),
  ('admin',       'adjust',          true),
  ('admin',       'boundaries',      true),
  ('admin',       'safeguard',       true),
  ('admin',       'signoff',         true),
  ('admin',       'override',        true),
  ('admin',       'configure',       true),
  ('admin',       'workspace_admin', true)
on conflict (tier, permission) do nothing;

-- ----------------------------------------------------------------------------
-- 3. RLS — readable by any signed-in member (like workspace_settings); no direct
--    client writes (all changes flow through set_role_permission in section 5).
-- ----------------------------------------------------------------------------
alter table public.role_permissions enable row level security;

create policy role_permissions_select on public.role_permissions for select
  using (auth.uid() is not null);

revoke insert, update, delete on public.role_permissions from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 4. app.has_permission — the SERVER gate (twin of the client `can()`). Resolves
--    the caller's stored member_role to a canonical tier and checks a granted row
--    exists for (tier, permission). Workspace-aware exactly like app.has_role: a
--    NULL-cycle (workspace) membership OR a membership on p_cycle both count.
-- ----------------------------------------------------------------------------
create or replace function app.has_permission(p_cycle uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1
    from memberships m
    join role_permissions rp
      on rp.permission = p_permission and rp.granted
     and rp.tier = case m.role
                     when 'viewer' then 'team_member'
                     when 'reviewer' then 'team_member'
                     when 'analyst' then 'analyst'
                     when 'lead_admin' then 'admin'
                   end
    where m.user_id = auth.uid()
      and (m.cycle_id is null or m.cycle_id = p_cycle)
  );
$$;

-- ----------------------------------------------------------------------------
-- 5. set_role_permission — the ONLY way the matrix changes. Admin-gated, audited,
--    with the lockout guard: admin can never lose an admin-locked permission
--    (workspace_admin), so the workspace can never lock itself out of managing
--    users, roles and this matrix.
-- ----------------------------------------------------------------------------
create or replace function public.set_role_permission(
  p_tier text, p_permission text, p_granted boolean)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(null, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  -- Lockout guard: refuse to ungrant an admin-locked permission from admin.
  if p_granted = false and p_tier = 'admin' and p_permission = 'workspace_admin' then
    raise exception 'cannot ungrant admin-locked permission % from admin', p_permission;
  end if;
  insert into role_permissions (tier, permission, granted, updated_at)
  values (p_tier, p_permission, p_granted, now())
  on conflict (tier, permission) do update
    set granted = excluded.granted, updated_at = now();
  perform app.audit(null, 'set_role_permission', 'role_permission',
                    p_tier || ':' || p_permission, null, to_jsonb(p_granted));
end $$;

grant execute on function public.set_role_permission(text, text, boolean) to authenticated;
