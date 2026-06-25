-- Rollback for 0011 — restore `set_workspace_setting` to the un-validated form
-- (auth check + upsert + audit, no per-key validation). Mirrors the definition in
-- 0003_adjustments_essays_config.sql.

create or replace function public.set_workspace_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_workspace_admin() then
    raise exception 'not authorized';
  end if;
  insert into workspace_settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform app.audit(null, 'set_workspace_setting', 'workspace', p_key, null, p_value);
end $$;
