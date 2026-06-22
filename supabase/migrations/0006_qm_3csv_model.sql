-- ============================================================================
-- G12++ — Questionmark 3-export (Items + Assessments + Topics) richer intake
-- Migration 0006_qm_3csv_model.sql
--
-- The real Questionmark export is THREE CSVs joined on `ResultId` (one
-- participant's sitting of one assessment), not the single combined sheet the
-- original schema assumed. This migration extends the model to hold everything
-- the 3-CSV ingest now carries, faithfully:
--   * QM's trusted per-result totals (total / max / percentage / scoreband),
--     technical status, attempt number and sitting  → new `result_totals`.
--   * Per-topic (curriculum element) rollups from Topics.csv               → new `topic_rollups`.
--   * Per-question type + QuestionStatus (Normal/Beta) + topic name/path   → new `items` columns.
--   * Full participant personal fields (first/last/group)                  → new `participants` columns.
--   * Per-answer question type + status on the immutable response facts    → new `responses` columns.
--   * Subject QM max + sitting tag                                         → new `assessments` columns.
--
-- Design notes
--   * REUSES existing tables wherever possible (assessments / items /
--     participants / responses just gain columns); only the two genuinely new
--     grains (per-result totals, per-topic rollups) become new tables.
--   * Scoring policy is deliberately NOT encoded here. QuestionStatus (Beta),
--     essay half-weighting and the scored max live in the scoring layer; this
--     migration only stores the faithful intake. Every question is retained.
--   * QuestionStatus is informational. `result_totals` are QM's own numbers,
--     trusted (the ingest asserts they reconcile with the item-level sums).
--
-- Reversibility: every change is additive (new nullable columns, new tables,
-- new enum). The companion `0006_qm_3csv_model.rollback.sql` drops them with no
-- loss to any 0001–0005 data.
--
-- The human runs this in the Supabase SQL editor AFTER 0001–0005. Do not
-- auto-apply.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Question-type enum (the six QM types seen in the real export). Stored for
--    reporting; never used to filter (every question counts).
-- ----------------------------------------------------------------------------
do $$ begin
  create type question_type as enum
    ('Multiple Choice','Essay','Likert','Yes No','Explanation','Pull Down List','Other');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. items — per-question metadata from Items.csv.
--    `question_status` ('Normal'/'Beta') is INFORMATIONAL only (no filtering).
--    `question_type` stored as text-compatible enum-ish text to tolerate any
--    future QM type without a migration; topic name/path carried verbatim.
-- ----------------------------------------------------------------------------
alter table items add column if not exists question_type   text;
alter table items add column if not exists question_status text;   -- 'Normal' | 'Beta'
alter table items add column if not exists topic_name      text;
alter table items add column if not exists topic_path       text;

-- Clients may set the new descriptive columns at ingest (item.status enum from
-- 0001 stays definer-only; these are plain metadata).
grant update (question_type, question_status, topic_name, topic_path)
  on items to authenticated;

-- ----------------------------------------------------------------------------
-- 3. participants — retain every personal field from Assessments.csv.
--    (full_name / email / dob / gender already exist from 0001.)
-- ----------------------------------------------------------------------------
alter table participants add column if not exists first_name text;   -- PII
alter table participants add column if not exists last_name  text;   -- PII
alter table participants add column if not exists group_name text;   -- cohort label

grant update (first_name, last_name, group_name) on participants to authenticated;

-- ----------------------------------------------------------------------------
-- 4. responses — carry the per-answer question type + status alongside the
--    immutable score facts (responses stay INSERT-only; no UPDATE/DELETE grant).
-- ----------------------------------------------------------------------------
alter table responses add column if not exists question_type   text;
alter table responses add column if not exists question_status text;

-- ----------------------------------------------------------------------------
-- 5. assessments — subject-level QM max + sitting tag.
-- ----------------------------------------------------------------------------
alter table assessments add column if not exists qm_max_score numeric;
alter table assessments add column if not exists sitting      text;     -- e.g. 'MAY2026'

grant update (qm_max_score, sitting) on assessments to authenticated;

-- ----------------------------------------------------------------------------
-- 6. result_totals — one row per ResultId (participant's sitting of an
--    assessment). Holds QM's TRUSTED computed totals plus the technical flag,
--    attempt number and sitting. `reconciled` records whether the ingest's
--    integrity guard found the item-level sums matching QM's stated totals.
-- ----------------------------------------------------------------------------
create table if not exists result_totals (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references exam_cycles(id) on delete cascade,
  assessment_id     uuid not null references assessments(id) on delete cascade,
  participant_id    uuid not null references participants(id) on delete cascade,
  qm_result_id      text not null,                 -- the QM ResultId join key
  total_score       numeric not null,              -- ResultTotalScore (trusted)
  maximum_score     numeric not null,              -- ResultMaximumScore (trusted)
  percentage_score  numeric,                       -- ResultPercentageScore
  scoreband         text,                          -- ResultScorebandName
  result_status     text,                          -- 'Finished OK' / 'Finished Abnormally' / …
  attempt_number    integer,                       -- ResultAssessmentAttemptNumber
  sitting           text,                          -- e.g. 'MAY2026'
  reconciled        boolean not null default true, -- integrity-guard outcome
  created_at        timestamptz not null default now(),
  unique (cycle_id, qm_result_id)
);

-- ----------------------------------------------------------------------------
-- 7. topic_rollups — one row per participant per topic (curriculum element)
--    from Topics.csv. QM's per-topic score/max/percentage/count, trusted.
-- ----------------------------------------------------------------------------
create table if not exists topic_rollups (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references exam_cycles(id) on delete cascade,
  assessment_id     uuid not null references assessments(id) on delete cascade,
  participant_id    uuid not null references participants(id) on delete cascade,
  qm_result_id      text not null,
  qm_topic_id       text,
  topic_name        text not null,
  topic_path        text,
  score             numeric not null,
  maximum_score     numeric not null,
  percentage_score  numeric,
  question_count    integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (cycle_id, qm_result_id, topic_name)
);

-- ----------------------------------------------------------------------------
-- 8. RLS — same model as the rest of the cycle's data: members read; lead/admin
--    writes (the privileged ingest write path uses the secret-key admin client,
--    which bypasses RLS, exactly like responses/items today).
-- ----------------------------------------------------------------------------
alter table result_totals enable row level security;
alter table topic_rollups enable row level security;

create policy result_totals_select on result_totals for select
  using (app.is_member(cycle_id));
create policy result_totals_write on result_totals for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

create policy topic_rollups_select on topic_rollups for select
  using (app.is_member(cycle_id));
create policy topic_rollups_write on topic_rollups for all
  using (app.has_role(cycle_id, array['lead_admin']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin']::member_role[]));

-- ----------------------------------------------------------------------------
-- 9. import_batches — record the three source filenames + the reconciliation
--    summary for the upload audit trail.
-- ----------------------------------------------------------------------------
alter table import_batches add column if not exists items_file       text;
alter table import_batches add column if not exists assessments_file text;
alter table import_batches add column if not exists topics_file       text;
alter table import_batches add column if not exists results_total      integer;
alter table import_batches add column if not exists results_reconciled integer;

commit;
