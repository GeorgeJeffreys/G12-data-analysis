-- Rollback 0014 — Configurable A–E element labels per subject.
drop function if exists public.set_element_labels(jsonb);
drop table if exists element_labels;
