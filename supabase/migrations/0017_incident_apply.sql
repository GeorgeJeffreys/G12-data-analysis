-- ============================================================================
-- 0017 — Incident Adjustments: apply / commit state (grade-bearing half, 02b)
--
-- 02a added the config registry + parsed incident rows (0016). 02b APPLIES those
-- rules — but the applied per-student adjustment is a BOUNDED LAYER ON TOP of the
-- engine's base scores, never folded into them. The reconcile discipline is the
-- reason: reconcile.py computes ground truth from the raw QM CSVs (no incidents),
-- so the base score path must keep reconciling 1:1. Therefore this migration does
-- NOT write incident marks into `participant_scores` or `alterations`, and does
-- NOT touch the parity-locked engine (183/183 unchanged). It records only the
-- explicit ADMIN decision to apply, per cycle; the capped per-student ledger is
-- DERIVED at read time from `incident_rows` + the config (the TypeScript apply
-- engine, lib/incidents/apply.ts) — a single source of truth, no stored merge.
--
-- New object:
--   * incident_applications — one row per cycle: whether the cycle's incident
--     adjustments are committed, and who committed them / when. Admin only.
--
-- Security follows 0016 exactly: RLS; no direct client writes; every mutation is
-- a SECURITY DEFINER function that role-checks (app.is_workspace_admin) + audits.
--
-- Run AFTER 0001–0016, once, in the Supabase SQL editor (EU). Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table. The commit flag per cycle. Base scores are never written here — this
--    is purely the "applied?" decision + provenance for the review surface.
-- ----------------------------------------------------------------------------
create table if not exists incident_applications (
  cycle_id    uuid primary key references exam_cycles(id) on delete cascade,
  applied     boolean not null default false,
  applied_by  uuid references auth.users(id),
  applied_at  timestamptz
);

-- ----------------------------------------------------------------------------
-- 2. RLS. Readable by any cycle member (all roles VIEW the review surface); no
--    direct client writes — the commit flows through section 4 (admin only).
-- ----------------------------------------------------------------------------
alter table incident_applications enable row level security;

do $$ begin
  create policy incident_applications_select on incident_applications for select using (app.is_member(cycle_id));
exception when duplicate_object then null; end $$;

revoke insert, update, delete on incident_applications from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 3. SECURITY DEFINER transition functions — ADMIN ONLY (only an admin may
--    commit/apply adjustments to scores). Each audits the decision.
-- ----------------------------------------------------------------------------

-- Commit the cycle's (capped) incident adjustments. Explicit admin action — never
-- automatic on import. Does not alter base scores; sets the applied flag only.
create or replace function public.apply_incident_adjustments(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_workspace_admin() then
    raise exception 'not authorized';
  end if;
  insert into incident_applications (cycle_id, applied, applied_by, applied_at)
  values (p_cycle, true, auth.uid(), now())
  on conflict (cycle_id) do update
    set applied = true, applied_by = auth.uid(), applied_at = now();
  perform app.audit(p_cycle, 'apply_incident_adjustments', 'incident_applications', p_cycle::text, null,
    jsonb_build_object('applied', true));
end $$;

-- Revert a prior commit, so base scores stand alone again. Admin only.
create or replace function public.unapply_incident_adjustments(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_workspace_admin() then
    raise exception 'not authorized';
  end if;
  update incident_applications
     set applied = false, applied_by = auth.uid(), applied_at = now()
   where cycle_id = p_cycle;
  perform app.audit(p_cycle, 'unapply_incident_adjustments', 'incident_applications', p_cycle::text, null,
    jsonb_build_object('applied', false));
end $$;

-- ----------------------------------------------------------------------------
-- 4. Grants (callable by signed-in users; each enforces its own admin check).
-- ----------------------------------------------------------------------------
grant execute on function
  public.apply_incident_adjustments(uuid),
  public.unapply_incident_adjustments(uuid)
to authenticated;
