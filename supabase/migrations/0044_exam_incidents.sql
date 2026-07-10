-- ============================================================================
-- 0044 — Technical Incident Upload: staged incident export (Incident Adjustments)
--
-- The Incident Adjustments step already has a config-driven apply engine
-- (0016/0017, lib/incidents/apply.ts). What was missing is the INGEST of the real
-- technical-incident export (the 20-column `exam-incidents-YYYY-MM-DD.csv`). This
-- migration adds the staging table for that ingest: each incident is parsed,
-- matched to a real sitting by lowercased EMAIL within the active cycle, bucketed
-- into a reconciliation status, and upserted by its natural key `reference`.
--
-- STAGING ONLY — NO MARKS ARE ADJUSTED HERE. The export supplies no
-- machine-readable remedy (`Action Taken` is free text; `Code` classifies the
-- issue, not the remedy; `Questions Affected (list)` is empty), so per the §3
-- decision gate the adjustment columns (`adjustment_type` / `adjustment_magnitude`
-- / `adjustment_notes`) are NULLABLE and left UNPOPULATED. The parity-locked
-- engine (`lib/engine/*`) and the `alterations` seam are untouched — base scores
-- keep reconciling 1:1 with the raw oracle. See docs/incident-upload-findings.md.
--
-- New object:
--   * exam_incidents — one row per imported incident, cycle-scoped, keyed on the
--     unique natural key `reference`. Stores the informational STU-… id
--     (`student_id_external`, NEVER a join key), the lowercased join email, the
--     authoritative `duration_min`, and the resolved sitting `matched_qm_result_id`
--     (TEXT — the repo's `qm_result_id` type, not bigint) + `match_status`.
--
-- Security follows 0016/0018 exactly: RLS (readable by cycle members); no direct
-- client writes; every mutation is a SECURITY DEFINER function that role-checks
-- (app.has_role — lead/admin or reviewer, the incident-import role) + audits.
--
-- Run AFTER 0001–0043, once, in the Supabase SQL editor (EU). Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table. Cycle-scoped; `reference` is the global upsert key so a re-uploaded
--    corrected file UPDATES the row (never duplicates). The three adjustment_*
--    columns stay NULL until an adjudication step/enriched export supplies a
--    remedy — nothing here writes a mark.
-- ----------------------------------------------------------------------------
create table if not exists exam_incidents (
  id                        uuid primary key default gen_random_uuid(),
  cycle_id                  uuid not null references exam_cycles(id) on delete cascade,
  reference                 text not null,
  import_batch_id           uuid not null,
  file_name                 text,
  exam_cycle                text not null,
  subject_raw               text not null,
  subject_key               text,
  exam_date                 date,
  partner_center            text,
  category                  text,
  issue                     text,
  code                      text,
  student_name              text,
  student_email             text not null,            -- stored lowercased (the only join key)
  student_id_external       text,                     -- the STU-… value; informational, never a join key
  time_started              text,                     -- times are informational
  time_resolved             text,
  duration_min              integer,                  -- authoritative; never recomputed from the times
  action_taken              text,                     -- free text, informational only
  questions_affected_count  integer,
  questions_affected_list   jsonb,                    -- parsed ids if present; else null
  status                    text,
  invigilator               text,
  source_created_at         timestamptz,              -- from the file's `Created At`
  imported_at               timestamptz not null default now(),
  matched_qm_result_id      text,                     -- resolved sitting (qm_result_id is TEXT); null if unmatched
  match_status              text not null,
  flags                     text[] not null default '{}',
  adjustment_type           text,                     -- populated only once §3 gate is passed
  adjustment_magnitude      numeric,
  adjustment_notes          text,
  constraint exam_incidents_reference_key unique (reference),
  constraint exam_incidents_match_status_valid check (
    match_status in ('matched','out_of_scope_cycle','staff_excluded','unmatched_email','unmatched_subject','duplicate')
  ),
  constraint exam_incidents_duration_nonneg check (duration_min is null or duration_min >= 0)
);

create index if not exists exam_incidents_cycle_subject_idx on exam_incidents (exam_cycle, subject_key);
create index if not exists exam_incidents_email_idx on exam_incidents (student_email);
create index if not exists exam_incidents_cycle_idx on exam_incidents (cycle_id);
create index if not exists exam_incidents_batch_idx on exam_incidents (import_batch_id);

-- ----------------------------------------------------------------------------
-- 2. RLS. Readable by any cycle member (all roles VIEW the reconciliation); no
--    direct client writes — mutation flows through section 4.
-- ----------------------------------------------------------------------------
alter table exam_incidents enable row level security;

do $$ begin
  create policy exam_incidents_select on exam_incidents for select using (app.is_member(cycle_id));
exception when duplicate_object then null; end $$;

revoke insert, update, delete on exam_incidents from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 3. (reserved — no config objects; the ingest is stateless beyond section 4.)
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 4. SECURITY DEFINER functions — cycle role (lead/admin or reviewer), like the
--    incident-log import. Each audits. Upsert is by the natural key `reference`.
-- ----------------------------------------------------------------------------

-- Upsert one batch of staged incidents. Re-uploading a corrected file updates the
-- existing rows by `reference` (never duplicates); each upload groups under one
-- import_batch_id. NEVER writes an adjustment (adjustment_* stay whatever the
-- caller sends, which the app leaves null per the §3 gate).
-- p_rows: [{ reference, exam_cycle, subject_raw, subject_key, exam_date,
--   partner_center, category, issue, code, student_name, student_email,
--   student_id_external, time_started, time_resolved, duration_min, action_taken,
--   questions_affected_count, questions_affected_list, status, invigilator,
--   source_created_at, matched_qm_result_id, match_status, flags:[text] }]
create or replace function public.upsert_exam_incidents(
  p_cycle uuid, p_batch uuid, p_file_name text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, app as $$
declare r jsonb; n integer := 0;
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if coalesce(btrim(r->>'reference'), '') = '' then continue; end if;  -- never stage a keyless row
    insert into exam_incidents (
      cycle_id, reference, import_batch_id, file_name, exam_cycle, subject_raw, subject_key,
      exam_date, partner_center, category, issue, code, student_name, student_email,
      student_id_external, time_started, time_resolved, duration_min, action_taken,
      questions_affected_count, questions_affected_list, status, invigilator, source_created_at,
      matched_qm_result_id, match_status, flags, imported_at)
    values (
      p_cycle, btrim(r->>'reference'), p_batch, p_file_name, r->>'exam_cycle', r->>'subject_raw', nullif(r->>'subject_key',''),
      nullif(r->>'exam_date','')::date, r->>'partner_center', r->>'category', r->>'issue', r->>'code',
      r->>'student_name', lower(btrim(r->>'student_email')),
      r->>'student_id_external', r->>'time_started', r->>'time_resolved',
      nullif(r->>'duration_min','')::integer, r->>'action_taken',
      nullif(r->>'questions_affected_count','')::integer,
      case when r->'questions_affected_list' is null or r->>'questions_affected_list' = 'null' then null else r->'questions_affected_list' end,
      r->>'status', r->>'invigilator', nullif(r->>'source_created_at','')::timestamptz,
      nullif(r->>'matched_qm_result_id',''), coalesce(r->>'match_status','unmatched_email'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(r->'flags') x), '{}'),
      now())
    on conflict (reference) do update set
      cycle_id = excluded.cycle_id, import_batch_id = excluded.import_batch_id, file_name = excluded.file_name,
      exam_cycle = excluded.exam_cycle, subject_raw = excluded.subject_raw, subject_key = excluded.subject_key,
      exam_date = excluded.exam_date, partner_center = excluded.partner_center, category = excluded.category,
      issue = excluded.issue, code = excluded.code, student_name = excluded.student_name,
      student_email = excluded.student_email, student_id_external = excluded.student_id_external,
      time_started = excluded.time_started, time_resolved = excluded.time_resolved,
      duration_min = excluded.duration_min, action_taken = excluded.action_taken,
      questions_affected_count = excluded.questions_affected_count,
      questions_affected_list = excluded.questions_affected_list, status = excluded.status,
      invigilator = excluded.invigilator, source_created_at = excluded.source_created_at,
      matched_qm_result_id = excluded.matched_qm_result_id, match_status = excluded.match_status,
      flags = excluded.flags, imported_at = now();
      -- adjustment_type / adjustment_magnitude / adjustment_notes are intentionally
      -- NOT touched here — staging never adjusts (§3 gate).
    n := n + 1;
  end loop;
  perform app.audit(p_cycle, 'upsert_exam_incidents', 'exam_incidents', p_cycle::text, null,
    jsonb_build_object('batch', p_batch, 'file_name', p_file_name, 'count', n));
  return n;
end $$;

-- Clear a cycle's staged incidents (the "Remove" control). Same cycle role.
create or replace function public.clear_exam_incidents(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from exam_incidents where cycle_id = p_cycle;
  perform app.audit(p_cycle, 'clear', 'exam_incidents', p_cycle::text, null, null);
end $$;

-- ----------------------------------------------------------------------------
-- 5. Grants (callable by signed-in users; each enforces its own role check).
-- ----------------------------------------------------------------------------
grant execute on function
  public.upsert_exam_incidents(uuid, uuid, text, jsonb),
  public.clear_exam_incidents(uuid)
to authenticated;
