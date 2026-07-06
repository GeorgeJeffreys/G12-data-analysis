-- ============================================================================
-- G12++ — DELETE CYCLE: an admin-gated, audited, full-cascade cycle delete with a
-- last-cycle guard, surfaced on the cycle's Settings danger menu.
-- Migration 0032_delete_cycle.sql
--
-- WHY THIS EXISTS
--   A cycle (an `exam_cycles` row = one sitting) could be cleared or deleted only
--   from the Upload screen's danger zone. This adds a first-class `delete_cycle`
--   entry point that removes the cycle row AND every row keyed to that `cycle_id`
--   across all tables, with the same guarantees as `delete_sitting` PLUS a guard
--   that refuses to delete the last remaining cycle (which would leave the
--   workspace with nothing to open).
--
-- WHAT THIS DOES
--   `public.delete_cycle(p_cycle uuid) -> bigint` — identical to `delete_sitting`
--   (admin-gated via `app.has_role`, pre-counts rows via `app.cycle_row_count`,
--   audits at workspace level with `cycle_id = NULL` so the cascade can't sweep the
--   audit row, then `delete from exam_cycles` cascades every child via the FK
--   `on delete cascade`) with ONE addition: it raises if this is the only remaining
--   cycle. The cascade removes every child table (responses, sittings, items,
--   participants, scores, grades, incidents, essays, exclusions, rollups, audit,
--   memberships, …) — no orphans. Other cycles are untouched.
--
-- SCOPE / SAFETY
--   One new function only — no data mutation on install, no schema change. Reuses
--   the exact cascade + audit + `has_role` gate from 0018/0020/0022. Does not touch
--   the scoring engine (183/183) or the C1 auth model. Forward-only; reversible via
--   0032_delete_cycle.rollback.sql. Run AFTER 0001–0031 in the Supabase SQL editor.
-- ============================================================================

begin;

set local lock_timeout = '30s';

drop function if exists public.delete_cycle(uuid);
create or replace function public.delete_cycle(p_cycle uuid)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare
  c exam_cycles;
  v_total bigint;
begin
  -- Admin-only (C1 has_role), same gate as delete_sitting.
  if not app.has_role(p_cycle, array['lead_admin']::member_role[]) then
    raise exception 'not authorized';
  end if;

  select * into c from exam_cycles where id = p_cycle;
  if not found then return 0; end if;

  -- Last-cycle guard: never delete the final cycle — that would leave the
  -- workspace with no cycle to open. The caller must keep at least one.
  if (select count(*) from exam_cycles) <= 1 then
    raise exception 'cannot delete the last remaining cycle';
  end if;

  v_total := app.cycle_row_count(p_cycle);

  -- Audit at the workspace level (cycle_id NULL) so the cascade can't sweep it.
  perform app.audit(null, 'delete', 'exam_cycle', p_cycle::text, to_jsonb(c),
                    jsonb_build_object('rows_deleted', v_total, 'via', 'delete_cycle'));

  delete from exam_cycles where id = p_cycle;   -- cascades all child rows counted above
  return v_total;
end $$;

grant execute on function public.delete_cycle(uuid) to authenticated;

commit;
