-- ============================================================================
-- 0018 — Incident Adjustments: imported-source provenance (per cycle)
--
-- Wires the critical-path Incident step to the config: when a real incident log
-- is imported (0016 import_incident_rows), we also record WHAT was loaded — the
-- file name and whether it is the labelled sample — so the review surface can show
-- the source after a reload and make clear how to replace the sample with real
-- data. Pure provenance: no marks live here, base scores are untouched (183/183
-- parity unaffected), and the capped per-student ledger is still DERIVED at read
-- time from incident_rows + the config (lib/incidents/apply.ts).
--
-- New object:
--   * incident_import_source — one row per cycle: the imported file name + an
--     is_sample flag + who imported it / when.
--
-- Security follows 0016/0017 exactly: RLS (readable by cycle members); no direct
-- client writes; every mutation is a SECURITY DEFINER function that role-checks
-- (app.has_role — the same cycle role as importing rows) + audits.
--
-- Run AFTER 0001–0017, once, in the Supabase SQL editor (EU). Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table. The imported-source provenance per cycle. The labelled demo sample is
--    session-only and is NOT persisted here (is_sample rows are only written if a
--    caller explicitly chooses to record one).
-- ----------------------------------------------------------------------------
create table if not exists incident_import_source (
  cycle_id    uuid primary key references exam_cycles(id) on delete cascade,
  file_name   text not null,
  is_sample   boolean not null default false,
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. RLS. Readable by any cycle member (all roles VIEW the review surface); no
--    direct client writes — provenance flows through section 3.
-- ----------------------------------------------------------------------------
alter table incident_import_source enable row level security;

do $$ begin
  create policy incident_import_source_select on incident_import_source for select using (app.is_member(cycle_id));
exception when duplicate_object then null; end $$;

revoke insert, update, delete on incident_import_source from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 3. SECURITY DEFINER functions — same cycle role as importing rows.
-- ----------------------------------------------------------------------------

-- Record (or replace) the imported source for a cycle. Called alongside
-- import_incident_rows when a real file is imported.
create or replace function public.set_incident_import_source(p_cycle uuid, p_file_name text, p_is_sample boolean)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  insert into incident_import_source (cycle_id, file_name, is_sample, imported_by, imported_at)
  values (p_cycle, p_file_name, coalesce(p_is_sample, false), auth.uid(), now())
  on conflict (cycle_id) do update
    set file_name = excluded.file_name, is_sample = excluded.is_sample,
        imported_by = excluded.imported_by, imported_at = excluded.imported_at;
  perform app.audit(p_cycle, 'set_incident_import_source', 'incident_import_source', p_cycle::text, null,
    jsonb_build_object('file_name', p_file_name, 'is_sample', coalesce(p_is_sample, false)));
end $$;

-- Clear the imported source when the incident rows are cleared. Same cycle role.
create or replace function public.clear_incident_import_source(p_cycle uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from incident_import_source where cycle_id = p_cycle;
  perform app.audit(p_cycle, 'clear', 'incident_import_source', p_cycle::text, null, null);
end $$;

-- ----------------------------------------------------------------------------
-- 4. Grants (callable by signed-in users; each enforces its own role check).
-- ----------------------------------------------------------------------------
grant execute on function
  public.set_incident_import_source(uuid, text, boolean),
  public.clear_incident_import_source(uuid)
to authenticated;
