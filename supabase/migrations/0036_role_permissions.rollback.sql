-- 0036 rollback — drop the role_permissions matrix and its two functions. Safe
-- because P1 is additive: nothing in the app consults app.has_permission or
-- set_role_permission yet (P2 introduces the first callers), so removing them
-- restores the exact pre-0036 behaviour.
drop function if exists public.set_role_permission(text, text, boolean);
drop function if exists app.has_permission(uuid, text);
drop policy if exists role_permissions_select on public.role_permissions;
drop table if exists public.role_permissions;
