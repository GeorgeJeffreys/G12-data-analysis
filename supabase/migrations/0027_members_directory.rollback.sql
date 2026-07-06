-- ============================================================================
-- ROLLBACK for 0027_members_directory.sql — drop the additive member-directory
-- RPCs. No schema/policy/data was changed, so this is a clean removal.
-- ============================================================================
begin;
drop function if exists public.invite_member(text, member_role, uuid);
drop function if exists public.remove_member(uuid, uuid);
drop function if exists public.set_member_role(uuid, uuid, member_role);
drop function if exists public.list_members();
commit;
