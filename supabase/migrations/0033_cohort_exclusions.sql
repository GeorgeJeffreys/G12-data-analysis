-- ============================================================================
-- G12++ — cohort-wide participant exclusions become EDITABLE DATA (not code).
-- Migration 0033_cohort_exclusions.sql
--
-- WHY THIS EXISTS
--   Staff / test accounts (historically Lavinia + Muamina) were auto-excluded via
--   an email list HARD-CODED in the source (`lib/data/staff-exclusions.ts`,
--   `isStaffTestEmail`). That does not generalise — the next cohort has different
--   staff — and it is invisible and unchangeable to the user. This migration moves
--   the staff/test status out of code and into data the admin can see and edit:
--
--     * a dedicated `cohort_exclusions` table — one row per participant excluded
--       from the WHOLE cohort (every subject), keyed on the participant's STABLE
--       natural key (`qm_participant_id` / email, P-A), so the exclusion survives a
--       re-import with no stored UUID to dangle;
--     * a `set_cohort_exclusion(...)` RPC the Clean UI's "Remove from all subjects"
--       (and its restore) drive;
--     * a one-time SEED of the two historically-excluded accounts for any existing
--       cohort, so behaviour does not change today — but the rows are now visible in
--       the app and can be edited / removed / added to for a different cohort.
--
--   This is DISTINCT from `clean_exclusions` (migration 0008/0016), which is the
--   PER-SUBJECT removal (one sitting). Keeping the two scopes in separate stores is
--   what lets the app offer "Remove from <subject>" vs "Remove from all subjects"
--   without conflating them.
--
-- Forward-only; idempotent where practical. Run in the Supabase SQL editor (EU).
-- Engine parity is unaffected: with no exclusions the scored set is identical.
-- ============================================================================

begin;

-- 1. Table --------------------------------------------------------------------
create table if not exists cohort_exclusions (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references exam_cycles(id) on delete cascade,
  -- The participant's STABLE natural key (qm_participant_id = email, P-A). NOT the
  -- volatile per-ingest row UUID, so the exclusion re-resolves after a re-import.
  participant_key text not null,
  reason          text not null default 'Excluded from all subjects',
  -- Nullable: a seeded default (below) has no human decider; ad-hoc exclusions
  -- recorded through the RPC stamp auth.uid().
  decided_by      uuid references auth.users(id) default auth.uid(),
  decided_at      timestamptz not null default now(),
  unique (cycle_id, participant_key)
);

create index if not exists cohort_exclusions_cycle_idx on cohort_exclusions (cycle_id);

comment on table cohort_exclusions is
  'Cohort-wide participant exclusions (staff/test/withdrawn), keyed on the stable '
  'qm_participant_id so they survive re-import. Editable data — replaces the old '
  'hard-coded isStaffTestEmail list. Distinct from per-subject clean_exclusions.';

-- 2. Row Level Security -------------------------------------------------------
alter table cohort_exclusions enable row level security;

-- Read: any member of the cycle.
create policy cohort_exclusions_select on cohort_exclusions for select
  using (app.is_member(cycle_id));
-- Write: lead/admin + reviewers (the human gate, same as clean_exclusions). The
-- RPC re-checks this server-side; the policy keeps direct table writes honest too.
create policy cohort_exclusions_write on cohort_exclusions for all
  using (app.has_role(cycle_id, array['lead_admin','reviewer']::member_role[]))
  with check (app.has_role(cycle_id, array['lead_admin','reviewer']::member_role[]));

-- 3. RPC ----------------------------------------------------------------------
-- Add (p_remove=true) or lift (p_remove=false) a whole-cohort exclusion for one
-- participant, keyed on their stable natural key. Audited. Lead/admin + reviewer.
create or replace function public.set_cohort_exclusion(
  p_cycle uuid, p_key text, p_reason text, p_remove boolean)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
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

revoke all on function public.set_cohort_exclusion(uuid, text, text, boolean) from public;
grant execute on function public.set_cohort_exclusion(uuid, text, text, boolean) to authenticated;

-- 4. Seed the historical staff/test exclusions as DEFAULT DATA -----------------
-- This is the ONE place the historical Lavinia/Muamina list survives — as an
-- editable data seed, not a runtime filter. It excludes them for every EXISTING
-- cohort that actually contains the account (matched on the stable email), so
-- today's behaviour is unchanged. A future cohort with different staff simply gets
-- different rows here (via the app), with nothing to change in code.
insert into cohort_exclusions (cycle_id, participant_key, reason, decided_by)
select distinct p.cycle_id, p.qm_participant_id,
  case
    when lower(trim(p.qm_participant_id)) = 'lavinia.cavalet@alsamaproject.com'
      then 'Staff account (G12 Lead) — seeded default, editable'
    else 'Test / re-sit account — seeded default, editable'
  end,
  null::uuid  -- seeded default has no human decider; explicit cast (bare null is text)
from participants p
where lower(trim(p.qm_participant_id)) in (
  'lavinia.cavalet@alsamaproject.com',
  'muamina.mlisho@alsamaproject.com'
)
on conflict (cycle_id, participant_key) do nothing;

-- 5. Schema drift probe — advertise the new table + function ------------------
create or replace function public.schema_health()
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_missing_cols text[] := '{}';
  v_missing_fns  text[] := '{}';
  v_missing_tbls text[] := '{}';
begin
  -- Required columns (schema, table, column).
  if to_regclass('public.items') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'items' and column_name = 'item_set') then
    v_missing_cols := array_append(v_missing_cols, 'items.item_set');
  end if;

  -- Required tables.
  if to_regclass('public.cohort_exclusions') is null then
    v_missing_tbls := array_append(v_missing_tbls, 'public.cohort_exclusions');
  end if;

  -- Required functions (by schema.name — signature-agnostic is enough for drift).
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ingest_persist') then
    v_missing_fns := array_append(v_missing_fns, 'public.ingest_persist');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'delete_sitting') then
    v_missing_fns := array_append(v_missing_fns, 'public.delete_sitting');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'clear_sitting_data') then
    v_missing_fns := array_append(v_missing_fns, 'public.clear_sitting_data');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'clear_cycle_ingest') then
    v_missing_fns := array_append(v_missing_fns, 'app.clear_cycle_ingest');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'set_cohort_exclusion') then
    v_missing_fns := array_append(v_missing_fns, 'public.set_cohort_exclusion');
  end if;

  return jsonb_build_object(
    'ok', (cardinality(v_missing_cols) = 0 and cardinality(v_missing_fns) = 0
           and cardinality(v_missing_tbls) = 0),
    'migration', '0033',
    'missing_columns', to_jsonb(v_missing_cols),
    'missing_tables', to_jsonb(v_missing_tbls),
    'missing_functions', to_jsonb(v_missing_fns));
end $$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated, service_role;

commit;
