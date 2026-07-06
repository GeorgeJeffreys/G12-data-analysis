-- ============================================================================
-- ROLLBACK for 0028_members_manage.sql — drop the new write primitives, restore
-- remove_member to the 0027 body, and restore schema_health to the 0026 body ('0026').
-- ============================================================================
begin;

drop function if exists public.upsert_member_role(uuid, uuid, member_role);
drop function if exists public.remove_person(uuid);

-- remove_member restored to the 0027 body (admin gate + self-guard, no last-admin guard).
create or replace function public.remove_member(p_user uuid, p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized: only an admin may remove members';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot remove your own membership';
  end if;
  delete from memberships where user_id = p_user and cycle_id is not distinct from p_cycle;
end $$;
revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

drop function if exists app.other_workspace_admin_exists(uuid);

-- schema_health restored to the 0026 body (reports '0026').
create or replace function public.schema_health()
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare v_missing_cols text[] := '{}'; v_missing_fns text[] := '{}';
begin
  if to_regclass('public.items') is null or not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='items' and column_name='item_set') then
    v_missing_cols := array_append(v_missing_cols, 'items.item_set');
  end if;
  if not exists (select 1 from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typname='member_role' and e.enumlabel='lead_admin') then
    v_missing_cols := array_append(v_missing_cols, 'enum member_role:lead_admin');
  end if;
  if not exists (select 1 from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typname='member_role' and e.enumlabel='analyst') then
    v_missing_cols := array_append(v_missing_cols, 'enum member_role:analyst');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='memberships'
      and policyname='memberships_select' and coalesce(qual,'') ilike '%auth.uid()%'
      and coalesce(qual,'') not ilike '%is_member%' and coalesce(qual,'') not ilike '%has_role%') then
    v_missing_cols := array_append(v_missing_cols, 'memberships:self-read select policy');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='memberships'
      and cmd in ('INSERT','UPDATE','DELETE') and (coalesce(qual,'') ilike '%has_role%' or coalesce(with_check,'') ilike '%has_role%')) then
    v_missing_cols := array_append(v_missing_cols, 'memberships:has_role write policy');
  end if;
  if to_regclass('public.sittings') is null then
    v_missing_cols := array_append(v_missing_cols, 'table sittings');
  elsif not exists (select 1 from pg_constraint where conrelid='public.sittings'::regclass and contype='p') then
    v_missing_cols := array_append(v_missing_cols, 'sittings:primary key(cycle_id,qm_result_id)');
  end if;
  if to_regclass('public.responses') is null or not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='responses' and column_name='question_id') then
    v_missing_cols := array_append(v_missing_cols, 'responses.question_id');
  end if;
  if not exists (select 1 from pg_constraint where conname='responses_cycle_id_qm_result_id_question_id_key') then
    v_missing_cols := array_append(v_missing_cols, 'responses:unique(cycle_id,qm_result_id,question_id)');
  end if;
  if to_regclass('public.responses') is not null and to_regclass('public.sittings') is not null
     and not exists (select 1 from pg_constraint where conrelid='public.responses'::regclass and contype='f'
         and confrelid='public.sittings'::regclass and confdeltype='c') then
    v_missing_cols := array_append(v_missing_cols, 'responses->sittings:on delete cascade');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='delete_sitting' and p.prorettype='bigint'::regtype) then
    v_missing_fns := array_append(v_missing_fns, 'public.delete_sitting()->bigint');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='has_role' and pg_get_functiondef(p.oid) ilike '%cycle_id is null%') then
    v_missing_fns := array_append(v_missing_fns, 'app.has_role(workspace-scope)');
  end if;
  return jsonb_build_object('ok', (cardinality(v_missing_cols)=0 and cardinality(v_missing_fns)=0),
    'migration', '0026', 'missing_columns', to_jsonb(v_missing_cols), 'missing_functions', to_jsonb(v_missing_fns));
end $$;
revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;
