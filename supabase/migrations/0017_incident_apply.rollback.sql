-- Rollback 0017 — Incident Adjustments apply / commit state (02b).
drop function if exists public.apply_incident_adjustments(uuid);
drop function if exists public.unapply_incident_adjustments(uuid);
drop table if exists incident_applications;
