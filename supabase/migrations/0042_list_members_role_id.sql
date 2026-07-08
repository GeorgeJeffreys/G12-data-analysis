-- 0042 — list_members returns the real (dynamic) role: role_id + role name.
--
-- WHY THIS EXISTS
--   Post-0040 the auth spine moved off the physical `member_role` enum onto the
--   dynamic `roles` table (memberships.role_id → roles). But `list_members` (0027)
--   still returned only the legacy enum `role`, so the app's roster/session read
--   path resolved every membership through the enum's canonical TIER (an id like
--   "admin"/"analyst"/"team_member") rather than the real role_id (a uuid). The
--   Roles × actions grid counts members by matching role_id, so every role showed
--   "0 members", and once a membership is reassigned to a custom role the enum
--   would drift from the truth.
--
-- WHAT IT DOES (additive)
--   `create or replace` public.list_members to ALSO return `role_id` (from
--   memberships) and the role `name` (joined through roles). The legacy `role`
--   column is kept in the output during the transition; the app stops relying on
--   it (it now reads role_id + role_name). The join is a LEFT join so a membership
--   whose role_id is somehow null still surfaces (with null role/name) rather than
--   vanishing from the roster.
--
--   No schema change, no RLS change, no lib/engine change → scoring parity is
--   untouched (183/183). Additive to the function's result columns only.
--
-- Run in the Supabase SQL editor (EU) after 0040/0041. Idempotent (create or replace).
-- ============================================================================

begin;

-- Adding OUT columns changes the function's return type, which `create or replace`
-- cannot do ("cannot change return type of existing function") — drop the 0027
-- four-column version first, then recreate with the two extra columns.
drop function if exists public.list_members();

create or replace function public.list_members()
returns table (user_id uuid, email text, role member_role, role_id uuid, role_name text, cycle_id uuid)
language sql stable security definer set search_path = public, app, auth as $$
  select m.user_id, u.email::text, m.role, m.role_id, r.name, m.cycle_id
  from memberships m
  join auth.users u on u.id = m.user_id
  left join roles r on r.id = m.role_id
  where exists (select 1 from memberships me where me.user_id = auth.uid())
  order by (m.cycle_id is not null), u.email, m.cycle_id;
$$;

revoke all on function public.list_members() from public;
grant execute on function public.list_members() to authenticated;

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration):
--   select * from public.list_members();
--     -- each row now carries role_id (uuid) + role_name alongside the legacy role.
--   -- On the Roles × actions grid every role's member count is now non-zero where
--   -- members hold it (Admin ≥ the number of admins on Users).
-- ----------------------------------------------------------------------------
