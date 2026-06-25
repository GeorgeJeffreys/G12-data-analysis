-- ============================================================================
-- G12++ — Test Centre management: admin-gate the mutations + add year reassignment
-- Migration 0013_test_centre_admin_management.sql
--
-- This closes TODO(P3) from 0010: the centre-management RPCs were granted to
-- `authenticated` and did NOT check a role, so any signed-in user could create /
-- edit / (de)activate a centre. This migration re-defines them to enforce the
-- workspace-admin check SERVER-SIDE (mirroring the cut-score / borderline lock in
-- set_workspace_setting → app.is_workspace_admin()), so a non-admin is rejected at
-- the data layer regardless of what the client does.
--
-- It also adds the missing reassignment RPC:
--   * move_exam_year_to_centre — move an existing exam_year onto a different centre.
--
-- WHAT THIS IS NOT
--   Reassigning a year is PURE LABELLING. test_centre_id is a partition / scoping
--   key only (0010): it is never a scoring input. Moving a year is a single
--   `update exam_years set test_centre_id = ...`; it does NOT touch exam_cycles,
--   results, responses, item_stats, grades or any engine output, and it does NOT
--   re-run scoring, cut scores, the award rule or the safeguard. The year's
--   sittings + result rows inherit the new centre IMPLICITLY through the
--   exam_cycles.year_id → exam_years.test_centre_id chain — nothing grade-bearing
--   is read, rewritten, recomputed or lost.
--
-- SECURITY MODEL — preserved exactly
--   * items.status stays definer-only / trigger-driven (untouched here).
--   * test_centres + exam_years writes remain definer-only (0005/0010 revoked the
--     direct client grants); these RPCs are the only write path, and now each one
--     also asserts admin before it writes.
--   * Every mutation writes an audit row via app.audit(...) — the Cambridge
--     check-in trail. The new move RPC audits before/after so the centre change is
--     fully reconstructable.
--
-- Idempotent / forward-only: every function is CREATE OR REPLACE on its existing
-- 0010 signature (or brand-new), and the grants are idempotent. No table DDL.
--
-- The human runs this in the Supabase SQL editor AFTER 0010–0012. Do not
-- auto-apply. Reversibility: see 0013_test_centre_admin_management.rollback.sql.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. create_test_centre — now admin-gated. Same signature, slug-derivation and
--    friendly duplicate-code/slug message as 0010; the only change is the
--    app.is_workspace_admin() guard at the top so a non-admin can't create.
-- ----------------------------------------------------------------------------
create or replace function public.create_test_centre(
  p_name text, p_code text, p_slug text default null, p_region text default 'eu-west')
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t test_centres; v_slug text;
begin
  if not app.is_workspace_admin() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name is required'; end if;
  if coalesce(trim(p_code), '') = '' then raise exception 'code is required'; end if;
  v_slug := coalesce(nullif(trim(p_slug), ''),
                     trim(both '-' from lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'))));
  begin
    insert into test_centres (name, code, slug, region)
    values (trim(p_name), trim(p_code), v_slug, p_region)
    returning * into t;
  exception when unique_violation then
    raise exception 'a test centre with code "%" or slug "%" already exists',
      trim(p_code), v_slug;
  end;
  perform app.audit(null, 'create', 'test_centre', t.id::text, null, to_jsonb(t));
  return t;
end $$;

-- ----------------------------------------------------------------------------
-- 2. update_test_centre — now admin-gated. Renames / re-codes / toggles active;
--    re-derives the slug when the name changes AND no explicit slug was already
--    set away from the name (so an edited name keeps a route-safe slug without
--    silently clobbering a hand-set one). NULL args leave a field as-is.
-- ----------------------------------------------------------------------------
create or replace function public.update_test_centre(
  p_id uuid, p_name text default null, p_code text default null, p_active boolean default null)
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t_before test_centres; t_after test_centres; v_slug text;
begin
  if not app.is_workspace_admin() then raise exception 'not authorized'; end if;
  select * into t_before from test_centres where id = p_id;
  if not found then raise exception 'test centre not found'; end if;

  -- Re-derive the slug from a non-empty new name only when the current slug still
  -- matches the current name (i.e. it was auto-derived, not hand-set). This keeps
  -- the route-safe slug in step with a rename without overwriting a custom slug.
  v_slug := t_before.slug;
  if nullif(trim(p_name), '') is not null
     and t_before.slug = trim(both '-' from lower(regexp_replace(t_before.name, '[^a-zA-Z0-9]+', '-', 'g')))
  then
    v_slug := trim(both '-' from lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g')));
  end if;

  begin
    update test_centres set
      name   = coalesce(nullif(trim(p_name), ''), name),
      code   = coalesce(nullif(trim(p_code), ''), code),
      slug   = v_slug,
      active = coalesce(p_active, active),
      updated_at = now()
    where id = p_id
    returning * into t_after;
  exception when unique_violation then
    raise exception 'a test centre with code "%" or slug "%" already exists',
      coalesce(nullif(trim(p_code), ''), t_before.code), v_slug;
  end;
  perform app.audit(null, 'update', 'test_centre', p_id::text, to_jsonb(t_before), to_jsonb(t_after));
  return t_after;
end $$;

-- ----------------------------------------------------------------------------
-- 3. set_test_centre_active — now admin-gated. Convenience (de)activation toggle.
-- ----------------------------------------------------------------------------
create or replace function public.set_test_centre_active(p_id uuid, p_active boolean)
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t test_centres;
begin
  if not app.is_workspace_admin() then raise exception 'not authorized'; end if;
  update test_centres set active = p_active, updated_at = now()
    where id = p_id returning * into t;
  if not found then raise exception 'test centre not found'; end if;
  perform app.audit(null, case when p_active then 'activate' else 'deactivate' end,
                    'test_centre', p_id::text, null, to_jsonb(t));
  return t;
end $$;

-- ----------------------------------------------------------------------------
-- 4. move_exam_year_to_centre — reassign one exam_year to a different centre.
--
--    PURE LABELLING (see header): a single UPDATE of the partition key. No
--    exam_cycles / results / responses / item_stats / grades row is touched, and
--    the engine is NOT re-run. The year's sittings + every result row keep their
--    grades and simply inherit the new centre through the year FK.
--
--    Admin-gated server-side. Respects unique (name, region, test_centre_id):
--    moving a year onto a centre that already runs a year of the same name+region
--    raises a FRIENDLY message (matching create_test_centre's style), never a raw
--    unique_violation. Idempotent: moving to the current centre is a no-op.
-- ----------------------------------------------------------------------------
create or replace function public.move_exam_year_to_centre(
  p_year_id uuid, p_test_centre_id uuid)
returns exam_years language plpgsql security definer set search_path = public, app as $$
declare y_before exam_years; y_after exam_years; v_centre_name text;
begin
  if not app.is_workspace_admin() then raise exception 'not authorized'; end if;

  select * into y_before from exam_years where id = p_year_id;
  if not found then raise exception 'exam year not found'; end if;

  select name into v_centre_name from test_centres where id = p_test_centre_id;
  if not found then raise exception 'test centre not found'; end if;

  -- Idempotent fast path: already in the target centre — nothing to write/audit.
  if y_before.test_centre_id = p_test_centre_id then
    return y_before;
  end if;

  -- The ONLY mutation: relabel the year's centre. Grade-bearing data is untouched
  -- and the engine is not recomputed (centre is a scoping key, never a score input).
  begin
    update exam_years set test_centre_id = p_test_centre_id, updated_at = now()
      where id = p_year_id
      returning * into y_after;
  exception when unique_violation then
    raise exception 'centre "%" already has a % year', v_centre_name, y_before.name;
  end;

  perform app.audit(null, 'move', 'exam_year', p_year_id::text,
                    to_jsonb(y_before), to_jsonb(y_after));
  return y_after;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Grants. Each function asserts admin internally (section 1–4), so they are
--    granted to `authenticated` exactly like set_workspace_setting — the grant
--    only lets the call reach the function; the function decides who may write.
-- ----------------------------------------------------------------------------
grant execute on function public.create_test_centre(text, text, text, text)    to authenticated;
grant execute on function public.update_test_centre(uuid, text, text, boolean) to authenticated;
grant execute on function public.set_test_centre_active(uuid, boolean)         to authenticated;
grant execute on function public.move_exam_year_to_centre(uuid, uuid)          to authenticated;

commit;
