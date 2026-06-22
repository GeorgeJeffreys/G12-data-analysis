-- ============================================================================
-- One-time wipe of a sitting's ingested rows (Task 5 — unblock testing now).
--
-- The failed 3-CSV uploads (before 0007) were NOT transactional, so they left
-- partial rows behind for the cycle they failed on (assessments / items /
-- participants were inserted before the topic_rollups insert blew up). Run this
-- ONCE in the Supabase SQL editor to clear the current cycle's ingested rows
-- across every related table, so a fresh upload can run from clean data.
--
-- After 0007 ships, future re-uploads self-clear (ingest_persist clears before
-- it inserts), so this script is only needed to unblock the existing debris.
--
-- HOW TO USE
--   1. Apply migration 0007 first (it creates app.clear_cycle_ingest).
--   2. Set the cycle id below (the sitting you were uploading into) and run.
--      The seeded "May 2026" sitting is 3385d4a5-b4c2-5331-a7a9-53a03f3f4869;
--      or look it up:  select id, name from exam_cycles order by created_at;
--
-- This keeps the sitting SHELL (the exam_cycles row, its memberships and year
-- link) and only empties the ingested data — exactly the Task 4 "clear" set.
-- It does NOT touch any other cycle.
-- ============================================================================

begin;

do $$
declare
  v_cycle uuid := '3385d4a5-b4c2-5331-a7a9-53a03f3f4869';  -- <-- set me
begin
  perform app.clear_cycle_ingest(v_cycle);
  -- Return the sitting to the empty Upload state.
  update exam_cycles set status = 'draft', updated_at = now() where id = v_cycle;
  raise notice 'Cleared ingested rows for cycle %', v_cycle;
end $$;

commit;

-- ----------------------------------------------------------------------------
-- Fallback (if 0007 isn't applied yet): the same clear, inlined. Uncomment and
-- set the cycle id. FK-safe order; engine outputs cascade from the parents.
-- ----------------------------------------------------------------------------
-- begin;
-- delete from result_totals  where cycle_id = '3385d4a5-b4c2-5331-a7a9-53a03f3f4869';
-- delete from topic_rollups  where cycle_id = '3385d4a5-b4c2-5331-a7a9-53a03f3f4869';
-- delete from responses      where cycle_id = '3385d4a5-b4c2-5331-a7a9-53a03f3f4869';
-- delete from items          where cycle_id = '3385d4a5-b4c2-5331-a7a9-53a03f3f4869';
-- delete from participants   where cycle_id = '3385d4a5-b4c2-5331-a7a9-53a03f3f4869';
-- delete from assessments    where cycle_id = '3385d4a5-b4c2-5331-a7a9-53a03f3f4869';
-- delete from import_batches where cycle_id = '3385d4a5-b4c2-5331-a7a9-53a03f3f4869';
-- commit;
