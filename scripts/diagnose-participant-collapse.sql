-- ============================================================================
-- READ-ONLY DIAGNOSTIC — trace distinct participants per subject at each pipeline
-- stage in the LIVE Supabase database. Finds where Applicable Math drops below 15.
--
-- THROWAWAY. This file writes nothing and is NOT a migration — run it in the
-- Supabase SQL editor (EU) and paste the output back. It answers, from the real
-- persisted rows:
--   1. stage x subject -> distinct participants (against the target 15/11/12/9/10)
--   2. the FIRST stage Applicable Math reads below 15 (where the collapse is)
--   3. for Applicable Math: which participants are present vs the 15 expected,
--      and whether the shortfall is MERGED (fewer rows, shared identity) or
--      DROPPED (missing rows)
--   4. whether the rows are STALE (ingested before the identity fixes) or fresh
--      (timestamps of participants vs the latest import batch)
--
-- The pipeline stages (from the migrations):
--   INGEST        participants / responses / result_totals   (raw persisted intake)
--   CLEANED COHORT participants minus staff/test + clean_exclusions row removals
--   MATERIALISED  participant_scores (via score_runs)         (the Score page)
--
-- Target (staff excluded): Applicable Math 15, English 11, Scientific 12,
-- Arabic 9, Life 10. Item counts already correct (41/63/36/31/25).
-- ============================================================================

-- Resolve the live cycle (most recent), mirroring hydrate()'s `cycles[0]`.
-- Everything below scopes to it. Copy the id from the first result if you want to
-- pin a specific cycle instead.
with live as (
  select id as cycle_id, name, status, created_at, updated_at
  from exam_cycles order by created_at desc limit 1
)
select 'LIVE CYCLE' as info, cycle_id, name, status, created_at, updated_at from live;

-- Staff/test accounts excluded at the cohort boundary (keep aligned with
-- lib/data/staff-exclusions.ts and reconcile.py).
--   lavinia.cavalet@alsamaproject.com , muamina.mlisho@alsamaproject.com

-- ── STAGE x SUBJECT — distinct participants per subject, all stages ──────────
-- One row per (assessment name); columns are the stages. Compare against target.
with live as (
  select id as cycle_id from exam_cycles order by created_at desc limit 1
),
staff as (
  select lower(trim(x)) as email from unnest(array[
    'lavinia.cavalet@alsamaproject.com',
    'muamina.mlisho@alsamaproject.com'
  ]) as x
),
-- INGEST: distinct participants that have at least one response in the subject.
ingest as (
  select a.name, count(distinct r.participant_id) as participants
  from live
  join assessments a on a.cycle_id = live.cycle_id
  join items i       on i.assessment_id = a.id
  join responses r   on r.item_id = i.id
  group by a.name
),
-- CLEANED COHORT: ingest minus staff/test (by stable email) minus clean_exclusions
-- row removals (re-resolved by target_key -> qm_participant_id, else target_id).
cleaned as (
  select a.name, count(distinct r.participant_id) as participants
  from live
  join assessments a on a.cycle_id = live.cycle_id
  join items i       on i.assessment_id = a.id
  join responses r   on r.item_id = i.id
  join participants p on p.id = r.participant_id
  where lower(trim(coalesce(p.email, p.qm_participant_id))) not in (select email from staff)
    and lower(trim(coalesce(p.qm_participant_id, '')))       not in (select email from staff)
    and not exists (
      select 1 from clean_exclusions ce
      where ce.cycle_id = live.cycle_id and ce.assessment_id = a.id and ce.kind = 'row'
        and coalesce(
              (select p2.id from participants p2
                 where p2.cycle_id = live.cycle_id and p2.qm_participant_id = ce.target_key),
              ce.target_id) = r.participant_id
    )
  group by a.name
),
-- MATERIALISED: participant_scores (the Score page), via the cycle's score_runs.
materialised as (
  select a.name, count(distinct ps.participant_id) as participants
  from live
  join score_runs sr        on sr.cycle_id = live.cycle_id
  join assessments a        on a.id = sr.assessment_id
  join participant_scores ps on ps.score_run_id = sr.id
  group by a.name
),
-- result_totals is QM's own per-result grain (all question types) — a cross-check.
result_totals_stage as (
  select a.name, count(distinct rt.participant_id) as participants
  from live
  join result_totals rt on rt.cycle_id = live.cycle_id
  join assessments a    on a.id = rt.assessment_id
  group by a.name
)
select
  coalesce(ing.name, cl.name, mat.name, rts.name)              as subject,
  ing.participants  as "1_ingest",
  rts.participants  as "1b_result_totals",
  cl.participants   as "2_cleaned_cohort",
  mat.participants  as "3_materialised_scores",
  case
    when coalesce(ing.name, cl.name, mat.name) ilike '%applicable math'  then 15
    when coalesce(ing.name, cl.name, mat.name) ilike '%english%'          then 11
    when coalesce(ing.name, cl.name, mat.name) ilike '%scientific%'       then 12
    when coalesce(ing.name, cl.name, mat.name) ~* 'عرب|arabic'            then 9
    when coalesce(ing.name, cl.name, mat.name) ilike '%life%'             then 10
  end as "target_cohort"
from ingest ing
full join cleaned cl        on cl.name  = ing.name
full join materialised mat  on mat.name = coalesce(ing.name, cl.name)
full join result_totals_stage rts on rts.name = coalesce(ing.name, cl.name, mat.name)
order by 1;

-- ── APPLICABLE MATH — the roster present at INGEST (merged vs dropped) ───────
-- If this returns FEWER than 15 rows, students were DROPPED (missing rows).
-- If any qm_participant_id / email is shared across two names or a name looks
-- folded, students were MERGED (shared identity). `responses` shows the per-row
-- footprint; a survivor holding another student's marks is the merge signature.
with live as (select id as cycle_id from exam_cycles order by created_at desc limit 1)
select
  p.id                     as participant_uuid,
  p.qm_participant_id      as stable_key_email,
  p.email,
  p.full_name,
  p.pseudonym_id,
  count(distinct r.item_id) as items_answered,
  p.created_at             as participant_ingested_at
from live
join assessments a on a.cycle_id = live.cycle_id and a.name ilike '%applicable math'
join items i       on i.assessment_id = a.id
join responses r   on r.item_id = i.id
join participants p on p.id = r.participant_id
group by p.id, p.qm_participant_id, p.email, p.full_name, p.pseudonym_id, p.created_at
order by p.qm_participant_id;

-- ── MERGE detector — any qm_participant_id / email carrying >1 participant row ─
-- (Should be EMPTY. Non-empty = distinct sitters folded onto one identity.)
with live as (select id as cycle_id from exam_cycles order by created_at desc limit 1)
select coalesce(qm_participant_id, email) as identity, count(*) as participant_rows,
       array_agg(id) as row_uuids
from live
join participants p on p.cycle_id = live.cycle_id
group by coalesce(qm_participant_id, email)
having count(*) > 1
order by 2 desc;

-- ── STALE vs FRESH — are the persisted rows older than the latest re-upload? ──
-- If participants.created_at predates the latest import_batches.created_at, the
-- re-upload did NOT replace them (verdict a: stale, un-replaced data).
with live as (select id as cycle_id from exam_cycles order by created_at desc limit 1)
select
  (select max(created_at) from import_batches ib where ib.cycle_id = live.cycle_id) as latest_upload_at,
  (select min(created_at) from participants  p  where p.cycle_id  = live.cycle_id) as oldest_participant_at,
  (select max(created_at) from participants  p  where p.cycle_id  = live.cycle_id) as newest_participant_at,
  (select count(*)        from participants  p  where p.cycle_id  = live.cycle_id) as participant_rows
from live;

-- ── STAFF/TEST presence — are the excluded accounts still persisted? ─────────
with live as (select id as cycle_id from exam_cycles order by created_at desc limit 1)
select p.qm_participant_id, p.email, p.full_name
from live
join participants p on p.cycle_id = live.cycle_id
where lower(trim(coalesce(p.email, p.qm_participant_id))) in
      ('lavinia.cavalet@alsamaproject.com','muamina.mlisho@alsamaproject.com')
   or lower(trim(coalesce(p.qm_participant_id,''))) in
      ('lavinia.cavalet@alsamaproject.com','muamina.mlisho@alsamaproject.com');
