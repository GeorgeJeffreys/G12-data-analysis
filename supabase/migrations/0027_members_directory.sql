-- ============================================================================
-- G12++ — REAL members directory: wire the Users & access screen to the actual
-- auth.users + memberships (replacing the mock Rana/Sami/Karim list).
-- Migration 0027_members_directory.sql
--
-- WHY THIS EXISTS
--   The Users & access screen rendered a hardcoded mock roster
--   (lib/data/mock-admin.ts) disconnected from real auth, and marked "Rana Mansour"
--   as the current user even though the session is a different account. The real
--   roster lives in `memberships` (user_id, role, cycle_id) joined to `auth.users`
--   (email), but two things block reading it directly from the browser:
--     * the C1 `memberships_select` policy is self-read only (`user_id = auth.uid()`),
--       so a client can't list OTHER users' memberships;
--     * `auth.users` is not client-readable at all.
--   So this adds SECURITY DEFINER read/write RPCs that surface + manage the REAL
--   roster, gated through the SAME C1 authorization primitive (`app.has_role`).
--
-- WHAT IT DOES (additive only)
--   * public.list_members()      — the real roster (any member may view).
--   * public.set_member_role()   — admin changes a member's role.
--   * public.remove_member()     — admin removes a membership.
--   * public.invite_member()     — admin assigns a membership to an ALREADY-invited
--                                  auth.users account (by email); if no such account
--                                  exists it raises (creating auth.users is the
--                                  Supabase auth invite flow, not a DB concern).
--
-- WHAT IT DOES NOT DO
--   No change to the `memberships` schema, the `member_role` enum, `app.has_role`,
--   or ANY RLS policy — the C1 model is correct and untouched. `schema_health()`
--   stays at '0026'. These are additive functions only.
--
-- Run AFTER 0001–0026 in the Supabase SQL editor (EU). Idempotent (create or replace).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. list_members() — the REAL roster: one row per membership, joined to the
--    auth.users email. Any authenticated MEMBER may view it (invite-only app, so
--    every signed-in user is a member); SECURITY DEFINER so it can read auth.users
--    and every user's membership without tripping the self-read RLS policy.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 2. set_member_role() — admin changes a member's stored role for a scope.
--    Gated on the C1 primitive: a workspace admin (or the target cycle's admin)
--    may change roles. `p_cycle IS NULL` = the workspace-wide membership.
-- ----------------------------------------------------------------------------
create or replace function public.set_member_role(p_user uuid, p_cycle uuid, p_role member_role)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized: only an admin may change member roles';
  end if;
  update memberships
     set role = p_role
   where user_id = p_user and cycle_id is not distinct from p_cycle;
  if not found then
    raise exception 'no membership for that user at the given scope';
  end if;
end $$;

revoke all on function public.set_member_role(uuid, uuid, member_role) from public;
grant execute on function public.set_member_role(uuid, uuid, member_role) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. remove_member() — admin removes a membership. Never remove yourself (the UI
--    hides it; the guard enforces it) so an admin can't lock themselves out.
-- ----------------------------------------------------------------------------
create or replace function public.remove_member(p_user uuid, p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized: only an admin may remove members';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot remove your own membership';
  end if;
  delete from memberships where user_id = p_user and cycle_id is not distinct from p_cycle;
end $$;

revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. invite_member() — admin assigns a membership (default workspace-wide) to an
--    account that ALREADY exists in auth.users (matched by email). If no such
--    account exists, it raises: creating the auth.users row is the Supabase auth
--    invite flow (an admin-API / dashboard action), not something a DB function
--    can do. Idempotent: re-inviting an existing member updates their role.
-- ----------------------------------------------------------------------------
create or replace function public.invite_member(p_email text, p_role member_role, p_cycle uuid default null)
returns text language plpgsql security definer set search_path = public, app, auth as $$
declare v_uid uuid;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized: only an admin may invite members';
  end if;

  select id into v_uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_uid is null then
    raise exception 'no account for % — invite them to the workspace via Supabase auth first, then assign a membership here', p_email;
  end if;

  if exists (select 1 from memberships where user_id = v_uid and cycle_id is not distinct from p_cycle) then
    update memberships set role = p_role where user_id = v_uid and cycle_id is not distinct from p_cycle;
    return 'updated';
  else
    insert into memberships (user_id, cycle_id, role) values (v_uid, p_cycle, p_role);
    return 'added';
  end if;
end $$;

revoke all on function public.invite_member(text, member_role, uuid) from public;
grant execute on function public.invite_member(text, member_role, uuid) to authenticated;

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration):
--   select * from public.list_members();      -- the three real accounts + roles/scope
--   -- (schema_health is unchanged — still reports '0026').
-- ----------------------------------------------------------------------------
