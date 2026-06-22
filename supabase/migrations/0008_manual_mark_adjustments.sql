-- ============================================================================
-- 0008 — Manual mark adjustments (Grades-stage overrides; audited & reversible)
--
-- Lets a reviewer manually nudge a flagged (marginal) student's subject MARK from
-- the Grades view. The adjustment is NOT a direct grade flip: it is recorded as a
-- normal +/- raw-mark row in the EXISTING `alterations` table — the same engine
-- INPUT the scoring path already consumes — so the grade recomputes through the
-- full existing logic (including the Distinction D3 safeguard) and the engine /
-- item-stats are never touched (parity stays 183/183).
--
-- Manual adjustments are distinguished from incident-triage alterations by having
-- a NULL incident_id (they originate from the Grades view, not the incident log).
-- At most one manual adjustment per (cycle, participant, assessment) cell.
--
-- Actor: these RPCs are invoked by the signed-in user's session client, so
-- auth.uid() resolves the actor server-side and stamps both the alterations row
-- (decided_by) and the audit entry. (The secret-key service client has no session
-- and must never write these — it would record a NULL actor.)
--
-- No new tables: this migration only adds two SECURITY DEFINER RPCs + grants.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Adjust a student's subject mark to p_new_mark, with a REQUIRED reason.
-- Supersedes any existing manual adjustment on the same cell (so deltas never
-- compound), then stores the signed delta (new − base) as an alterations row.
-- The grade recomputes downstream from the engine's alterations input.
-- ----------------------------------------------------------------------------
create or replace function public.adjust_participant_mark(
  p_cycle uuid, p_participant uuid, p_assessment uuid,
  p_new_mark numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_actor    uuid := auth.uid();
  v_base     numeric;
  v_existing numeric;
  v_delta    numeric;
  v_id       uuid;
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if v_actor is null then
    raise exception 'adjust_participant_mark requires a signed-in actor (auth.uid() is null)';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required for a manual mark adjustment';
  end if;

  -- Sum of any existing MANUAL delta for this cell (incident_id is null), so the
  -- un-adjusted base = stored subject total minus that delta.
  select coalesce(sum(marks), 0) into v_existing
    from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment;

  -- Stored subject total (engine raw = MCQ + essay + alterations) from the latest
  -- score run; the un-adjusted base subtracts any existing manual delta.
  select coalesce(ps.raw, 0) - v_existing into v_base
    from participant_scores ps
    join score_runs sr on sr.id = ps.score_run_id
   where sr.cycle_id = p_cycle and sr.assessment_id = p_assessment
     and ps.participant_id = p_participant
   order by sr.computed_at desc
   limit 1;
  v_base := coalesce(v_base, 0);

  v_delta := p_new_mark - v_base;

  -- Supersede any prior manual adjustment on this cell.
  delete from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment;

  if v_delta <> 0 then
    insert into alterations (cycle_id, incident_id, apply_to, participant_id, assessment_id, marks, reason, decided_by)
    values (p_cycle, null, 'student', p_participant, p_assessment, v_delta, btrim(p_reason), v_actor)
    returning id into v_id;
  end if;

  perform app.audit(
    p_cycle, 'adjust_mark', 'participant_score',
    p_participant::text || ':' || p_assessment::text,
    jsonb_build_object('mark', v_base),
    jsonb_build_object('mark', p_new_mark, 'delta', v_delta, 'reason', btrim(p_reason)));

  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- Remove (undo) the manual adjustment on a cell — reverts the grade and audits
-- the reversal. Keyed by (cycle, participant, assessment) since a cell carries at
-- most one manual adjustment.
-- ----------------------------------------------------------------------------
create or replace function public.remove_mark_adjustment(
  p_cycle uuid, p_participant uuid, p_assessment uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v_removed numeric;
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;

  select coalesce(sum(marks), 0) into v_removed
    from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment;

  delete from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment;

  perform app.audit(
    p_cycle, 'remove_mark_adjustment', 'participant_score',
    p_participant::text || ':' || p_assessment::text,
    jsonb_build_object('delta', v_removed), null);
end $$;

-- ----------------------------------------------------------------------------
-- Grants (callable by signed-in users; each enforces its own role check).
-- ----------------------------------------------------------------------------
grant execute on function
  public.adjust_participant_mark(uuid, uuid, uuid, numeric, text),
  public.remove_mark_adjustment(uuid, uuid, uuid)
to authenticated;
