-- ============================================================================
-- Rollback for 0032_delete_cycle.sql
--   Drops the delete_cycle function. Sittings can still be deleted via
--   delete_sitting (unchanged). Run in the Supabase SQL editor (EU).
-- ============================================================================

begin;

drop function if exists public.delete_cycle(uuid);

commit;
