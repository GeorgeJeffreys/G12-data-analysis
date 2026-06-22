-- ============================================================================
-- Rollback for 0006_qm_3csv_model.sql
--
-- Reverses the 3-CSV intake extension with no loss to any 0001–0005 data. Run
-- in the Supabase SQL editor only if you need to undo migration 0006.
--
-- Drops: the two new tables (result_totals, topic_rollups), the additive columns
-- on items / participants / responses / assessments / import_batches, and the
-- question_type enum. All other tables/columns are untouched.
-- ============================================================================

begin;

-- New tables (drop first; their policies go with them).
drop table if exists topic_rollups;
drop table if exists result_totals;

-- items
alter table items drop column if exists question_type;
alter table items drop column if exists question_status;
alter table items drop column if exists topic_name;
alter table items drop column if exists topic_path;

-- participants
alter table participants drop column if exists first_name;
alter table participants drop column if exists last_name;
alter table participants drop column if exists group_name;

-- responses
alter table responses drop column if exists question_type;
alter table responses drop column if exists question_status;

-- assessments
alter table assessments drop column if exists qm_max_score;
alter table assessments drop column if exists sitting;

-- import_batches
alter table import_batches drop column if exists items_file;
alter table import_batches drop column if exists assessments_file;
alter table import_batches drop column if exists topics_file;
alter table import_batches drop column if exists results_total;
alter table import_batches drop column if exists results_reconciled;

-- enum (only drops cleanly once the columns above are gone).
drop type if exists question_type;

commit;
