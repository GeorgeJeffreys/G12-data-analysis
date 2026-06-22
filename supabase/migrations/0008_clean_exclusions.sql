-- ============================================================================
-- G12++ — persist Clean-stage removals (non-destructive row/column exclusions).
-- Migration 0008_clean_exclusions.sql
--
-- Why this exists
--   The Clean step lets a reviewer remove rows (participants) and columns (items)
--   from the working/cleaned set BEFORE scoring. This is non-destructive: the raw
--   `responses` / `items` / `participants` rows are never touched — a removal is a
--   recorded decision (like an item-review exclusion) that the cleaned view and
--   every downstream read (raw scores, scoring) honour.
--
--   Until now the selection lived only in client component state, so it never
--   propagated downstream and did not survive a reload. This migration adds the
--   storage + a SECURITY DEFINER RPC so the decision persists per cycle/subject
--   and is replayed on hydrate, exactly like item exclusions.
--
-- What this does
--   1. `clean_exclusions` table: one row per removed target (kind = row | col).
--   2. RLS: members read; lead/admin + reviewers write (mirrors item_reviews).
--   3. `set_clean_removal(...)` / `clear_clean_removals(...)` RPCs (audited).
--
-- Engine parity is unaffected: with no clean removals the scored set is identical.
-- ============================================================================

-- 1. Table --------------------------------------------------------------------
create table if not exists clean_exclusions (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references exam_cycles(id) on delete cascade,
  assessment_id uuid not null references assessments(id) on delete cascade,
  kind          text not null check (kind in ('row', 'col')),
  -- participant id (kind='row') or item id (kind='col'). No FK: a single column
  -- targets two tables, and the on-delete-cascade on cycle_id already cleans up.
  target_id     uuid not null,
  decided_by    uuid not null default auth.uid() references auth.users(id),
  decided_at    timestamptz not null default now(),
  unique (cycle_id, assessment_id, kind, target_id)
);

create index if not exists clean_exclusions_cycle_idx on clean_exclusions (cycle_id);

-- 2. Row Level Security -------------------------------------------------------
alter table clean_exclusions enable row level security;

-- Read: any member of the cycle.
create policy clean_exclusions_select on clean_exclusions for select
  using (app.is_member(cycle_id));
-- Write: lead/admin + reviewers (the human gate, same as item_reviews). The RPC
-- re-checks this server-side; the policy keeps direct table writes honest too.
create policy clean_exclusions_write on clean_exclusions for all
  using (app.has_role(cycle_id, array['lead_admin','reviewer']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin','reviewer']::member_role[]));

-- 3. RPCs ---------------------------------------------------------------------
-- Add or remove a set of clean-stage removals for one subject. `p_remove=true`
-- records the removal; `p_remove=false` restores the listed targets.
create or replace function public.set_clean_removal(
  p_cycle uuid, p_assessment uuid, p_kind text, p_targets uuid[], p_remove boolean)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_target uuid;
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if p_kind not in ('row', 'col') then
    raise exception 'invalid kind %', p_kind;
  end if;
  if p_remove then
    foreach v_target in array coalesce(p_targets, array[]::uuid[]) loop
      insert into clean_exclusions (cycle_id, assessment_id, kind, target_id, decided_by)
      values (p_cycle, p_assessment, p_kind, v_target, auth.uid())
      on conflict (cycle_id, assessment_id, kind, target_id) do nothing;
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

-- Restore every clean-stage removal for one subject ("Revert all").
create or replace function public.clear_clean_removals(p_cycle uuid, p_assessment uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from clean_exclusions where cycle_id = p_cycle and assessment_id = p_assessment;
  perform app.audit(p_cycle, 'clean_removal', 'assessment', p_assessment::text, null,
                    jsonb_build_object('revertAll', true));
end $$;

grant execute on function
  public.set_clean_removal(uuid, uuid, text, uuid[], boolean),
  public.clear_clean_removals(uuid, uuid)
to authenticated;
