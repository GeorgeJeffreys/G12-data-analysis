-- ============================================================================
-- Rollback for 0013_test_centre_admin_management.sql
--
-- Restores the 0010 (ungated) create_test_centre / update_test_centre /
-- set_test_centre_active and drops the new move_exam_year_to_centre RPC.
--
-- No DATA is affected: 0013 only redefined functions (no table/column/constraint
-- changes), so this revert is a clean no-questions undo at any time. Any year that
-- was reassigned with move_exam_year_to_centre KEEPS its new centre — that is just
-- a stored test_centre_id value, identical to one set via the centre-aware
-- create_exam_year, so there is nothing to unwind.
--
-- Run in the Supabase SQL editor to revert to the 0010 behaviour.
-- ============================================================================

begin;

-- 1. Drop the reassignment RPC added by 0013.
drop function if exists public.move_exam_year_to_centre(uuid, uuid);

-- 2. Restore the 0010 create_test_centre (no admin gate).
create or replace function public.create_test_centre(
  p_name text, p_code text, p_slug text default null, p_region text default 'eu-west')
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t test_centres; v_slug text;
begin
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

-- 3. Restore the 0010 update_test_centre (no admin gate, no slug re-derivation).
create or replace function public.update_test_centre(
  p_id uuid, p_name text default null, p_code text default null, p_active boolean default null)
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t_before test_centres; t_after test_centres;
begin
  select * into t_before from test_centres where id = p_id;
  if not found then raise exception 'test centre not found'; end if;
  update test_centres set
    name   = coalesce(nullif(trim(p_name), ''), name),
    code   = coalesce(nullif(trim(p_code), ''), code),
    active = coalesce(p_active, active),
    updated_at = now()
  where id = p_id
  returning * into t_after;
  perform app.audit(null, 'update', 'test_centre', p_id::text, to_jsonb(t_before), to_jsonb(t_after));
  return t_after;
end $$;

-- 4. Restore the 0010 set_test_centre_active (no admin gate).
create or replace function public.set_test_centre_active(p_id uuid, p_active boolean)
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t test_centres;
begin
  update test_centres set active = p_active, updated_at = now()
    where id = p_id returning * into t;
  if not found then raise exception 'test centre not found'; end if;
  perform app.audit(null, case when p_active then 'activate' else 'deactivate' end,
                    'test_centre', p_id::text, null, to_jsonb(t));
  return t;
end $$;

commit;
