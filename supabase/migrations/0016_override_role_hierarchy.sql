-- ============================================================================
-- 0016 — Gate audit overrides on the STRICTLY-HIGHER role rule (prompt 06)
--
-- Why this exists
--   Migration 0012 added the override RPCs but gated them on a FLAT `lead_admin`
--   check (`app.has_role(cycle, ['lead_admin'])`) — it never looked at WHO took
--   the original decision. The canonical hierarchy (0015) gives us a real
--   ordering (team member < data analyst < admin) and the strictly-higher
--   primitive `app.can_override(actor, subject)`. The G12 feedback is that a
--   HIGHER role must be able to override a LOWER role's decision — specifically:
--       • admin        overrides data analyst AND team member,
--       • data analyst overrides team member,
--       • nobody       overrides an equal or higher role.
--   This migration re-points the two override RPCs at `app.can_override`, using
--   the role that actually took the original action as the SUBJECT of the check.
--
-- What it does
--   1. `app.role_of(cycle, user)` — the user's EFFECTIVE (highest-rank) stored
--      role across their global (cycle_id IS NULL) and cycle-scoped memberships.
--      SECURITY DEFINER, mirrors how app.has_role / has_min_role read memberships.
--   2. Redefines `override_item_exclusion` and `override_mark_adjustment` to gate
--      on `app.can_override(role_of(actor), role_of(prior_decider))` instead of the
--      flat lead_admin check. Everything else is unchanged — SAME state mutation
--      (no engine shortcut), SAME required-reason rule, SAME `app.audit_override`
--      provenance (prior actor + reason). Behaviour-compatible for lead_admin over
--      a team member / analyst; ADDITIVELY lets an analyst override a team member
--      and STOPS an admin overriding another admin (equal role).
--
-- What this is NOT
--   No table DDL, no grade-bearing data touched, no scoring re-run. The RPC
--   signatures and grants are unchanged (the override subject is resolved from the
--   existing decision rows, not passed by the client), so the audit-log append-only
--   / definer-only guarantees and the admin full-read RLS from 0012 stay intact.
--
-- Idempotency / run order
--   Run AFTER 0001–0015, in the Supabase SQL editor (EU). Every statement is
--   `create or replace` — safe to re-run. Depends on app.can_override / app.role_rank
--   (0015) and the override RPCs / app.audit_override (0012).
--   Reversibility: see 0016_override_role_hierarchy.rollback.sql (restores the 0012
--   flat lead_admin gate and drops app.role_of).
-- ============================================================================

-- 1. Effective role of a user in a cycle ------------------------------------
-- Highest-ranked role across the user's applicable memberships (their global
-- workspace membership + any membership on this cycle). NULL when the user has no
-- membership at all. `role_rank` (0015) expresses the canonical ordering, so this
-- never references the freshly-added 'analyst' enum value as a literal.
create or replace function app.role_of(p_cycle uuid, p_user uuid)
returns member_role language sql stable security definer set search_path = public, app as $$
  select m.role
  from memberships m
  where m.user_id = p_user
    and (m.cycle_id is null or m.cycle_id = p_cycle)
  order by app.role_rank(m.role) desc
  limit 1;
$$;

-- 2. Override RPCs — re-gated on the strictly-higher rule --------------------

-- Override another user's item exclusion/inclusion. The SUBJECT of the override
-- is the reviewer of record; the actor must STRICTLY OUTRANK them. An
-- un-attributed decision (no prior review) defaults to the lowest tier so a
-- higher role can still act. Reuses the EXACT same state mutation as
-- decide_item_exclusion (item_reviews upsert + items.status flip), so scoring
-- recomputes through the identical engine path (incl. D3). Records an override
-- audit row naming the prior decider and the required reason.
create or replace function public.override_item_exclusion(
  p_item uuid, p_exclude boolean, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v_cycle        uuid;
  v_before       jsonb;
  v_prior        uuid;
  v_actor_role   member_role;
  v_subject_role member_role;
begin
  v_cycle := app.cycle_of_item(p_item);

  -- Whose decision are we overriding? The current reviewer of record.
  select to_jsonb(r), r.reviewer_id into v_before, v_prior
    from item_reviews r where r.item_id = p_item;

  -- Strictly-higher gate: actor must OUTRANK the role that took the decision.
  v_actor_role   := app.role_of(v_cycle, auth.uid());
  v_subject_role := coalesce(app.role_of(v_cycle, v_prior), 'reviewer'::member_role);
  if v_actor_role is null or not app.can_override(v_actor_role, v_subject_role) then
    raise exception 'not authorized';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'an override requires a reason';
  end if;

  -- SAME mutation the original action performs (no engine shortcut).
  insert into item_reviews (item_id, reviewer_id, exclude, reason, notes, decided_at)
  values (p_item, auth.uid(), p_exclude, p_reason, null, now())
  on conflict (item_id) do update
    set exclude = excluded.exclude, reason = excluded.reason,
        notes = excluded.notes, reviewer_id = auth.uid(), decided_at = now();

  update items set status = case when p_exclude then 'excluded' else 'active' end::item_status
    where id = p_item;

  perform app.audit_override(
    v_cycle, 'override_item_exclusion', 'item', p_item::text, v_before,
    jsonb_build_object('exclude', p_exclude), btrim(p_reason), v_prior);
end $$;

-- Override another user's manual mark adjustment (set the cell's mark, or REVERT
-- it when p_new_mark IS NULL). The SUBJECT is the most recent adjuster on the
-- cell; the actor must STRICTLY OUTRANK them (un-attributed → lowest tier). Rides
-- the EXISTING `alterations` engine input exactly as adjust/remove do, so the
-- grade recomputes through the full path (incl. D3). Records an override audit row
-- naming the prior adjuster and the required reason.
create or replace function public.override_mark_adjustment(
  p_cycle uuid, p_participant uuid, p_assessment uuid,
  p_new_mark numeric, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v_actor        uuid := auth.uid();
  v_prior        uuid;
  v_actor_role   member_role;
  v_subject_role member_role;
  v_existing     numeric;
  v_base         numeric;
  v_delta        numeric;
begin
  -- Prior adjuster (most recent manual alteration on this cell) — the override
  -- subject — resolved BEFORE the gate so we can rank the actor against them.
  select decided_by into v_prior
    from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment
   order by decided_at desc
   limit 1;

  -- Strictly-higher gate (admin > analyst > team member).
  v_actor_role   := app.role_of(p_cycle, v_actor);
  v_subject_role := coalesce(app.role_of(p_cycle, v_prior), 'reviewer'::member_role);
  if v_actor_role is null or not app.can_override(v_actor_role, v_subject_role) then
    raise exception 'not authorized';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'an override requires a reason';
  end if;
  if v_actor is null then
    raise exception 'override_mark_adjustment requires a signed-in actor (auth.uid() is null)';
  end if;

  -- Current manual delta on this cell, so we can recover the un-adjusted base.
  select coalesce(sum(marks), 0) into v_existing
    from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment;

  select coalesce(ps.raw, 0) - v_existing into v_base
    from participant_scores ps
    join score_runs sr on sr.id = ps.score_run_id
   where sr.cycle_id = p_cycle and sr.assessment_id = p_assessment
     and ps.participant_id = p_participant
   order by sr.computed_at desc
   limit 1;
  v_base := coalesce(v_base, 0);

  -- Supersede any prior manual adjustment on this cell (deltas never compound).
  delete from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment;

  if p_new_mark is null then
    -- Revert: leave no manual alteration; the grade returns to its base.
    perform app.audit_override(
      p_cycle, 'override_mark_adjustment', 'participant_score',
      p_participant::text || ':' || p_assessment::text,
      jsonb_build_object('delta', v_existing), jsonb_build_object('reverted', true),
      btrim(p_reason), v_prior);
  else
    v_delta := p_new_mark - v_base;
    if v_delta <> 0 then
      insert into alterations (cycle_id, incident_id, apply_to, participant_id, assessment_id, marks, reason, decided_by)
      values (p_cycle, null, 'student', p_participant, p_assessment, v_delta, btrim(p_reason), v_actor);
    end if;
    perform app.audit_override(
      p_cycle, 'override_mark_adjustment', 'participant_score',
      p_participant::text || ':' || p_assessment::text,
      jsonb_build_object('mark', v_base),
      jsonb_build_object('mark', p_new_mark, 'delta', v_delta),
      btrim(p_reason), v_prior);
  end if;
end $$;

-- 3. Grants (unchanged signatures — re-assert for safety) --------------------
grant execute on function
  public.override_item_exclusion(uuid, boolean, text),
  public.override_mark_adjustment(uuid, uuid, uuid, numeric, text)
to authenticated;
