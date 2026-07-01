-- ============================================================================
-- G12++ — Make Clean-stage participant removals survive a re-import (stable key).
-- Migration 0016_clean_exclusions_stable_key.sql
--
-- WHY THIS EXISTS
--   `clean_exclusions.target_id` (migration 0008) stores the participant's ROW
--   UUID for a row-kind removal. But participant row UUIDs are minted with
--   `randomUUID()` on EVERY ingest (they are not derived from the participant),
--   so after a re-import the stored UUID no longer matches any participant row —
--   the exclusion silently stops applying and the removed participant (e.g. a
--   staff / test account manually excluded from the cohort) reappears.
--
--   P-A established the collision-free natural key for a participant: the email
--   (`ResultParticipantName`), persisted as `participants.qm_participant_id` and
--   STABLE across re-imports. This migration lets a row-kind clean exclusion carry
--   that stable key alongside the (volatile) UUID, so hydrate can re-resolve it to
--   the current row after any re-import. The email list (in code) is the primary,
--   robust fix; this makes AD-HOC manual cohort/row exclusions equally durable.
--
-- WHAT THIS DOES
--   1. Adds nullable `target_key text` to `clean_exclusions` — for kind='row' it
--      holds the participant's stable `qm_participant_id`; null for legacy rows and
--      for kind='col' (item removals are re-keyed elsewhere and out of scope here).
--   2. Replaces `set_clean_removal(...)` with a signature that also accepts the
--      aligned stable keys (`p_keys text[]`), stored into `target_key`.
--
-- Idempotent where practical; run in the Supabase SQL editor (EU). Engine parity
-- is unaffected: with no clean removals the scored set is identical.
-- ============================================================================

-- 1. Stable-key column --------------------------------------------------------
alter table clean_exclusions add column if not exists target_key text;

comment on column clean_exclusions.target_key is
  'kind=row: participant stable natural key (qm_participant_id / email, P-A), so '
  'the removal re-resolves to the current row UUID after a re-import. Null for '
  'legacy rows and for kind=col.';

-- 2. RPC with the stable key --------------------------------------------------
-- The argument list changes (adds p_keys), so replace the 0008 signature rather
-- than create-or-replace (which cannot change the signature). `p_keys[i]` is the
-- stable natural key aligned to `p_targets[i]`; pass an empty array to omit.
drop function if exists public.set_clean_removal(uuid, uuid, text, uuid[], boolean);

create or replace function public.set_clean_removal(
  p_cycle uuid, p_assessment uuid, p_kind text,
  p_targets uuid[], p_keys text[], p_remove boolean)
returns void language plpgsql security definer set search_path = public, app as $$
declare i int; v_target uuid; v_key text;
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
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

grant execute on function
  public.set_clean_removal(uuid, uuid, text, uuid[], text[], boolean)
to authenticated;
