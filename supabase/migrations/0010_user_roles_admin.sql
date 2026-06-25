-- 0010_user_roles_admin.sql
-- Workspace-global user roles (admin vs user) + lock the Cut Scores page to admins.
--
-- Context: the per-cycle `memberships` roles (lead_admin / reviewer / viewer)
-- govern access WITHIN a sitting. This adds an orthogonal, workspace-GLOBAL role
-- on every auth user — `admin` or `user` — that decides governance: only an
-- admin may set cut scores. Regular pipeline users keep full read access and the
-- rest of the pipeline; they get a read-only view of the recommended cut scores.
--
-- Defense in depth: the real lock lives HERE (RPC role check + RLS). The client
-- guard (hide/disable the editor) is UX only and is NOT the protection.
--
-- Mirrors the existing security style: SECURITY DEFINER mutations with an explicit
-- role gate, column/row RLS, no new client-writable path to protected data. The
-- `items.status` model and every other policy are untouched.

-- ----------------------------------------------------------------------------
-- 1. Global role enum.
-- ----------------------------------------------------------------------------
do $$ begin
  create type app_role as enum ('admin','user');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. profiles — one row per auth user, carrying the global role.
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       app_role    not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- ----------------------------------------------------------------------------
-- 3. app.is_admin() — the global-admin predicate. SECURITY DEFINER so it reads
--    `profiles` as the owner (no RLS recursion when policies reference it).
-- ----------------------------------------------------------------------------
create or replace function app.is_admin()
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. profiles RLS.
--    * select: a user reads their OWN role; an admin reads everyone's.
--    * write : ONLY admins assign/alter roles. There is no self-promotion path —
--      a non-admin can write nothing, so nobody can grant themselves admin.
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (user_id = auth.uid() or app.is_admin());

drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles for all
  using (app.is_admin())
  with check (app.is_admin());

-- ----------------------------------------------------------------------------
-- 5. set_user_role(user, role) — admin-only role assignment RPC. SECURITY
--    DEFINER + explicit gate, mirroring the existing RPCs. Audited.
-- ----------------------------------------------------------------------------
create or replace function public.set_user_role(p_user uuid, p_role app_role)
returns profiles language plpgsql security definer set search_path = public, app as $$
declare v_before jsonb; v_after profiles;
begin
  if not app.is_admin() then
    raise exception 'not authorized';
  end if;
  select to_jsonb(p) into v_before from profiles p where p.user_id = p_user;
  insert into profiles (user_id, role)
  values (p_user, p_role)
  on conflict (user_id) do update set role = excluded.role, updated_at = now()
  returning * into v_after;
  perform app.audit(null, 'role_change', 'profile', p_user::text, v_before, to_jsonb(v_after));
  return v_after;
end $$;

grant execute on function public.set_user_role(uuid, app_role) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Lock cut scores to admins — both layers (defense in depth).
--    (a) The SECURITY DEFINER mutation: an admin who is also a member of the
--        cycle may write a scheme. (Keeping the membership check preserves the
--        existing cycle scoping; the NEW requirement is global admin.) A
--        lead_admin who is not a global admin can no longer change cut scores.
-- ----------------------------------------------------------------------------
create or replace function public.save_grade_scheme(
  p_cycle uuid, p_scope text, p_method scheme_method, p_bands jsonb)
returns grade_schemes language plpgsql security definer set search_path = public, app as $$
declare v_before jsonb; v_after grade_schemes;
begin
  if not (app.is_admin() and app.is_member(p_cycle)) then
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

--    (b) Backstop the direct-table path: grade_schemes writes require admin too,
--        so even a hand-crafted client write (bypassing the RPC) is rejected.
--        Reads are unchanged — every member still sees the cut scores.
drop policy if exists grade_schemes_write on grade_schemes;
create policy grade_schemes_write on grade_schemes for all
  using (app.is_admin() and app.is_member(cycle_id))
  with check (app.is_admin() and app.is_member(cycle_id));

-- ----------------------------------------------------------------------------
-- 7. BOOTSTRAP THE FIRST ADMIN(S).
--    RLS only lets an existing admin assign roles, so the very first admins must
--    be seeded here (run as the table owner in the Supabase SQL editor, which
--    bypasses RLS). Replace the emails with George's and Ksenia's (Alsama admin)
--    sign-in addresses, then run. Re-running is safe (idempotent upsert).
--
--    insert into profiles (user_id, role)
--    select id, 'admin'
--    from auth.users
--    where lower(email) in (
--      'george@alsamaproject.com',   -- George
--      'ksenia@alsamaproject.com'    -- Ksenia (Alsama admin)
--    )
--    on conflict (user_id) do update set role = 'admin', updated_at = now();
--
--    Everyone else defaults to 'user' (they don't need a profiles row to use the
--    app — a missing row is treated as a non-admin regular user).
