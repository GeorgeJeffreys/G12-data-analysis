-- ============================================================================
-- Rollback for 0015_canonical_roles.sql
--
-- Restores app.is_workspace_admin() / app.is_global_admin() to their pre-0015
-- definitions (direct `role = 'lead_admin'` checks) and drops the rank helpers.
--
-- NOTE: Postgres cannot remove a value from an enum, so the `analyst` value added
-- to `member_role` REMAINS after this rollback. It is harmless and unused: no
-- migration references it, and app.role_rank (dropped here) was the only thing
-- that ranked it. If a member was assigned `analyst`, reassign them first.
-- ============================================================================

-- 1. Revert the admin-lock helpers to their pre-0015 (0003 / 0012) bodies ----
create or replace function app.is_workspace_admin()
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.role = 'lead_admin'
      and m.cycle_id is null
  );
$$;

create or replace function app.is_global_admin()
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where m.cycle_id is null and m.user_id = auth.uid() and m.role = 'lead_admin'
  );
$$;

-- 2. Drop the rank primitives (drop dependents before role_rank) -------------
drop function if exists app.has_min_role(uuid, member_role);
drop function if exists app.can_override(member_role, member_role);
drop function if exists app.role_at_least(member_role, member_role);
drop function if exists app.role_rank(member_role);

-- (The `analyst` enum value cannot be dropped — see header note.)
