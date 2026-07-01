-- Rollback 0018 — Incident Adjustments imported-source provenance.
drop function if exists public.set_incident_import_source(uuid, text, boolean);
drop function if exists public.clear_incident_import_source(uuid);
drop table if exists incident_import_source;
