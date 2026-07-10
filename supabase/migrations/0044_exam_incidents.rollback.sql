-- Rollback for 0044_exam_incidents.sql. Drops the staging table + its two
-- SECURITY DEFINER functions. No base scores or adjustments were ever written by
-- 0044, so there is nothing else to unwind.
drop function if exists public.upsert_exam_incidents(uuid, uuid, text, jsonb);
drop function if exists public.clear_exam_incidents(uuid);
drop table if exists exam_incidents cascade;
