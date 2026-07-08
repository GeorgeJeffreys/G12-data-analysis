-- 0037 — switch server-side authorization from role gates to the permission matrix.
--
-- P2 of 3. Behaviour-CHANGING (grade-bearing): each RPC below is recreated
-- forward-only (create or replace), its `app.has_role(...)` / `app.is_workspace_admin()`
-- guard swapped for `app.has_permission(cycle, '<permission>')` — the P1 matrix
-- (migration 0036) is now the single source of truth on the server, mirroring the
-- client `can()` gates that change in the same PR. Every function body is otherwise
-- preserved verbatim (same cascade / audit / logic).
--
-- Intended change (not a regression): access now follows the matrix, so `analyst`
-- gains the server permissions it holds there (e.g. clean, boundaries, safeguard).
--
-- NOT changed here, and why (flagged):
--   * app.has_role / app.is_member / app.is_workspace_admin / app.can_override — the
--     base primitives + `set_role_permission`'s own workspace_admin+lockout gate stay.
--   * RLS SELECT/write policies on tables stay on app.has_role (row visibility is
--     unchanged; P2 scope is the definer RPCs).
--   * ingest_persist / reset_cycle_for_reingest — service_role-only, invoked with an
--     explicit p_actor and no auth.uid() session, so an auth.uid()-based
--     has_permission check would reject the very service-role calls they exist for.
--     The user-facing intake gate is enforced client-side + via clear_sitting_data.
--   * create_cycle / create_cycle_with_assessments — self-service cycle creation
--     (creator becomes lead_admin); intentionally open, as before.
--   * Grade-bearing RPCs the mapping table did not list (decide_item_exclusion,
--     decide_incident, save_grade_scheme, confirm/override/undo_distinction_*,
--     apply/unapply_incident_adjustments) keep their has_role gates for now; their
--     clients are permission-gated in this PR, so the server stays at least as strict.
--
-- Forward-only; run in the Supabase SQL editor after merge.


-- ── clean-stage removals & cohort exclusions → clean ──────────

create or replace function public.set_clean_removal(
  p_cycle uuid, p_assessment uuid, p_kind text,
  p_targets uuid[], p_keys text[], p_remove boolean)
returns void language plpgsql security definer set search_path = public, app as $$
declare i int; v_target uuid; v_key text;
begin
  if not app.has_permission(p_cycle, 'clean') then
    raise exception 'not authorized';
  end if;
  if p_kind not in ('row', 'col') then
    raise exception 'invalid kind %', p_kind;
  end if;
  if p_remove then
    for i in 1 .. coalesce(array_length(p_targets, 1), 0) loop
      v_target := p_targets[i];
      v_key := case when p_keys is null then null else p_keys[i] end;
      insert into clean_exclusions (cycle_id, assessment_id, kind, target_id, target_key, decided_by)
      values (p_cycle, p_assessment, p_kind, v_target, v_key, auth.uid())
      on conflict (cycle_id, assessment_id, kind, target_id)
        do update set target_key = excluded.target_key;
    end loop;
  else
    delete from clean_exclusions
      where cycle_id = p_cycle and assessment_id = p_assessment
        and kind = p_kind and target_id = any(coalesce(p_targets, array[]::uuid[]));
  end if;
  perform app.audit(p_cycle, 'clean_removal', 'assessment', p_assessment::text, null,
                    jsonb_build_object('kind', p_kind, 'remove', p_remove,
                                       'count', coalesce(array_length(p_targets, 1), 0)));
end $$;


create or replace function public.clear_clean_removals(p_cycle uuid, p_assessment uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(p_cycle, 'clean') then
    raise exception 'not authorized';
  end if;
  delete from clean_exclusions where cycle_id = p_cycle and assessment_id = p_assessment;
  perform app.audit(p_cycle, 'clean_removal', 'assessment', p_assessment::text, null,
                    jsonb_build_object('revertAll', true));
end $$;


create or replace function public.set_cohort_exclusion(
  p_cycle uuid, p_key text, p_reason text, p_remove boolean)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(p_cycle, 'clean') then
    raise exception 'not authorized';
  end if;
  if coalesce(nullif(trim(p_key), ''), '') = '' then
    raise exception 'participant key required';
  end if;
  if p_remove then
    insert into cohort_exclusions (cycle_id, participant_key, reason, decided_by)
    values (p_cycle, p_key, coalesce(nullif(trim(p_reason), ''), 'Excluded from all subjects'), auth.uid())
    on conflict (cycle_id, participant_key)
      do update set reason = excluded.reason, decided_by = auth.uid(), decided_at = now();
  else
    delete from cohort_exclusions where cycle_id = p_cycle and participant_key = p_key;
  end if;
  perform app.audit(p_cycle, 'cohort_exclusion', 'participant', p_key, null,
                    jsonb_build_object('remove', p_remove, 'reason', p_reason));
end $$;


-- ── mark adjustments & incident-row import → adjust ────────────

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
  if not app.has_permission(p_cycle, 'adjust') then
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


create or replace function public.remove_mark_adjustment(
  p_cycle uuid, p_participant uuid, p_assessment uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v_removed numeric;
begin
  if not app.has_permission(p_cycle, 'adjust') then
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


create or replace function public.import_incident_rows(p_cycle uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare r jsonb; v_pid uuid;
begin
  if not app.has_permission(p_cycle, 'adjust') then
    raise exception 'not authorized';
  end if;
  delete from incident_rows where cycle_id = p_cycle;
  for r in select * from jsonb_array_elements(p_rows) loop
    -- Match to a cohort participant on the STABLE internal id, within this cycle.
    select p.id into v_pid from participants p
     where p.cycle_id = p_cycle and p.qm_participant_id = r->>'participant_key'
     limit 1;
    insert into incident_rows (cycle_id, participant_key, participant_id, raw_student_id, student_name,
      incident_type, question_number, duration_minutes, code_id, status, errors)
    values (p_cycle, r->>'participant_key', v_pid, r->>'raw_student_id', r->>'student_name',
      r->>'incident_type', r->>'question_number',
      nullif(r->>'duration_minutes', '')::numeric,
      nullif(r->>'code_id', '')::uuid,
      coalesce(r->>'status', 'ok'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(r->'errors') x), '{}'));
  end loop;
  perform app.audit(p_cycle, 'import_incidents', 'incident_rows', p_cycle::text, null,
    jsonb_build_object('count', jsonb_array_length(p_rows)));
end $$;


create or replace function public.clear_incident_rows(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(p_cycle, 'adjust') then
    raise exception 'not authorized';
  end if;
  delete from incident_rows where cycle_id = p_cycle;
  perform app.audit(p_cycle, 'clear', 'incident_rows', p_cycle::text, null, null);
end $$;


-- ── configuration (methodology, incidents, labels, docs, workspace) → configure 

create or replace function public.upsert_incident_code(
  p_id uuid, p_code text, p_label text, p_match_types text[],
  p_formula jsonb, p_per_code_cap numeric, p_active boolean)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app.has_permission(null, 'configure') then
    raise exception 'not authorized';
  end if;
  if coalesce(btrim(p_code), '') = '' or coalesce(btrim(p_label), '') = '' then
    raise exception 'code and label are required';
  end if;
  if p_per_code_cap is null or p_per_code_cap < 0 then
    raise exception 'per-incident cap must be >= 0 (add-only)';
  end if;
  if not app.incident_formula_add_only(p_formula) then
    raise exception 'formula is invalid or not add-only';
  end if;

  if p_id is null then
    insert into incident_codes (code, label, match_types, formula, per_code_cap, active, updated_by)
    values (btrim(p_code), btrim(p_label), coalesce(p_match_types, '{}'), p_formula,
            p_per_code_cap, coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    update incident_codes set
      code = btrim(p_code), label = btrim(p_label), match_types = coalesce(p_match_types, '{}'),
      formula = p_formula, per_code_cap = p_per_code_cap, active = coalesce(p_active, true),
      updated_by = auth.uid(), updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'incident code % not found', p_id; end if;
  end if;

  perform app.audit(null, 'upsert_incident_code', 'incident_code', v_id::text, null,
    jsonb_build_object('code', p_code, 'formula', p_formula, 'per_code_cap', p_per_code_cap, 'active', p_active));
  return v_id;
end $$;


create or replace function public.delete_incident_code(p_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(null, 'configure') then
    raise exception 'not authorized';
  end if;
  delete from incident_codes where id = p_id;
  perform app.audit(null, 'delete_incident_code', 'incident_code', p_id::text, null, null);
end $$;


create or replace function public.set_incident_settings(p_per_student_cap numeric)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(null, 'configure') then
    raise exception 'not authorized';
  end if;
  if p_per_student_cap is not null and p_per_student_cap < 0 then
    raise exception 'per-student cap must be >= 0 (add-only)';
  end if;
  insert into incident_settings (id, per_student_cap, updated_by, updated_at)
  values (true, p_per_student_cap, auth.uid(), now())
  on conflict (id) do update
    set per_student_cap = excluded.per_student_cap, updated_by = auth.uid(), updated_at = now();
  perform app.audit(null, 'set_incident_settings', 'incident_settings', 'global', null,
    jsonb_build_object('per_student_cap', p_per_student_cap));
end $$;


create or replace function public.set_incident_mapping(p_mapping jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(null, 'configure') then
    raise exception 'not authorized';
  end if;
  insert into incident_import_mappings (id, mapping, updated_by, updated_at)
  values (true, coalesce(p_mapping, '{}'::jsonb), auth.uid(), now())
  on conflict (id) do update
    set mapping = excluded.mapping, updated_by = auth.uid(), updated_at = now();
  perform app.audit(null, 'set_incident_mapping', 'incident_import_mapping', 'global', null, p_mapping);
end $$;


create or replace function public.set_element_labels(p_config jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(null, 'configure') then
    raise exception 'not authorized';
  end if;
  if jsonb_typeof(p_config) is distinct from 'array' then
    raise exception 'element labels payload must be a JSON array';
  end if;

  -- every row needs a subject, match key, letter and display label
  if exists (
    select 1
    from jsonb_to_recordset(p_config)
      as x(subject text, "matchKey" text, letter text, label text)
    where coalesce(btrim(x.subject), '') = ''
       or coalesce(btrim(x."matchKey"), '') = ''
       or coalesce(btrim(x.letter), '') = ''
       or coalesce(btrim(x.label), '') = ''
  ) then
    raise exception 'every element label needs a subject, match key, letter and display label';
  end if;

  -- a letter may be used at most once within a subject
  if exists (
    select 1
    from jsonb_to_recordset(p_config) as x(subject text, letter text)
    group by x.subject, upper(btrim(x.letter))
    having count(*) > 1
  ) then
    raise exception 'each subject must use a letter at most once';
  end if;

  delete from element_labels;
  insert into element_labels (subject, match_key, letter, label, sort_order)
  select x.subject, x."matchKey", upper(btrim(x.letter)), x.label, x.ord
  from jsonb_to_recordset(p_config) with ordinality
    as x(subject text, "matchKey" text, letter text, label text, ord int);

  perform app.audit(null, 'set_element_labels', 'workspace', 'element_labels', null, p_config);
end $$;


create or replace function public.set_document_settings(p_cycle uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(p_cycle, 'configure') then
    raise exception 'not authorized';
  end if;
  insert into document_settings (cycle_id, settings, updated_at)
  values (p_cycle, p_settings, now())
  on conflict (cycle_id) do update
    set settings = document_settings.settings || excluded.settings, updated_at = now();
  perform app.audit(p_cycle, 'set_document_settings', 'cycle', p_cycle::text, null, p_settings);
end $$;


create or replace function public.set_workspace_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v_band numeric;
begin
  if not app.has_permission(null, 'configure') then
    raise exception 'not authorized';
  end if;

  -- Server-side validation for the grade-bearing borderline band. Keep the bounds
  -- in sync with BORDERLINE_BAND_MIN/MAX in lib/data/grading.ts.
  if p_key = 'borderline' then
    if jsonb_typeof(p_value -> 'bandPct') is distinct from 'number' then
      raise exception 'borderline.bandPct must be a number';
    end if;
    v_band := (p_value ->> 'bandPct')::numeric;
    if v_band < 0 or v_band > 20 then
      raise exception 'borderline.bandPct must be between 0 and 20';
    end if;
  end if;

  insert into workspace_settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform app.audit(null, 'set_workspace_setting', 'workspace', p_key, null, p_value);
end $$;


-- ── override another user's grade-bearing decision → override ────

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

  -- P2: gate on the `override` permission (the matrix is the source of truth),
  -- not the old strictly-higher role hierarchy. v_prior is still resolved above
  -- for the override audit trail.
  v_actor_role   := app.role_of(v_cycle, auth.uid());
  v_subject_role := coalesce(app.role_of(v_cycle, v_prior), 'reviewer'::member_role);
  if not app.has_permission(v_cycle, 'override') then
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

  -- P2: gate on the `override` permission (the matrix is the source of truth),
  -- not the old strictly-higher role hierarchy. v_prior is still resolved above
  -- for the override audit trail.
  v_actor_role   := app.role_of(p_cycle, v_actor);
  v_subject_role := coalesce(app.role_of(p_cycle, v_prior), 'reviewer'::member_role);
  if not app.has_permission(p_cycle, 'override') then
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


-- ── intake — empty a sitting (authenticated path) → intake ─────

create or replace function public.clear_sitting_data(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare v_deleted bigint;
begin
  if not app.has_permission(p_cycle, 'intake') then
    raise exception 'not authorized';
  end if;

  v_deleted := app.clear_cycle_ingest(p_cycle);

  update exam_cycles set status = 'draft', updated_at = now() where id = p_cycle;

  perform app.audit(p_cycle, 'clear', 'exam_cycle', p_cycle::text, null,
                    jsonb_build_object('cleared', true, 'rows_deleted', v_deleted));
  return v_deleted;
end $$;


-- ── workspace administration — members, deletion, centres → workspace_admin 

create or replace function public.invite_member(p_email text, p_role member_role, p_cycle uuid default null)
returns text language plpgsql security definer set search_path = public, app, auth as $$
declare v_uid uuid;
begin
  if not app.has_permission(p_cycle, 'workspace_admin') then
    raise exception 'not authorized: only an admin may invite members';
  end if;

  select id into v_uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_uid is null then
    raise exception 'no account for % — invite them to the workspace via Supabase auth first, then assign a membership here', p_email;
  end if;

  if exists (select 1 from memberships where user_id = v_uid and cycle_id is not distinct from p_cycle) then
    update memberships set role = p_role where user_id = v_uid and cycle_id is not distinct from p_cycle;
    return 'updated';
  else
    insert into memberships (user_id, cycle_id, role) values (v_uid, p_cycle, p_role);
    return 'added';
  end if;
end $$;


create or replace function public.set_member_role(p_user uuid, p_cycle uuid, p_role member_role)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(p_cycle, 'workspace_admin') then
    raise exception 'not authorized: only an admin may change member roles';
  end if;
  update memberships
     set role = p_role
   where user_id = p_user and cycle_id is not distinct from p_cycle;
  if not found then
    raise exception 'no membership for that user at the given scope';
  end if;
end $$;


create or replace function public.remove_member(p_user uuid, p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(p_cycle, 'workspace_admin') then
    raise exception 'not authorized: only an admin may remove members';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot remove your own membership';
  end if;
  delete from memberships where user_id = p_user and cycle_id is not distinct from p_cycle;
end $$;


create or replace function public.delete_sitting(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  c exam_cycles;
  v_total bigint;
begin
  if not app.has_permission(p_cycle, 'workspace_admin') then
    raise exception 'not authorized';
  end if;

  select * into c from exam_cycles where id = p_cycle;
  if not found then return 0; end if;

  v_total := app.cycle_row_count(p_cycle);

  -- Audit at the workspace level (cycle_id NULL) so the cascade can't sweep it.
  perform app.audit(null, 'delete', 'exam_cycle', p_cycle::text, to_jsonb(c),
                    jsonb_build_object('rows_deleted', v_total));

  delete from exam_cycles where id = p_cycle;   -- cascades all child rows counted above
  return v_total;
end $$;


create or replace function public.delete_cycle(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  c exam_cycles;
  v_total bigint;
begin
  if not app.has_permission(p_cycle, 'workspace_admin') then
    raise exception 'not authorized';
  end if;

  select * into c from exam_cycles where id = p_cycle;
  if not found then return 0; end if;

  -- (last-cycle guard removed — deleting the final cycle is allowed.)

  v_total := app.cycle_row_count(p_cycle);

  perform app.audit(null, 'delete', 'exam_cycle', p_cycle::text, to_jsonb(c),
                    jsonb_build_object('rows_deleted', v_total, 'via', 'delete_cycle'));

  delete from exam_cycles where id = p_cycle;   -- cascades all child rows
  return v_total;
end $$;


create or replace function public.create_test_centre(
  p_name text, p_code text, p_slug text default null, p_region text default 'eu-west')
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t test_centres; v_slug text;
begin
  if not app.has_permission(null, 'workspace_admin') then raise exception 'not authorized'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name is required'; end if;
  if coalesce(trim(p_code), '') = '' then raise exception 'code is required'; end if;
  v_slug := coalesce(nullif(trim(p_slug), ''),
                     trim(both '-' from lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'))));
  begin
    insert into test_centres (name, code, slug, region)
    values (trim(p_name), trim(p_code), v_slug, p_region)
    returning * into t;
  exception when unique_violation then
    raise exception 'a test centre with code "%" or slug "%" already exists',
      trim(p_code), v_slug;
  end;
  perform app.audit(null, 'create', 'test_centre', t.id::text, null, to_jsonb(t));
  return t;
end $$;


create or replace function public.update_test_centre(
  p_id uuid, p_name text default null, p_code text default null, p_active boolean default null)
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t_before test_centres; t_after test_centres; v_slug text;
begin
  if not app.has_permission(null, 'workspace_admin') then raise exception 'not authorized'; end if;
  select * into t_before from test_centres where id = p_id;
  if not found then raise exception 'test centre not found'; end if;

  -- Re-derive the slug from a non-empty new name only when the current slug still
  -- matches the current name (i.e. it was auto-derived, not hand-set). This keeps
  -- the route-safe slug in step with a rename without overwriting a custom slug.
  v_slug := t_before.slug;
  if nullif(trim(p_name), '') is not null
     and t_before.slug = trim(both '-' from lower(regexp_replace(t_before.name, '[^a-zA-Z0-9]+', '-', 'g')))
  then
    v_slug := trim(both '-' from lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g')));
  end if;

  begin
    update test_centres set
      name   = coalesce(nullif(trim(p_name), ''), name),
      code   = coalesce(nullif(trim(p_code), ''), code),
      slug   = v_slug,
      active = coalesce(p_active, active),
      updated_at = now()
    where id = p_id
    returning * into t_after;
  exception when unique_violation then
    raise exception 'a test centre with code "%" or slug "%" already exists',
      coalesce(nullif(trim(p_code), ''), t_before.code), v_slug;
  end;
  perform app.audit(null, 'update', 'test_centre', p_id::text, to_jsonb(t_before), to_jsonb(t_after));
  return t_after;
end $$;


create or replace function public.set_test_centre_active(p_id uuid, p_active boolean)
returns test_centres language plpgsql security definer set search_path = public, app as $$
declare t test_centres;
begin
  if not app.has_permission(null, 'workspace_admin') then raise exception 'not authorized'; end if;
  update test_centres set active = p_active, updated_at = now()
    where id = p_id returning * into t;
  if not found then raise exception 'test centre not found'; end if;
  perform app.audit(null, case when p_active then 'activate' else 'deactivate' end,
                    'test_centre', p_id::text, null, to_jsonb(t));
  return t;
end $$;


create or replace function public.move_exam_year_to_centre(
  p_year_id uuid, p_test_centre_id uuid)
returns exam_years language plpgsql security definer set search_path = public, app as $$
declare y_before exam_years; y_after exam_years; v_centre_name text;
begin
  if not app.has_permission(null, 'workspace_admin') then raise exception 'not authorized'; end if;

  select * into y_before from exam_years where id = p_year_id;
  if not found then raise exception 'exam year not found'; end if;

  select name into v_centre_name from test_centres where id = p_test_centre_id;
  if not found then raise exception 'test centre not found'; end if;

  -- Idempotent fast path: already in the target centre — nothing to write/audit.
  if y_before.test_centre_id = p_test_centre_id then
    return y_before;
  end if;

  -- The ONLY mutation: relabel the year's centre. Grade-bearing data is untouched
  -- and the engine is not recomputed (centre is a scoping key, never a score input).
  begin
    update exam_years set test_centre_id = p_test_centre_id, updated_at = now()
      where id = p_year_id
      returning * into y_after;
  exception when unique_violation then
    raise exception 'centre "%" already has a % year', v_centre_name, y_before.name;
  end;

  perform app.audit(null, 'move', 'exam_year', p_year_id::text,
                    to_jsonb(y_before), to_jsonb(y_after));
  return y_after;
end $$;


-- ── sign-off — lock / unlock a sitting → signoff ────────────────

create or replace function public.lock_grades(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(p_cycle, 'signoff') then
    raise exception 'not authorized';
  end if;
  update grades set locked = true, signed_off_by = auth.uid(), signed_off_at = now()
    where cycle_id = p_cycle;
  update exam_cycles set status = 'locked', updated_at = now() where id = p_cycle;
  perform app.audit(p_cycle, 'lock_grades', 'cycle', p_cycle::text, null,
                    jsonb_build_object('locked', true));
end $$;


create or replace function public.unlock_grades(p_cycle uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_permission(p_cycle, 'signoff') then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'unlock requires a reason';
  end if;
  update grades set locked = false, signed_off_by = null, signed_off_at = null
    where cycle_id = p_cycle;
  update exam_cycles set status = 'graded', updated_at = now() where id = p_cycle;
  perform app.audit(p_cycle, 'unlock_grades', 'cycle', p_cycle::text, null,
                    jsonb_build_object('locked', false, 'reason', p_reason));
end $$;
