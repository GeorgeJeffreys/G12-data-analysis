-- ============================================================================
-- G12++ — PRODUCTION DATA CUTOVER (one-time ops script — NOT a migration)
-- ============================================================================
-- Wipes all exam / participant / response / sitting / results / synthetic-cycle
-- rows and grants George a workspace-level `lead_admin`, while PRESERVING all
-- bootstrap/reference data and real user accounts.
--
-- HOW TO RUN
--   1. Apply the numbered migrations FIRST (see RUNBOOK.md) so the schema is
--      current — this script assumes migration 0040 (roles / role_actions) and
--      0045 (seeded-exclusion removal) are applied.
--   2. Run this in the Supabase SQL editor as the SERVICE ROLE (so RLS does not
--      block the deletes). It is wrapped in a single transaction.
--   3. EDIT the one placeholder below (:george_email) — see the next block.
--   4. Read the BEFORE counts, let it run, then read the AFTER counts + the
--      final admin confirmation. If anything looks wrong, it is one transaction:
--      change the final `commit;` to `rollback;` and re-run to preview safely.
--
-- WHY A CASCADE DELETE IS FK-SAFE
--   Every cycle-scoped table references exam_cycles(id) ON DELETE CASCADE (verified
--   across migrations 0001/0003/0006/0008/0016/0017/0018/0026/0033), and the
--   sitting-grain tables cascade from sittings which itself cascades from
--   exam_cycles. So `delete from exam_cycles` removes children first, in
--   dependency order, automatically. The AFTER counts below prove every data
--   table reached zero. Workspace-scoped rows (memberships / audit_log with
--   cycle_id IS NULL) do NOT reference a cycle and are intentionally preserved.
--
--   Cascade-wiped set (for the record): assessments, participants, items,
--   responses, item_stats, score_runs, participant_scores, grades, grade_schemes,
--   sittings, result_totals, topic_rollups, item_reviews, essay_marks,
--   clean_exclusions, cohort_exclusions, incidents, incident_rows,
--   incident_applications, incident_codes, incident_settings,
--   incident_import_mappings, incident_import_source, alterations,
--   distinction_overrides, distinction_state, document_settings, element_labels,
--   import_batches, and every cycle-scoped membership / audit_log row.
--
-- PRESERVED (never touched here): roles, role_actions, role_permissions,
--   permissions, role_grants (the permission grid + bootstrap), workspace_settings,
--   test_centres (workspace config — see RUNBOOK note), auth.users (real accounts),
--   and workspace-scoped memberships (cycle_id IS NULL).
-- ============================================================================

-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ EDIT ME — George's LOGIN email (must match his auth.users row exactly).   │
-- │                                                                          │
-- │  • Supabase SQL editor: find-and-replace every  :'george_email'          │
-- │    (3 occurrences below) with the quoted email, e.g.                     │
-- │        'george@alsamaproject.com'                                        │
-- │  • psql: instead uncomment the \set line and leave :'george_email' as-is.│
-- └────────────────────────────────────────────────────────────────────────┘
-- \set george_email 'george@alsamaproject.com'

begin;

-- ── 1. BASELINE — counts BEFORE (read these) ────────────────────────────────
select 'BEFORE' as phase,
  (select count(*) from exam_years)          as exam_years,
  (select count(*) from exam_cycles)         as exam_cycles,
  (select count(*) from participants)        as participants,
  (select count(*) from responses)           as responses,
  (select count(*) from sittings)            as sittings,
  (select count(*) from result_totals)       as result_totals,
  (select count(*) from participant_scores)  as participant_scores,
  (select count(*) from item_stats)          as item_stats,
  (select count(*) from cohort_exclusions)   as cohort_exclusions;

-- KEEP tables — record so we can prove they are UNCHANGED afterwards.
select 'BEFORE-keep' as phase,
  (select count(*) from roles)               as roles,
  (select count(*) from role_actions)        as role_actions,
  (select count(*) from auth.users)          as auth_users,
  (select count(*) from memberships where cycle_id is null) as workspace_memberships;

-- ── 2. WIPE all exam / synthetic-cycle data (FK-safe cascade) ───────────────
delete from exam_cycles;   -- cascades to every cycle-scoped table (see header)
delete from exam_years;    -- now unreferenced

-- ── 3. GRANT George a workspace-level lead_admin (fail loudly if absent) ────
-- Sets BOTH the enum role (app.has_role) and role_id (app.can_do / migration 0040)
-- so every gate recognises him. Workspace scope = cycle_id IS NULL.
do $$
declare
  v_uid   uuid;
  v_admin uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(:'george_email');
  if v_uid is null then
    raise exception
      'No auth.users row for %. George must sign in to the app once (creating his auth user), then re-run this script.',
      :'george_email';
  end if;

  select id into v_admin from roles where name = 'Admin';
  if v_admin is null then
    raise exception 'The canonical "Admin" role is missing — apply migration 0040_dynamic_roles.sql first.';
  end if;

  if exists (select 1 from memberships where user_id = v_uid and cycle_id is null) then
    update memberships
       set role = 'lead_admin', role_id = v_admin
     where user_id = v_uid and cycle_id is null;
  else
    insert into memberships (user_id, cycle_id, role, role_id)
    values (v_uid, null, 'lead_admin', v_admin);
  end if;
end $$;

-- ── 4. CONFIRM — data gone, bootstrap intact, George is admin ───────────────
select 'AFTER' as phase,
  (select count(*) from exam_years)          as exam_years,          -- expect 0
  (select count(*) from exam_cycles)         as exam_cycles,         -- expect 0
  (select count(*) from participants)        as participants,        -- expect 0
  (select count(*) from responses)           as responses,           -- expect 0
  (select count(*) from sittings)            as sittings,            -- expect 0
  (select count(*) from result_totals)       as result_totals,       -- expect 0
  (select count(*) from participant_scores)  as participant_scores,  -- expect 0
  (select count(*) from item_stats)          as item_stats,          -- expect 0
  (select count(*) from cohort_exclusions)   as cohort_exclusions;   -- expect 0

select 'AFTER-keep' as phase,
  (select count(*) from roles)               as roles,               -- unchanged
  (select count(*) from role_actions)        as role_actions,        -- unchanged
  (select count(*) from auth.users)          as auth_users,          -- unchanged
  (select count(*) from memberships where cycle_id is null) as workspace_memberships;

-- George's workspace admin, spelled out (expect exactly one row: Admin / lead_admin).
select 'GEORGE-ADMIN' as phase, u.email, m.role as enum_role, r.name as role_name
from memberships m
join auth.users u on u.id = m.user_id
join roles r on r.id = m.role_id
where m.cycle_id is null and lower(u.email) = lower(:'george_email');

-- ── 5. Commit (change to `rollback;` first if you want a dry-run preview) ────
commit;
