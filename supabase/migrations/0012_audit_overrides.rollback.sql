-- Rollback for 0012_audit_overrides.sql — drops the override layer and restores
-- the pre-0012 audit_log shape. Non-destructive to existing audit rows except
-- for the three added columns (which carry only override provenance).

drop function if exists public.override_item_exclusion(uuid, boolean, text);
drop function if exists public.override_mark_adjustment(uuid, uuid, uuid, numeric, text);

drop policy if exists audit_admin_select on audit_log;

drop function if exists app.audit_override(uuid, text, text, text, jsonb, jsonb, text, uuid);
drop function if exists app.is_global_admin();

alter table audit_log drop column if exists is_override;
alter table audit_log drop column if exists prior_actor_id;
alter table audit_log drop column if exists reason;
