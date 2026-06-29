-- 0014 — Configurable A–E element labels per subject
--
-- Adds a dedicated config table for the per-subject, ordered A–E element mapping
-- of { match key (the QuestionMajorElement value in the data) → letter → editable
-- display label }. The element columns across the app use these labels instead of
-- a generic, appearance-ordered A–E.
--
-- Read by any signed-in member (it drives the UI); written only by a workspace
-- lead/admin through the SECURITY DEFINER RPC `set_element_labels`, which validates
-- server-side (non-empty subject/match-key/letter/label, and a letter used at most
-- once per subject) before replacing the set, and writes an audit row.
--
-- Matching the data values is case-insensitive and treats "&"/"and" as equivalent;
-- that normalisation lives in the app (lib/data/element-labels.ts) — this table
-- stores the values as authored.

create table if not exists element_labels (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,
  match_key   text not null,
  letter      text not null,
  label       text not null,
  sort_order  int  not null default 0,
  updated_at  timestamptz not null default now(),
  unique (subject, match_key),
  unique (subject, letter)
);

alter table element_labels enable row level security;

-- Readable by any signed-in member (drives the element columns everywhere).
create policy element_labels_select on element_labels for select
  using (auth.uid() is not null);

-- No direct client writes — everything flows through the definer RPC below.
revoke insert, update, delete on element_labels from authenticated, anon;

-- Replace the whole set of element labels (lead/admin only, validated + audited).
-- p_config: [{ "subject": text, "matchKey": text, "letter": text, "label": text }, …]
-- The array order fixes sort_order.
create or replace function public.set_element_labels(p_config jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_workspace_admin() then
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

grant execute on function public.set_element_labels(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Seed the defaults (data value as it appears → letter → default display label).
-- Idempotent: skip rows that already exist for a (subject, match_key).
-- ----------------------------------------------------------------------------
insert into element_labels (subject, match_key, letter, label, sort_order) values
  ('Applicable Math', 'Numerical and quantitative reasoning', 'A', 'Numerical and quantitative reasoning', 1),
  ('Applicable Math', 'Spatial and geometric reasoning', 'B', 'Spatial & geometric reasoning', 2),
  ('Applicable Math', 'Functional algebra and logical thinking', 'C', 'Functional algebra & logical thinking', 3),
  ('Applicable Math', 'Data, probability and decision-making', 'D', 'Data, probability & decision-making', 4),
  ('Applicable Math', 'Graphical literacy and visual data interpretation', 'E', 'Graphical literacy & visual data interpretation', 5),
  ('Scientific Thinking', 'Explain phenomena scientifically', 'A', 'Explain phenomena scientifically', 1),
  ('Scientific Thinking', 'Evaluate and design scientific inquiry', 'B', 'Evaluate and design scientific inquiry', 2),
  ('Scientific Thinking', 'Interpret evidence and data scientifically', 'C', 'Interpret evidence and data scientifically', 3),
  ('Arabic as a 1st Language', 'Reading comprehension', 'A', 'Reading Comprehension', 1),
  ('Arabic as a 1st Language', 'Editing and Proofreading', 'B', 'Editing and Proofreading', 2),
  ('Arabic as a 1st Language', 'Writing and Expression', 'C', 'Writing and Expression', 3),
  ('English as a 2nd Language', 'Reading comprehension', 'A', 'Reading comprehension', 1),
  ('English as a 2nd Language', 'Listening comprehension', 'B', 'Listening Comprehension', 2),
  ('English as a 2nd Language', 'Writing and expression', 'C', 'Writing and expression', 3),
  ('Life Success Skills', 'Communication', 'A', 'Communication', 1),
  ('Life Success Skills', 'Creative Problem Solving', 'B', 'Creative problem-solving', 2),
  ('Life Success Skills', 'Self-management', 'C', 'Self-management', 3),
  ('Life Success Skills', 'Collaboration', 'D', 'Collaboration', 4)
on conflict (subject, match_key) do nothing;
