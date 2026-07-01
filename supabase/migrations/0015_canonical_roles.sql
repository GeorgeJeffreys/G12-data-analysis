-- ============================================================================
-- G12++ — Canonical role hierarchy + reusable permission primitives
-- Migration 0015_canonical_roles.sql
--
-- WHY THIS EXISTS
--   The suite has three canonical roles, lowest → highest privilege:
--       1. team member  — view + standard reviewer work.
--       2. data analyst — everything a team member can, plus analyst functions.
--       3. admin        — super-user: configures grade-bearing settings and can
--                         override decisions made by lower roles.
--   Two upcoming features — incident-adjustment config (admin-only) and audit-log
--   overrides (admin overrides lower roles) — need ONE consistent hierarchy with a
--   defined ordering, instead of each re-inventing role gates. This migration makes
--   that ordering first-class in the database and gives us the reusable primitives.
--
-- WHAT IT DOES
--   1. Adds `analyst` to the existing `member_role` enum (0001). The enum stays the
--      SINGLE source of truth for a member's stored role; `viewer`/`reviewer` remain
--      the two sub-flavours of the team-member tier (a viewer reads; a reviewer also
--      decides item exclusions), `analyst` is the data-analyst tier, `lead_admin` is
--      admin. Nothing is renamed or dropped, so every existing RLS policy that names
--      'lead_admin' / 'reviewer' / 'viewer' keeps working unchanged.
--   2. Adds pure ranking helpers that express the canonical ordering ONCE:
--        • app.role_rank(member_role)              -> 1 (team) | 2 (analyst) | 3 (admin)
--        • app.role_at_least(role, min)            -> role_rank(role) >= role_rank(min)
--        • app.can_override(actor, subject)        -> role_rank(actor) > role_rank(subject)
--      `can_override` is the STRICTLY-higher override primitive prompt 06 (audit
--      overrides) will consume: admin overrides analyst & team member; analyst
--      overrides team member; nobody overrides an equal or higher role.
--   3. Adds app.has_min_role(cycle, min) — a rank-based, cycle-scoped membership
--      check (the DB mirror of the app-layer hasRole), so future policies can gate
--      on "at least analyst" without hard-coding role arrays.
--   4. Folds the existing cut-score / workspace-config admin lock onto the new
--      primitive: app.is_workspace_admin() and app.is_global_admin() now test
--      app.role_at_least(role, 'lead_admin') instead of `role = 'lead_admin'`.
--      This is BEHAVIOUR-IDENTICAL (only lead_admin has rank 3) — it just routes the
--      lock through the one canonical hierarchy. set_workspace_setting (the cut-score
--      lock), the test-centre RPCs (0013) and the audit full-read RLS (0012) all
--      call these two functions, so they inherit the fold with no further change.
--
-- WHAT THIS IS NOT
--   No table DDL, no grade-bearing data touched, no scoring re-run. The rank helpers
--   are pure; is_workspace_admin / is_global_admin keep their exact prior semantics.
--   Existing per-action RLS arrays (e.g. item_reviews' ['lead_admin','reviewer'])
--   are intentionally left as-is — widening them to admit `analyst` is a consuming
--   feature's job, not this foundation's.
--
-- IDEMPOTENCY / RUN ORDER
--   Run AFTER 0001–0014, in the Supabase SQL editor (EU). `ADD VALUE IF NOT EXISTS`
--   and every `create or replace` are idempotent and safe to re-run. The new enum
--   value is only ever referenced by rank via its text, never as a fresh enum
--   literal in this file, so the migration is safe to run as a single batch.
--   Reversibility: see 0015_canonical_roles.rollback.sql (note: Postgres cannot drop
--   an enum value, so `analyst` remains — harmless and unused if rolled back).
-- ============================================================================

-- 1. Extend the canonical enum ----------------------------------------------
--    Additive only. Kept OUTSIDE an explicit transaction on purpose (ADD VALUE),
--    and never used as a literal below, so it can't trip the "unsafe use of new
--    enum value" guard.
alter type member_role add value if not exists 'analyst';

-- 2. Pure ranking primitives (the canonical ordering, expressed once) --------
-- Rank a stored role on the canonical hierarchy. Compared via ::text so this
-- file never has to reference the freshly-added 'analyst' as an enum literal.
create or replace function app.role_rank(p_role member_role)
returns int language sql immutable set search_path = public, app as $$
  select case p_role::text
           when 'lead_admin' then 3   -- admin
           when 'analyst'    then 2   -- data analyst
           else 1                     -- team member (reviewer / viewer)
         end;
$$;

-- "At least `p_min`" on the canonical hierarchy.
create or replace function app.role_at_least(p_role member_role, p_min member_role)
returns boolean language sql immutable set search_path = public, app as $$
  select app.role_rank(p_role) >= app.role_rank(p_min);
$$;

-- Override primitive: true ONLY when the actor is STRICTLY higher than the role
-- that took the original action. Consumed by prompt 06 (audit overrides).
create or replace function app.can_override(p_actor member_role, p_subject member_role)
returns boolean language sql immutable set search_path = public, app as $$
  select app.role_rank(p_actor) > app.role_rank(p_subject);
$$;

-- 3. Rank-based, cycle-scoped membership check (DB mirror of hasRole) ---------
-- Like app.has_role(cycle, roles[]) but expressed as an "at least" bar, so a
-- future policy can say has_min_role(cycle, 'analyst') without listing roles.
-- SECURITY DEFINER so it reads memberships under RLS, matching app.has_role.
create or replace function app.has_min_role(p_cycle uuid, p_min member_role)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where (m.cycle_id is null or m.cycle_id = p_cycle)
      and m.user_id = auth.uid()
      and app.role_rank(m.role) >= app.role_rank(p_min)
  );
$$;

-- 4. Fold the existing admin lock onto the canonical primitive ---------------
-- BEHAVIOUR-IDENTICAL: only lead_admin has rank 3, so role_at_least(role,
-- 'lead_admin') matches exactly what `role = 'lead_admin'` matched before. This
-- routes the cut-score / workspace-config lock (set_workspace_setting), the
-- test-centre RPCs (0013) and the audit full-read RLS (0012) through the one
-- hierarchy. The 'lead_admin' literal is a PRE-EXISTING enum value (safe to use).
create or replace function app.is_workspace_admin()
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.cycle_id is null
      and app.role_at_least(m.role, 'lead_admin')
  );
$$;

create or replace function app.is_global_admin()
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where m.cycle_id is null
      and m.user_id = auth.uid()
      and app.role_at_least(m.role, 'lead_admin')
  );
$$;
