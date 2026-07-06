-- ============================================================================
-- G12++ — REBUILD AUTHORIZATION: one simple, consistent, correct model.
-- Migration 0025_authorization_rebuild.sql
--
-- WHY THIS EXISTS (the incoherence 0024 patched but did not reset)
--   Authorization had grown three tangled failure modes, all of which surfaced as a
--   legitimate workspace admin being told "forbidden" on Delete and "Replace files":
--     1. A workspace-wide membership (`memberships.cycle_id IS NULL` — admin over
--        EVERY cycle) was not honoured everywhere: the helpers had drifted to the
--        strict, cycle-scoped body, so a NULL-cycle admin authorized nothing.
--     2. The `memberships` write policy (`memberships_all`) keyed authorization on
--        the ROW's OWN `cycle_id` with no honoured workspace path — circular for the
--        one row type (`cycle_id IS NULL`) a workspace admin most needs to manage.
--     3. Both memberships policies (SELECT and write) routed through
--        `app.is_member` / `app.has_role`, which READ `memberships` internally. A
--        migration that replaced those functions AND swapped a memberships policy in
--        the same transaction deadlocked against live readers (the fight 0024 fought
--        by splitting into two transactions).
--
-- THE CLEAN MODEL THIS BUILDS (reset, don't patch)
--   * ONE authorization primitive — `app.has_role(target_cycle, allowed[])` — that
--     returns true when the caller holds any `allowed` role EITHER for `target_cycle`
--     OR workspace-wide (`cycle_id IS NULL`). It handles `target_cycle IS NULL`
--     correctly (only a workspace membership authorizes a workspace-scoped row), is
--     SECURITY DEFINER (reads `memberships` as the owner, so the internal read does
--     NOT re-enter RLS — no recursion), and is the SOLE primitive every policy and
--     the app/server layer routes through. `app.is_member` is now DERIVED from it
--     (`has_role(cycle, <every role>)`), so "any membership" and "specific role" share
--     one definition.
--   * ONE membership rule — a user's effective role for a cycle is the HIGHER of their
--     workspace-wide membership and their per-cycle membership. `has_role` encodes
--     exactly this (`m.cycle_id IS NULL OR m.cycle_id = p_cycle`).
--   * MINIMAL, NON-RECURSIVE RLS on `memberships`:
--       - SELECT = `user_id = auth.uid()` ONLY. You see your OWN memberships. It calls
--         NO function that reads `memberships`, so the recursion/deadlock cannot form
--         by construction. (Admin/service reads of other users' rows go through the
--         service-role client, which bypasses RLS — see lib/auth/authorize-cycle.ts.)
--       - INSERT / UPDATE / DELETE = `has_role(cycle_id, 'lead_admin')`. A workspace
--         admin manages every membership row (their NULL membership matches any
--         cycle_id, including NULL); a cycle admin manages their own cycle's rows.
--         Split into three per-command policies (NOT `FOR ALL`) so the write guard
--         never leaks onto SELECT — SELECT stays purely the self-read above.
--   * Every OTHER table already routes reads through `app.is_member(cycle)` and
--     writes through `app.has_role(cycle, [...])`; with the primitive rebuilt here
--     they are correct unchanged, so this migration deliberately does NOT churn them.
--
-- CANONICAL ROLES — the storage enum `member_role` (`lead_admin`, `reviewer`,
--   `viewer`, `analyst`) REMAINS the single persisted source of truth; the app's
--   canonical tiers (member < analyst < admin, lib/auth/roles.ts) are the one app-layer
--   vocabulary, mapping storage → tier in one place. We do NOT rename the enum:
--   `reviewer` carries a live capability (item-exclusion decisions), the committed SQL
--   is already internally consistent (every reference is a valid enum member — no
--   phantom `admin` string), and a rename would rewrite 90+ policy references for no
--   functional gain. `schema_health()` now asserts the enum + primitive are intact so
--   a phantom role can never silently reappear.
--
-- SAFETY: no table/column/constraint/DATA change. Only `create or replace` of
-- SECURITY DEFINER functions, the memberships policy set, and the read-only probe.
-- The engine + grade-bearing tables are untouched — parity 183/183 unaffected.
--
-- DEADLOCK SAFETY (why this file is TWO transactions, not one)
--   `app.has_role` READS `memberships`, and the memberships WRITE policies reference
--   `app.has_role`. A single transaction that both replaces that function (exclusive
--   lock on the function) AND swaps the memberships policies (AccessExclusiveLock on
--   the table) holds one of that pair while wanting the other — the exact reverse of
--   what a live reader holds (function share-lock, then memberships share-lock) — and
--   the two collide as `ERROR 40P01: deadlock detected`. The fix, by construction:
--     * Transaction 1 replaces ONLY the functions (locks function objects; no table
--       lock) — it can't form a table↔function cycle.
--     * Transaction 2 swaps ONLY the policies (locks the memberships table; replaces
--       no function) — it can't either.
--   Each carries a short `lock_timeout` so a statement under load aborts cleanly
--   (re-run) instead of hanging. Both transactions are independently idempotent.
--
-- The human runs this in the Supabase SQL editor (EU) AFTER 0001–0024. It is the next
-- numbered, append-only migration. Reversible via 0025_authorization_rebuild.rollback.sql.
-- ============================================================================

-- ============================================================================
-- TRANSACTION 1 — the authorization primitive + derived helpers + probe.
-- (Replaces functions only; takes no lock on the memberships table.)
-- ============================================================================
begin;

set local lock_timeout = '15s';

-- ----------------------------------------------------------------------------
-- 1. THE single authorization primitive. True when the caller holds any of
--    `p_roles` for `p_cycle` OR workspace-wide (cycle_id IS NULL). SECURITY
--    DEFINER: the internal `memberships` read runs as the function owner and does
--    NOT re-enter RLS, so no policy that calls this can recurse.
--
--    `p_cycle IS NULL` (a workspace-scoped row): `m.cycle_id = p_cycle` is NULL
--    (never true), so ONLY a workspace membership (`m.cycle_id IS NULL`) matches —
--    exactly right: a cycle-scoped membership does not authorize workspace rows.
-- ----------------------------------------------------------------------------
create or replace function app.has_role(p_cycle uuid, p_roles member_role[])
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.role = any(p_roles)
      and (m.cycle_id is null or m.cycle_id = p_cycle)
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. `app.is_member` DERIVED from the one primitive: "holds ANY role for this
--    cycle (or workspace-wide)". `enum_range(NULL::member_role)` is every role, so
--    is_member and has_role share exactly one workspace-aware definition — there is
--    no second, drift-prone membership body.
-- ----------------------------------------------------------------------------
create or replace function app.is_member(p_cycle uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select app.has_role(p_cycle, enum_range(null::member_role));
$$;

-- ----------------------------------------------------------------------------
-- 3. HARDENED drift probe — now also asserts the AUTHORIZATION model is intact:
--      * the `member_role` enum still carries its canonical values (no phantom /
--        dropped role);
--      * the single primitive `app.has_role` is workspace-aware (carries the global
--        `cycle_id is null` clause — a strict, drifted body is flagged);
--      * `memberships` SELECT is the pure self-read (`auth.uid()`, and does NOT call a
--        memberships-reading function — the non-recursive shape);
--      * a `memberships` write policy gated on `has_role` is present.
--    Retains every 0022/0023/0024 probe. Reports migration '0025'.
-- ----------------------------------------------------------------------------
create or replace function public.schema_health()
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_missing_cols text[] := '{}';
  v_missing_fns  text[] := '{}';
begin
  -- Required columns.
  if to_regclass('public.items') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'items' and column_name = 'item_set') then
    v_missing_cols := array_append(v_missing_cols, 'items.item_set');
  end if;

  if to_regclass('public.responses') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'responses' and column_name = 'qm_result_id') then
    v_missing_cols := array_append(v_missing_cols, 'responses.qm_result_id');
  end if;

  -- The grain must actually be swapped to the sitting key.
  if not exists (select 1 from pg_constraint where conname = 'responses_item_id_qm_result_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:unique(item_id,qm_result_id)');
  end if;
  if exists (select 1 from pg_constraint where conname = 'responses_participant_id_item_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:stale-unique(participant_id,item_id)');
  end if;

  -- AUTH (0025): the member_role enum must still carry its canonical values — a
  -- dropped/renamed role would strand every policy that names it, and a phantom role
  -- (checked but absent) silently fails closed.
  if not exists (
    select 1 from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'member_role' and e.enumlabel = 'lead_admin') then
    v_missing_cols := array_append(v_missing_cols, 'enum member_role:lead_admin');
  end if;
  if not exists (
    select 1 from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'member_role' and e.enumlabel = 'analyst') then
    v_missing_cols := array_append(v_missing_cols, 'enum member_role:analyst');
  end if;

  -- AUTH (0025): the SELECT policy must be the pure self-read — `auth.uid()` present
  -- AND it must NOT call a memberships-reading function (is_member/has_role), or the
  -- non-recursive shape has regressed.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'memberships'
      and policyname = 'memberships_select'
      and coalesce(qual, '') ilike '%auth.uid()%'
      and coalesce(qual, '') not ilike '%is_member%'
      and coalesce(qual, '') not ilike '%has_role%') then
    v_missing_cols := array_append(v_missing_cols, 'memberships:self-read select policy');
  end if;

  -- AUTH (0025): a write policy gated on has_role must exist (admins manage members).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'memberships'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and (coalesce(qual, '') ilike '%has_role%' or coalesce(with_check, '') ilike '%has_role%')) then
    v_missing_cols := array_append(v_missing_cols, 'memberships:has_role write policy');
  end if;

  -- ingest_persist must exist (its grain is locked by the constraint check above).
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  end if;

  -- The delete/clear lifecycle must exist AND RETURN bigint (a void body is the
  -- silent no-op). A missing-or-void function is reported as drift either way.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'delete_sitting'
                   and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.delete_sitting()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'clear_sitting_data'
                   and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.clear_sitting_data()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'reset_cycle_for_reingest'
                   and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.reset_cycle_for_reingest()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'clear_cycle_ingest'
                   and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'app.clear_cycle_ingest()->bigint');
  end if;

  -- AUTH (0025): the single primitive must be workspace-aware. A strict, drifted body
  -- (only `cycle_id = p_cycle`) authorizes nothing for a workspace admin — the exact
  -- cause of the paired delete/replace "forbidden".
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'has_role'
                   and pg_get_functiondef(p.oid) ilike '%cycle_id is null%') then
    v_missing_fns := array_append(v_missing_fns, 'app.has_role(workspace-scope)');
  end if;
  -- is_member must exist (derived from has_role; "any membership" reader).
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'is_member') then
    v_missing_fns := array_append(v_missing_fns, 'app.is_member');
  end if;

  return jsonb_build_object(
    'ok', (cardinality(v_missing_cols) = 0 and cardinality(v_missing_fns) = 0),
    'migration', '0025',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;

-- ============================================================================
-- TRANSACTION 2 — the minimal, non-recursive memberships policy set.
-- (Locks the memberships table; replaces no function, so it can't deadlock
-- against the helper replacements in transaction 1.)
--
-- SELECT is the pure self-read (calls NO memberships-reading function → no
-- recursion by construction). Writes are three per-command policies gated on the
-- single primitive at the row's cycle (workspace admin matches every row; cycle
-- admin matches their cycle) — kept OFF `FOR ALL` so the write guard never leaks
-- onto SELECT. If this transaction aborts under load (lock_timeout), just re-run
-- the file — transaction 1 already committed and both halves are idempotent.
-- ============================================================================
begin;

set local lock_timeout = '15s';

-- Drop the tangled legacy policies (any of the historical names).
drop policy if exists memberships_select on memberships;
drop policy if exists memberships_all    on memberships;
drop policy if exists memberships_insert on memberships;
drop policy if exists memberships_update on memberships;
drop policy if exists memberships_delete on memberships;

-- SELECT: you always see your OWN membership rows, and only those. No function
-- call → no path back into `memberships` RLS.
create policy memberships_select on memberships for select
  using (user_id = auth.uid());

-- WRITE: a workspace admin (cycle_id IS NULL lead_admin) manages every row; a cycle
-- admin manages their own cycle's rows. `has_role(cycle_id, 'lead_admin')` encodes
-- both. Per-command (not FOR ALL) so SELECT stays the pure self-read above.
create policy memberships_insert on memberships for insert
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));
create policy memberships_update on memberships for update
  using      (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));
create policy memberships_delete on memberships for delete
  using      (app.has_role(cycle_id, array['lead_admin']::member_role[]));

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration). Expect ok=true, migration '0025', empty arrays.
--   select public.schema_health();
--
-- Confirm the single primitive is workspace-aware (source carries the global clause):
--   select pg_get_functiondef('app.has_role(uuid, member_role[])'::regprocedure)
--     ilike '%cycle_id is null%' as workspace_aware;   -- expect true
--
-- Then, on the live app as the workspace admin: Replace files (no "forbidden") and
-- Delete this sitting (clears to the empty Upload state). A member account cannot
-- delete/replace.
-- ----------------------------------------------------------------------------
