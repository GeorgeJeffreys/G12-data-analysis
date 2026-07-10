-- Rollback for 0043_overall_analytics_seed.sql
-- ----------------------------------------------------------------------------
-- Removes EVERY synthetic Overall-analytics seed row and nothing else. All seed
-- data hangs off test centres whose `slug` begins `seed-ov-`, so deleting by that
-- prefix (in FK-safe order) takes the whole graph with it:
--   grades / participant_scores / score_runs / participants / assessments cascade
--   from exam_cycles (ON DELETE CASCADE), so we delete cycles first, then the
--   years, then the centres. Real cohort data is never matched by the prefix.
--
-- RUN AS SERVICE ROLE in the Supabase SQL editor. Safe to run more than once.
-- ----------------------------------------------------------------------------

begin;

-- 1. Cycles (cascades assessments, participants, score_runs, participant_scores,
--    grades, and every other cycle-scoped child table).
delete from exam_cycles
where year_id in (
  select y.id from exam_years y
  join test_centres t on t.id = y.test_centre_id
  where t.slug like 'seed-ov-%'
);

-- 2. The synthetic years.
delete from exam_years
where test_centre_id in (select id from test_centres where slug like 'seed-ov-%');

-- 3. The synthetic centres.
delete from test_centres where slug like 'seed-ov-%';

commit;
