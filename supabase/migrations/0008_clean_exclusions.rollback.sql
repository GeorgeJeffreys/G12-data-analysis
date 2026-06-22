-- Rollback for 0008_clean_exclusions.sql
drop function if exists public.clear_clean_removals(uuid, uuid);
drop function if exists public.set_clean_removal(uuid, uuid, text, uuid[], boolean);
drop table if exists clean_exclusions;
