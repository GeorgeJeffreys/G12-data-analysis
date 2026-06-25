-- 0010_user_roles_admin.rollback.sql
-- Reverse 0010: restore the lead_admin gating on cut scores and drop the global
-- role machinery. Run in the Supabase SQL editor if 0010 must be undone.

-- 6b. Restore the original grade_schemes write policy (lead_admin of the cycle).
drop policy if exists grade_schemes_write on grade_schemes;
create policy grade_schemes_write on grade_schemes for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- 6a. Restore the original save_grade_scheme gate (lead_admin).
create or replace function public.save_grade_scheme(
  p_cycle uuid, p_scope text, p_method scheme_method, p_bands jsonb)
returns grade_schemes language plpgsql security definer set search_path = public, app as $$
declare v_before jsonb; v_after grade_schemes;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  select to_jsonb(g) into v_before from grade_schemes g
    where g.cycle_id = p_cycle and g.scope = p_scope;
  insert into grade_schemes (cycle_id, scope, method, bands)
  values (p_cycle, p_scope, p_method, p_bands)
  on conflict (cycle_id, scope) do update
    set method = excluded.method, bands = excluded.bands, updated_at = now()
  returning * into v_after;
  perform app.audit(p_cycle, 'boundary_change', 'grade_scheme', p_scope,
                    v_before, to_jsonb(v_after));
  return v_after;
end $$;

-- 5. Drop the role-assignment RPC.
drop function if exists public.set_user_role(uuid, app_role);

-- 4. Drop profiles policies.
drop policy if exists profiles_admin_write on profiles;
drop policy if exists profiles_select on profiles;

-- 3. Drop the admin predicate.
drop function if exists app.is_admin();

-- 2. Drop the table.
drop table if exists profiles;

-- 1. Drop the enum.
drop type if exists app_role;
