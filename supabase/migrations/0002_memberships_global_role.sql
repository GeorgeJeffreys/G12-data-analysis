-- 0002_memberships_global_role.sql
-- Allow workspace-level memberships: a membership with cycle_id = NULL grants
-- the role across ALL cycles (e.g. a Lead who oversees the whole workspace),
-- rather than being scoped to a single cycle.

-- 1. Make the scope optional. NULL cycle_id = "all cycles".
ALTER TABLE memberships ALTER COLUMN cycle_id DROP NOT NULL;

-- 2. RLS audit: every policy reaches memberships.cycle_id through these two
--    SECURITY DEFINER helpers (app.is_member / app.has_role). Re-create them so
--    a NULL membership matches any cycle being accessed:
--        (m.cycle_id IS NULL OR m.cycle_id = <cycle being accessed>)
--    No per-table policy text needs to change — they all route through these.
create or replace function app.is_member(p_cycle uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where (m.cycle_id is null or m.cycle_id = p_cycle)
      and m.user_id = auth.uid()
  );
$$;

create or replace function app.has_role(p_cycle uuid, p_roles member_role[])
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where (m.cycle_id is null or m.cycle_id = p_cycle)
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;
