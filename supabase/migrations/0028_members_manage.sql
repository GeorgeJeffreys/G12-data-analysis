-- ============================================================================
-- G12++ — Manage access entirely from the Users & access UI (no SQL editing).
-- Migration 0028_members_manage.sql
--
-- WHY THIS EXISTS
--   PR #59 wired the Users screen to the real memberships (read + basic write),
--   but an admin still couldn't fully manage access from the UI: changing a
--   workspace role needed an EXISTING row (set_member_role only UPDATEs), and
--   nothing guarded against stripping the last workspace admin (self-lockout).
--   This adds the write primitives the UI needs so an admin grants real, working
--   permissions from the page and never edits SQL:
--     * upsert_member_role  — create-or-update a (user, scope) membership.
--     * remove_member        — remove one (user, scope) membership.
--     * remove_person        — remove ALL of a user's memberships (revoke access).
--   Every write is admin-gated by the C1 primitive `app.has_role`, and a
--   last-workspace-admin GUARD makes demote/remove refuse to drop the final admin.
--
-- WHAT IT DOES NOT DO
--   No change to the C1 `memberships` schema, the `member_role` enum, `app.has_role`,
--   or ANY RLS policy — the model is correct and untouched. Additive functions only.
--   `schema_health()` is extended to assert `upsert_member_role` exists and now
--   reports '0028' (all 0025/0026 probes retained).
--
-- Run AFTER 0001–0027 in the Supabase SQL editor (EU). Idempotent (create or replace).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Last-workspace-admin guard helper: true when SOME workspace admin other than
-- p_user exists. A demote/remove that would leave zero workspace admins is blocked.
-- ----------------------------------------------------------------------------
create or replace function app.other_workspace_admin_exists(p_user uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships
    where cycle_id is null and role = 'lead_admin' and user_id <> p_user
  );
$$;

-- ----------------------------------------------------------------------------
-- upsert_member_role — create-or-update a membership at (p_user, p_cycle).
--   p_cycle IS NULL  → the single workspace-wide row (grants across every cycle).
--   Admin-gated: a workspace admin (or the target cycle's admin) may write.
--   Guard: demoting the LAST workspace admin (p_cycle NULL, p_role <> lead_admin)
--   is refused so an admin can't strip the final admin (incl. themselves).
-- ----------------------------------------------------------------------------
create or replace function public.upsert_member_role(p_user uuid, p_cycle uuid, p_role member_role)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized: only an admin may change member roles';
  end if;

  -- Last-admin guard on a workspace demotion.
  if p_cycle is null and p_role <> 'lead_admin'
     and exists (select 1 from memberships where cycle_id is null and role = 'lead_admin' and user_id = p_user)
     and not app.other_workspace_admin_exists(p_user) then
    raise exception 'cannot demote the last workspace admin — grant another admin first';
  end if;

  if exists (select 1 from memberships where user_id = p_user and cycle_id is not distinct from p_cycle) then
    update memberships set role = p_role where user_id = p_user and cycle_id is not distinct from p_cycle;
  else
    insert into memberships (user_id, cycle_id, role) values (p_user, p_cycle, p_role);
  end if;
end $$;

revoke all on function public.upsert_member_role(uuid, uuid, member_role) from public;
grant execute on function public.upsert_member_role(uuid, uuid, member_role) to authenticated;

-- ----------------------------------------------------------------------------
-- remove_member — remove ONE (user, scope) membership. Admin-gated. Last-admin
-- guard: removing a user's workspace-admin row when no other workspace admin
-- exists is refused. (Supersedes the 0027 body: same signature, adds the guard.)
-- ----------------------------------------------------------------------------
create or replace function public.remove_member(p_user uuid, p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized: only an admin may remove members';
  end if;
  if p_cycle is null
     and exists (select 1 from memberships where cycle_id is null and role = 'lead_admin' and user_id = p_user)
     and not app.other_workspace_admin_exists(p_user) then
    raise exception 'cannot remove the last workspace admin — grant another admin first';
  end if;
  delete from memberships where user_id = p_user and cycle_id is not distinct from p_cycle;
end $$;

revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- remove_person — revoke ALL access for a user (every membership row). Admin-gated,
-- with the same last-workspace-admin guard.
-- ----------------------------------------------------------------------------
create or replace function public.remove_person(p_user uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  -- Only a workspace admin may remove a whole person.
  if not app.has_role(null, array['lead_admin']::member_role[]) then
    raise exception 'not authorized: only a workspace admin may remove a person';
  end if;
  if exists (select 1 from memberships where cycle_id is null and role = 'lead_admin' and user_id = p_user)
     and not app.other_workspace_admin_exists(p_user) then
    raise exception 'cannot remove the last workspace admin — grant another admin first';
  end if;
  delete from memberships where user_id = p_user;
end $$;

revoke all on function public.remove_person(uuid) from public;
grant execute on function public.remove_person(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- schema_health — retains every 0025/0026 probe, additionally asserts the new
-- upsert_member_role primitive, and reports '0028'.
-- ----------------------------------------------------------------------------
create or replace function public.schema_health()
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_missing_cols text[] := '{}';
  v_missing_fns  text[] := '{}';
begin
  if to_regclass('public.items') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'items' and column_name = 'item_set') then
    v_missing_cols := array_append(v_missing_cols, 'items.item_set');
  end if;

  -- AUTH (retained).
  if not exists (select 1 from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'member_role' and e.enumlabel = 'lead_admin') then
    v_missing_cols := array_append(v_missing_cols, 'enum member_role:lead_admin');
  end if;
  if not exists (select 1 from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'member_role' and e.enumlabel = 'analyst') then
    v_missing_cols := array_append(v_missing_cols, 'enum member_role:analyst');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memberships'
      and policyname = 'memberships_select' and coalesce(qual, '') ilike '%auth.uid()%'
      and coalesce(qual, '') not ilike '%is_member%' and coalesce(qual, '') not ilike '%has_role%') then
    v_missing_cols := array_append(v_missing_cols, 'memberships:self-read select policy');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memberships'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and (coalesce(qual, '') ilike '%has_role%' or coalesce(with_check, '') ilike '%has_role%')) then
    v_missing_cols := array_append(v_missing_cols, 'memberships:has_role write policy');
  end if;

  -- PIPELINE (0026 — retained).
  if to_regclass('public.sittings') is null then
    v_missing_cols := array_append(v_missing_cols, 'table sittings');
  elsif not exists (select 1 from pg_constraint where conrelid = 'public.sittings'::regclass and contype = 'p') then
    v_missing_cols := array_append(v_missing_cols, 'sittings:primary key(cycle_id,qm_result_id)');
  end if;
  if to_regclass('public.responses') is null
     or not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'responses' and column_name = 'question_id') then
    v_missing_cols := array_append(v_missing_cols, 'responses.question_id');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'responses_cycle_id_qm_result_id_question_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:unique(cycle_id,qm_result_id,question_id)');
  end if;
  if exists (select 1 from pg_constraint where conname = 'responses_participant_id_item_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:stale-unique(participant_id,item_id)');
  end if;
  if to_regclass('public.responses') is not null and to_regclass('public.sittings') is not null
     and not exists (select 1 from pg_constraint
       where conrelid = 'public.responses'::regclass and contype = 'f'
         and confrelid = 'public.sittings'::regclass and confdeltype = 'c') then
    v_missing_cols := array_append(v_missing_cols, 'responses->sittings:on delete cascade');
  end if;

  -- Functions (retained + new).
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'delete_sitting' and p.prorettype = 'bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.delete_sitting()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'has_role'
                   and pg_get_functiondef(p.oid) ilike '%cycle_id is null%') then
    v_missing_fns := array_append(v_missing_fns, 'app.has_role(workspace-scope)');
  end if;
  -- NEW (0028): the admin-gated membership upsert the UI writes through.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'upsert_member_role') then
    v_missing_fns := array_append(v_missing_fns, 'public.upsert_member_role');
  end if;

  return jsonb_build_object(
    'ok', (cardinality(v_missing_cols) = 0 and cardinality(v_missing_fns) = 0),
    'migration', '0028',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;

-- ----------------------------------------------------------------------------
-- VERIFY: select public.schema_health();  -- expect ok=true, migration '0028'
-- ----------------------------------------------------------------------------
