-- Rollback 0016 — Incident Adjustments config registry + import (02a).
drop function if exists public.import_incident_rows(uuid, jsonb);
drop function if exists public.clear_incident_rows(uuid);
drop function if exists public.set_incident_mapping(jsonb);
drop function if exists public.set_incident_settings(numeric);
drop function if exists public.delete_incident_code(uuid);
drop function if exists public.upsert_incident_code(uuid, text, text, text[], jsonb, numeric, boolean);

drop table if exists incident_rows;
drop table if exists incident_import_mappings;
drop table if exists incident_settings;
drop table if exists incident_codes;

drop function if exists app.incident_formula_add_only(jsonb);
