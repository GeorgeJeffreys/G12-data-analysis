-- ============================================================================
-- G12++ — RESTORE WORKSPACE-SCOPE AUTHORIZATION: make a workspace admin
-- (memberships.cycle_id IS NULL) authorize cycle mutations again, and make the
-- drift probe actually catch it. Migration 0024_authorization_workspace_scope.sql
--
-- WHY THIS EXISTS (the "forbidden" that broke BOTH delete AND replace)
--   After prompt 18/19 restored the delete + re-ingest lifecycle, BOTH cycle
--   data-mutations broke together with a permission word:
--     * "Replace files" → POST /api/cycles/:id/ingest → HTTP 403 {"error":"forbidden"}
--     * Delete / Clear   → delete_sitting()/clear_sitting_data() → 'not authorized'
--   Two different mutations failing together, both on PERMISSION, is one
--   regression — not a logic bug in either path.
--
--   Root cause: every cycle-scoped authorization in the suite routes through two
--   SECURITY DEFINER helpers — `app.is_member(cycle)` and `app.has_role(cycle,
--   roles[])`. Migration 0002 widened both so a WORKSPACE membership
--   (`cycle_id IS NULL`, "admin over every cycle" — see RUNBOOK §2) matches ANY
--   cycle: `(m.cycle_id IS NULL OR m.cycle_id = p_cycle)`. On the live EU DB those
--   helpers had DRIFTED back to the strict 0001 bodies (`m.cycle_id = p_cycle`
--   only) — 0002's redefinition was never re-affirmed by any later migration, so a
--   partial rebuild / re-run of 0001 silently reverted it. With the strict bodies a
--   `cycle_id IS NULL` admin authorizes NOTHING:
--     * `app.has_role(cycle,'lead_admin')` → false → `delete_sitting` raises
--       'not authorized' (surfaced red in the UI);
--     * the `memberships_select` RLS policy (`using app.is_member(cycle_id)`) can no
--       longer surface the admin's OWN workspace row to them, so the ingest route's
--       membership read returns zero admin rows → the app gate answers "forbidden".
--   `schema_health()` never probed these helpers, so — like every drift in this
--   saga — the regression passed the probe as ok=true.
--
-- WHAT THIS DOES (all idempotent — safe on a drifted DB AND safe to re-run)
--   1. Re-affirms `app.is_member(uuid)` and `app.has_role(uuid, member_role[])` at
--      the 0002 GLOBAL-aware definition, so a workspace (`cycle_id IS NULL`) admin
--      authorizes every cycle again — this is what re-permits BOTH delete and
--      replace for the intended admin.
--   2. Corrects `memberships_select` so a user can ALWAYS read their OWN membership
--      rows (`user_id = auth.uid()` OR the existing member test). A self-read leaks
--      nothing — the row IS the fact that you are a member — and it hardens the app
--      gate so RLS drift can never again hide an admin's own workspace row.
--   3. HARDENS `public.schema_health()`: it now asserts the two helpers carry the
--      global `cycle_id is null` clause AND that the memberships self-read policy is
--      present — so this exact drift is flagged, not passed as ok. Reports '0024'.
--
-- SAFETY: no table/column/constraint/DATA change. Only `create or replace` of
-- SECURITY DEFINER helpers, one policy swap, and the read-only probe. The engine +
-- grade-bearing tables are untouched — parity 183/183 unaffected (authorization only).
--
-- The human runs this in the Supabase SQL editor (EU) AFTER 0001–0023. It is the
-- next numbered, append-only migration. Reversible via
-- 0024_authorization_workspace_scope.rollback.sql.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Lock `memberships` FIRST, before replacing the helpers — deadlock safety.
--    Concurrent app traffic reads memberships (AccessShareLock) and THEN calls
--    app.is_member / app.has_role via the RLS policy (a lock on those functions).
--    If this migration replaces those functions first (CREATE OR REPLACE takes an
--    exclusive lock on them) and only then swaps the policy (AccessExclusiveLock on
--    the table), it acquires the two resources in the REVERSE order a live reader
--    holds them — a lock-order inversion that deadlocks (ERROR 40P01: deadlock
--    detected). Taking the table's exclusive lock up front matches the readers'
--    order (table → functions): once held, no new memberships-reader can enter the
--    conflicting state, so the function replacements and the policy swap below are
--    contention-free. `lock_timeout` fails fast (re-run) instead of hanging if the
--    table is momentarily busy.
-- ----------------------------------------------------------------------------
set local lock_timeout = '10s';
lock table memberships in access exclusive mode;

-- ----------------------------------------------------------------------------
-- 1. Re-affirm the GLOBAL-aware membership helpers (0002 bodies). A workspace
--    membership (cycle_id IS NULL) grants the role across ALL cycles:
--        (m.cycle_id IS NULL OR m.cycle_id = p_cycle)
--    Every RLS policy and every SECURITY DEFINER guard (delete_sitting,
--    clear_sitting_data, the config locks, …) routes through these, so restoring
--    them here re-permits the workspace admin everywhere in one paste.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 2. A user may ALWAYS read their OWN membership rows — including a workspace
--    (cycle_id IS NULL) row that `app.is_member(cycle_id)` alone can't surface to
--    its owner under the strict grain. This is what the ingest route's app gate
--    reads to decide "is the caller an admin of this cycle", so it must never be
--    hidden from the caller themselves. Still a self-read only: no other user's
--    rows become visible.
-- ----------------------------------------------------------------------------
drop policy if exists memberships_select on memberships;
create policy memberships_select on memberships for select
  using (user_id = auth.uid() or app.is_member(cycle_id));

-- ----------------------------------------------------------------------------
-- 3. HARDENED drift probe. Beyond the 0023 surface, it now verifies the
--    AUTHORIZATION objects this migration restores:
--      * app.is_member / app.has_role carry the global `cycle_id is null` clause
--        (a strict, drifted body — the silent cause of the "forbidden" — is flagged);
--      * the memberships self-read policy is present.
--    Reports migration '0024'. SECURITY DEFINER + read-only.
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

  -- The membership self-read policy must be present (the app gate depends on it).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'memberships'
      and policyname = 'memberships_select' and coalesce(qual, '') ilike '%auth.uid()%') then
    v_missing_cols := array_append(v_missing_cols, 'memberships:self-read policy');
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

  -- NEW (0024): the membership helpers must honour a workspace (cycle_id IS NULL)
  -- admin. A drifted strict body (only `cycle_id = p_cycle`) authorizes nothing for
  -- a workspace admin — the exact cause of the paired delete/replace "forbidden".
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'is_member'
                   and pg_get_functiondef(p.oid) ilike '%cycle_id is null%') then
    v_missing_fns := array_append(v_missing_fns, 'app.is_member(workspace-scope)');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'has_role'
                   and pg_get_functiondef(p.oid) ilike '%cycle_id is null%') then
    v_missing_fns := array_append(v_missing_fns, 'app.has_role(workspace-scope)');
  end if;

  return jsonb_build_object(
    'ok', (cardinality(v_missing_cols) = 0 and cardinality(v_missing_fns) = 0),
    'migration', '0024',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (run after the migration). Expect ok=true, migration '0024', empty arrays.
--   select public.schema_health();
--
-- Confirm the workspace admin is honoured (run as the signed-in admin, or check the
-- helper source carries the global clause):
--   select pg_get_functiondef('app.has_role(uuid, member_role[])'::regprocedure)
--     ilike '%cycle_id is null%' as workspace_aware;   -- expect true
--
-- Then, on the live app: Replace files (no "forbidden") and Delete (clears to the
-- empty Upload state), and re-ingest reads correct counts.
-- ----------------------------------------------------------------------------
