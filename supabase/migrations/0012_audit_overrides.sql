-- ============================================================================
-- 0012 — Audit-trail extension + reversible/overridable pipeline actions
--
-- Why this exists (Cambridge check-in context)
--   An authorised person may need to REVERSE another user's grade-bearing
--   pipeline action — e.g. one reviewer excludes an item, an administrator later
--   re-includes it — and leave a clean trail of who did what, when, and why.
--
--   Migration 0001 already gives us an append-only `audit_log` + the private
--   `app.audit(...)` writer, and every pipeline action (exclusion, mark
--   adjustment, clean removal, boundary change, lock, …) already writes a row.
--   This migration adds the OVERRIDE half:
--
--   1. `audit_log` gains `reason`, `prior_actor_id`, `is_override` so an override
--      records WHO it overrode and WHY (previously folded loosely into `after`).
--   2. `app.audit_override(...)` — the override-flavoured writer (is_override=true).
--   3. Admin-only SECURITY DEFINER override RPCs that re-apply the SAME effective
--      state the original action used — so the engine recompute (incl. the D3
--      distinction safeguard) runs through the EXISTING path, never a shortcut:
--        • override_item_exclusion(item, exclude, reason)
--        • override_mark_adjustment(cycle, participant, assessment, new_mark, reason)
--   4. RLS: workspace admins read the FULL log (cross-cycle + global); members keep
--      their existing cycle-scoped read. The log stays append-only & never
--      client-written. items.status / participant_scores stay definer-only.
--
-- Authorisation: overrides are gated to `lead_admin` ONLY (a stronger gate than
-- the original actions, which also allow `reviewer`). The check is server-side
-- via app.has_role(...), so an unauthorised override is rejected by the database
-- regardless of the client.
-- ============================================================================

-- 1. Extend audit_log -------------------------------------------------------
alter table audit_log add column if not exists reason         text;
alter table audit_log add column if not exists prior_actor_id uuid references auth.users(id);
alter table audit_log add column if not exists is_override    boolean not null default false;

-- The new columns are still definer-only: clients may never write audit_log.
-- (The 0001 REVOKE on the table already covers added columns, but re-assert.)
revoke insert, update, delete on audit_log from authenticated, anon;

-- 2. Override-flavoured audit writer ----------------------------------------
-- Like app.audit but records the override provenance (prior actor + reason) and
-- flags the row so the UI can render it distinctly. Private (app schema), so
-- clients can't call it directly; only the SECURITY DEFINER RPCs below do.
create or replace function app.audit_override(
  p_cycle uuid, p_action text, p_entity text, p_entity_id text,
  p_before jsonb, p_after jsonb, p_reason text, p_prior_actor uuid)
returns void language sql security definer set search_path = public, app as $$
  insert into audit_log (cycle_id, actor_id, action, entity, entity_id,
                         before, after, reason, prior_actor_id, is_override)
  values (p_cycle, auth.uid(), p_action, p_entity, p_entity_id,
          p_before, p_after, p_reason, p_prior_actor, true);
$$;

-- Whether the signed-in user is a WORKSPACE admin (a global lead_admin: a
-- membership with cycle_id IS NULL and role lead_admin). Used by the audit-log
-- full-read policy. SECURITY DEFINER so it can read memberships under RLS.
create or replace function app.is_global_admin()
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from memberships m
    where m.cycle_id is null and m.user_id = auth.uid() and m.role = 'lead_admin'
  );
$$;

-- 3. Override RPCs ----------------------------------------------------------

-- Override another user's item exclusion/inclusion decision (re-include an item
-- a reviewer excluded, or vice-versa). Admin-only. Reuses the EXACT same state
-- mutation as decide_item_exclusion (item_reviews upsert + items.status flip),
-- so scoring recomputes through the identical engine path (incl. D3). Records an
-- override audit row naming the prior decider and the required reason.
create or replace function public.override_item_exclusion(
  p_item uuid, p_exclude boolean, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_cycle uuid; v_before jsonb; v_prior uuid;
begin
  v_cycle := app.cycle_of_item(p_item);
  -- Stronger gate than the original action: overrides require lead_admin.
  if not app.has_role(v_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'an override requires a reason';
  end if;

  -- Whose decision are we overriding? The current reviewer of record.
  select to_jsonb(r), r.reviewer_id into v_before, v_prior
    from item_reviews r where r.item_id = p_item;

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

-- Override another user's manual mark adjustment: set the cell's mark to
-- p_new_mark, or REVERT it (p_new_mark IS NULL removes the existing manual
-- adjustment). Admin-only. Rides the EXISTING `alterations` engine input exactly
-- as adjust_participant_mark/remove_mark_adjustment do, so the grade recomputes
-- through the full path (incl. D3). Records an override audit row naming the
-- prior adjuster and the required reason.
create or replace function public.override_mark_adjustment(
  p_cycle uuid, p_participant uuid, p_assessment uuid,
  p_new_mark numeric, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v_actor    uuid := auth.uid();
  v_prior    uuid;
  v_existing numeric;
  v_base     numeric;
  v_delta    numeric;
begin
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'an override requires a reason';
  end if;
  if v_actor is null then
    raise exception 'override_mark_adjustment requires a signed-in actor (auth.uid() is null)';
  end if;

  -- Prior adjuster (most recent manual alteration on this cell), and the current
  -- manual delta so we can recover the un-adjusted base.
  select decided_by into v_prior
    from alterations
   where cycle_id = p_cycle and incident_id is null
     and participant_id = p_participant and assessment_id = p_assessment
   order by decided_at desc
   limit 1;

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

-- 4. RLS — admins read the FULL log; members keep their cycle-scoped read ----
-- The existing `audit_select` (members read their cycle; null-cycle rows readable
-- by all) is preserved. This ADDS a full-read path for workspace admins so the
-- audit/override surface can show cross-cycle and global activity during a
-- check-in. No read is widened for regular users.
drop policy if exists audit_admin_select on audit_log;
create policy audit_admin_select on audit_log for select
  using (app.is_global_admin());

-- 5. Grants -----------------------------------------------------------------
grant execute on function
  public.override_item_exclusion(uuid, boolean, text),
  public.override_mark_adjustment(uuid, uuid, uuid, numeric, text)
to authenticated;
