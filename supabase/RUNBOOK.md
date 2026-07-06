# Supabase provider — verification runbook

This is the **provider built blind** (no DB access from the build environment).
Run these steps from your own machine to seed the database and verify the
round-trip, RLS, and the privileged transitions. Everything is reversible.

Prereqs: migrations `0001`–`0008` applied in the Supabase SQL editor (run any you
haven't, in order — `0003_adjustments_essays_config.sql`,
`0004_create_cycle_with_assessments.sql`, `0005_year_sitting_structure.sql`,
`0006_qm_3csv_model.sql`, `0007_ingest_idempotent_topic_id.sql`,
`0008_clean_exclusions.sql`), and Node ≥ 20. Then apply `0009`–`0019` in order
(each is additive + reversible; see the per-migration notes below where present).
NB: prompt 06 and prompt 02a both shipped a `0016_*` file (`0016_override_role_hierarchy.sql`
and `0016_incident_adjustments.sql`); apply both, then `0017`, then `0018`, then `0019`,
then `0020`.

> **`0031_cycle_lifecycle_date_delete.sql` — carry the sitting DATE + add a cycle-level
> DELETE (run AFTER 0001–0030).**
> Adds a nullable `exam_cycles.sitting_date date` and re-creates
> `create_cycle_with_assessments(...)` with a trailing `p_sitting_date date default null`
> parameter (persisting it) — the previous 6-arg signature is dropped so the 7-arg one is
> unambiguous, so **the app's create-sitting will 404 the RPC until this is applied**
> (the client now sends `p_sitting_date`). Adds `public.delete_cycle(uuid) returns bigint`
> — the cycle-level danger action that REUSES the `delete_sitting` cascade
> (`app.cycle_row_count` → `delete from exam_cycles`), admin-gated via the C1
> `app.has_role` primitive, audited at the workspace level, and refusing to delete the
> LAST remaining cycle. `schema_health()` reports `'0031'` and probes the new column +
> function (every 0025–0030 probe retained). Verify with `select public.schema_health();`
> (expect `ok=true`, `migration='0031'`); create a sitting with a date and confirm
> `select id, name, sitting_date from exam_cycles order by created_at desc limit 1;`;
> dry-run a delete count with `select app.cycle_row_count('<CYCLE_UUID>');` then
> `select public.delete_cycle('<CYCLE_UUID>');` (zero rows remain for that cycle_id in
> every table, other cycles untouched). Engine parity 183/183 unaffected. Roll back with
> `0031_cycle_lifecycle_date_delete.rollback.sql`.

> **`0026_pipeline_natural_key_spine.sql` — REBUILD data processing to natural keys +
> a clean fact-table baseline (run AFTER 0025).**
> Run AFTER `0001`–`0025`, in the Supabase SQL editor (EU). Establishes the clean
> natural-key model for the per-sitting fact tables: a first-class **`sittings`** table
> keyed by the QM `ResultId` (`primary key (cycle_id, qm_result_id)`), **`responses`**
> UNIQUE `(cycle_id, qm_result_id, question_id)` (one row per sitting × question — the
> key that makes identical-profile sittings impossible to collide), and a **real delete
> cascade** `responses → sittings → exam_cycles`. It DROPS + recreates only the three
> leaf fact tables (`responses`, `result_totals` → renamed `sittings`, `topic_rollups`
> — nothing has an inbound FK to them), so the metadata tables, the scoring-engine feed
> (`engine-write.ts` reads `responses.item_id`/`participant_id`, retained as join
> surrogates) and every unrelated feature are untouched. `ingest_persist` is rewritten
> to filter → clear-then-write at the new grain (inserting the `sittings` spine before
> its children); the delete/clear lifecycle references `sittings`. **This DROPS the
> fact tables (test-only data — no backup); re-ingest the CSVs after running it.**
> `schema_health()` now also asserts the `sittings` table, the
> `(cycle_id, qm_result_id, question_id)` unique, and the responses→sittings cascade,
> and reports `'0026'` (all 0025 auth probes retained). Verify with
> `select public.schema_health();` (expect `ok=true`, `migration='0026'`), then on the
> live app delete + re-ingest the `700435` CSVs into a fresh cycle → per-subject counts
> **15 / 11 / 12 / 9 / 10**, Dalal Hasan present, no `ResultId` spanning >1 subject,
> sitting-records ≫ participants; delete clears to the empty Upload state; re-uploading
> keeps the counts; `reconcile.py` base scores reconcile 1:1. Engine parity 183/183
> unchanged. Roll back with `0026_pipeline_natural_key_spine.rollback.sql` (restores the
> pre-0026 fact tables + the 0025 probe).

> **`0025_authorization_rebuild.sql` — REBUILD authorization to one simple, consistent
> model (SUPERSEDES 0024; run this to reset auth cleanly and unblock admins).**
> Run AFTER `0001`–`0024`, in the Supabase SQL editor (EU). Idempotent (`create or
> replace` of SECURITY DEFINER functions + the memberships policy set + the read-only
> probe — no table/column/constraint/DATA change). Two transactions (functions, then
> the memberships policies), each with a `lock_timeout`, mirroring the 0024 deadlock
> discipline. It establishes **one** authorization primitive
> `app.has_role(target_cycle, allowed[])` — true when the caller holds any `allowed`
> role for `target_cycle` OR workspace-wide (`cycle_id IS NULL`), SECURITY DEFINER so
> its `memberships` read does not re-enter RLS — and DERIVES `app.is_member` from it.
> RLS on `memberships` becomes minimal and non-recursive: SELECT = `user_id =
> auth.uid()` only (pure self-read, calls no memberships-reading function), and
> INSERT/UPDATE/DELETE gated on `has_role(cycle_id,'lead_admin')` (workspace admin
> manages every row; cycle admin manages their cycle) — split per-command so the write
> guard never leaks onto SELECT. Every other table already routes reads through
> `is_member` and writes through `has_role`, so they are correct unchanged. The storage
> enum `member_role` (`lead_admin`/`reviewer`/`viewer`/`analyst`) stays the single
> persisted source of truth (the app tiers in `lib/auth/roles.ts` are the one app-layer
> vocabulary); the enum is NOT renamed. `schema_health()` now also asserts the enum,
> the workspace-aware `has_role`, and the memberships policy shape, and reports `'0025'`.
> Verify with `select public.schema_health();` (expect `ok=true`, `migration='0025'`),
> then on the live app as the workspace admin: Replace files (no "forbidden") and Delete
> (clears to the empty Upload state); a member cannot delete/replace. Engine parity
> 183/183 unchanged. Roll back with `0025_authorization_rebuild.rollback.sql` (restores
> the 0024 surface, keeping the helpers workspace-aware).

> **`0024_authorization_workspace_scope.sql` — restore workspace-scope auth
> (RUN THIS if Delete says "not authorized" and Replace files returns "forbidden").**
> Task 20. Run AFTER `0001`–`0023`, in the Supabase SQL editor (EU). Idempotent
> (`create or replace` + one policy swap — no table/column/constraint/DATA change).
> Both cycle data-mutations gate on the SAME membership authorization: Delete /
> Clear via `delete_sitting`/`clear_sitting_data`'s `app.has_role(cycle,'lead_admin')`
> guard, and Replace files via the ingest route reading the caller's admin membership.
> If `app.is_member` / `app.has_role` drift back to the strict, cycle-scoped 0001
> bodies, a **workspace admin** (`memberships.cycle_id IS NULL`, RUNBOOK §2) authorizes
> nothing — Delete raises `not authorized`, Replace answers `forbidden`. This migration
> re-affirms both helpers at the 0002 global-aware definition
> (`m.cycle_id is null or m.cycle_id = p_cycle`), corrects `memberships_select` so a
> user can always read their OWN rows, and hardens `public.schema_health()` to probe
> the workspace-aware helpers + the self-read policy (so this drift is flagged, not
> passed as ok). Bumps `schema_health()` to `'0024'`. Verify with
> `select public.schema_health();` (expect `ok=true`, `migration='0024'`), then test
> Replace files and Delete on the live app. Engine parity 183/183 unchanged. Roll back
> with `0024_authorization_workspace_scope.rollback.sql`.

> **`0023_ingest_sitting_completeness.sql` — whole-sitting drop guard (task 19).**
> Run AFTER `0021` and `0022`, in the Supabase SQL editor (EU). Idempotent
> (`create or replace` only — no table/column/constraint change). Re-affirms
> `ingest_persist` at the sitting grain and ADDS a bidirectional **sitting-grain**
> roster↔responses check: a sitting present in `responses` but not `result_totals`
> (or vice versa) raises inside the persist transaction (rolls back whole) instead of
> shipping a silently-short cohort. The app-side fix (`normalizeResultId` canonicalises
> the `ResultId` join key so representation skew between the three exports — a trailing
> `.0`, quotes, exponential form — no longer orphans a whole sitting's Items against its
> Assessments roster row) is the primary recovery; this migration is the DB-side net.
> Bumps `public.schema_health()` to report `'0023'`. Verify with
> `select public.schema_health();` (expect `ok=true`, `migration='0023'`). Engine
> parity 183/183 unchanged. Roll back with
> `0023_ingest_sitting_completeness.rollback.sql` (restores the `0022` bodies). After
> applying, delete + re-ingest the `700435` CSVs into a fresh cycle and confirm the
> per-subject counts read **15 / 11 / 12 / 9 / 10**.

> **`0020_restore_ingest_delete.sql` — bring the live DB current (RUN THIS if
> imports fail on `column "item_set" ... does not exist`, or Delete/Clear no-ops).**
> The single, **idempotent** "bring-DB-current" runner: paste it into the Supabase
> SQL editor (EU) and Run. Safe on an out-of-date DB and safe to re-run. It
> `add column if not exists items.item_set` (the fresh-import blocker — migration
> `0010` was authored but never run in this DB), re-affirms `ingest_persist` at its
> current definition (item_set + the `0019` cohort guard), and rebuilds
> `clear_sitting_data` / `delete_sitting` / `reset_cycle_for_reingest` /
> `app.clear_cycle_ingest` to **return the deleted-row count** so the UI confirms
> the op actually removed rows (0 rows / absent function → explicit error, never a
> silent success). `delete_sitting` counts across **every** per-sitting table before
> the cascade. Adds `public.schema_health()` — the app calls it to flag drift itself
> instead of failing at ingest. No destructive drops of user data (return-type
> changes are drop-then-create of FUNCTIONS only; `item_set` is never dropped).
> Engine parity 183/183 unchanged. Verify with `select public.schema_health();`
> (expect `ok=true`). Roll back with `0020_restore_ingest_delete.rollback.sql`
> (restores the void bodies, keeps `item_set`).

> **`0019_ingest_cohort_integrity_guard.sql` — response-attach collapse guard.**
> Task 17 (result-selection / response-attach). Re-creates `public.ingest_persist`
> (identical to `0010` plus one appended check) so a persist whose roster
> (`result_totals`) and cells (`responses`) disagree fails the WHOLE transaction:
> every roster `(assessment, participant)` must carry ≥1 attached response, or the
> ingest raises `dropped-sitter / all-dots response-attach collapse`. This is the
> DB mirror of the app's `#distinct-input == #distinct-output participants`
> invariant, so the 15→7 empty-row collapse can never persist silently. No scoring
> change (engine parity 183/183 unchanged); idempotent (`CREATE OR REPLACE`, same
> signature/grants). Roll back with `0019_ingest_cohort_integrity_guard.rollback.sql`.

> **`0016_incident_adjustments.sql` + `0017_incident_apply.sql` — Incident
> Adjustments.** Prompts 02a/02b. `0016` adds the config registry (`incident_codes`
> / `incident_settings` / `incident_import_mappings`) and parsed `incident_rows`
> (add-only at rest; config writes admin-only; rows key on the P-A internal id).
> `0017` adds `incident_applications` — the per-cycle admin commit flag for the
> apply/review surface. The applied adjustment is a bounded layer ON TOP of base
> scores: neither migration writes incident marks into `participant_scores` /
> `alterations`, so the base path keeps reconciling 1:1 with the raw oracle
> (engine parity 183/183 unchanged). Commit is `app.is_workspace_admin`-only.
> Roll back with `0017_incident_apply.rollback.sql` then
> `0016_incident_adjustments.rollback.sql`.

> **`0018_incident_import_source.sql` — Incident import provenance.** Prompt 14
> (wire the critical-path Incident step to the config). Adds `incident_import_source`
> — one row per cycle recording the imported file name + an `is_sample` flag + who
> imported it / when — so the review surface shows what's loaded and how to replace
> the labelled sample with a real incident log. Written alongside `import_incident_rows`
> (real file) via `set_incident_import_source`; cleared by `clear_incident_import_source`
> (both same cycle role as importing rows: `lead_admin`/`reviewer`). Pure provenance —
> no marks stored, base scores untouched (183/183 parity unchanged). Roll back with
> `0018_incident_import_source.rollback.sql`.

> **`0016` gates audit overrides on the role hierarchy.** Prompt 06. Depends on
> `0012_audit_overrides.sql` (the override RPCs) and `0015_canonical_roles.sql`
> (the `app.can_override` primitive). It adds `app.role_of(cycle, user)` (the
> user's effective, highest-rank role) and redefines `override_item_exclusion` /
> `override_mark_adjustment` to authorise via `app.can_override(actor, subject)` —
> the STRICTLY-higher rule (admin > data analyst > team member) — instead of the
> flat `lead_admin` gate `0012` shipped. The override subject is the role that took
> the original decision (the item's reviewer / the cell's last adjuster), resolved
> server-side; RPC signatures and grants are unchanged. Behaviour-compatible for
> lead_admin over a lower role, additively lets an analyst override a team member,
> and stops an admin overriding a peer admin. Roll back with
> `0016_override_role_hierarchy.rollback.sql` (restores the `0012` flat gate).

> **`0008` persists Clean-stage removals.** The Clean step removes rows
> (participants) and columns (items) from the working set non-destructively — the
> raw `responses`/`items`/`participants` are never touched. `0008` adds the
> `clean_exclusions` table + `set_clean_removal(...)` / `clear_clean_removals(...)`
> RPCs (audited, lead/admin + reviewer only), which the live provider writes and
> replays on hydrate so a removal propagates downstream (raw scores, scoring) and
> survives a reload. Without it, removals still work in-session but reset on
> refresh. Roll back with `0008_clean_exclusions.rollback.sql`.

> **`0007` fixes the 3-CSV ingest.** It re-keys `topic_rollups` onto the topic's
> ID — `unique (cycle_id, qm_result_id, qm_topic_id)` instead of the old
> name-based key, which collided on the FIRST upload (QM has distinct topics
> sharing one display name within a result). It also adds `ingest_persist(...)`
> (the whole upload persists as ONE atomic clear-then-insert — re-uploads replace
> cleanly, a failure rolls back whole), plus `clear_sitting_data(...)` and
> `delete_sitting(...)` for the Upload-screen danger zone (both audited).
> **One-time unblock:** if an earlier failed upload left partial rows, run
> `scripts/wipe-cycle-ingest.sql` (set the cycle id) once to clear them. Roll back
> with `0007_ingest_idempotent_topic_id.rollback.sql`.

> **`0004` is required for the new-cycle flow.** It adds
> `create_cycle_with_assessments(p_name, p_region, p_assessments)`, which the
> live provider calls to persist a new cycle together with its chosen
> assessments and return the new cycle id. Without it, "Create cycle" on the
> live app will error.

> **`0005` introduces the year → sitting structure.** A cycle is now a full
> **year**; within a year are two **sittings** (February and May), and each
> sitting is one `exam_cycles` pipeline run. `0005` adds the `exam_years` table
> plus `exam_cycles.year_id` + `exam_cycles.sitting`, and **maps every existing
> cycle into a year**: it derives the year from a 4-digit year in the cycle name
> (fallback: `created_at` year) and the sitting from the month word in the name
> (Jan–Apr → February, otherwise May), find-or-creates the year, and links the
> cycle. The seeded **"May 2026" cycle becomes the May sitting of a new "2026"
> year.** The change is **additive and reversible** — run
> `supabase/migrations/0005_year_sitting_structure.rollback.sql` to undo it with
> no loss to any 0001–0004 data. **Overall is derived, not stored** (best-of-two
> by award level, per student per subject — the rollup ships in a later prompt).
>
> Apply order, in the SQL editor:
> 1. `0005_year_sitting_structure.sql` — adds the structure and runs the
>    one-time backfill mapping.
> 2. (verify) `select y.name as year, c.name as sitting_cycle, c.sitting
>    from exam_cycles c join exam_years y on y.id = c.year_id order by 1,2;`
> 3. To roll back: `0005_year_sitting_structure.rollback.sql`.

---

## 1. `.env.local`

Copy `.env.example` → `.env.local` and fill in your project values (new key
format — `sb_publishable_…` / `sb_secret_…`):

```bash
cp .env.example .env.local
# then edit:
#   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
#   SUPABASE_SECRET_KEY=sb_secret_…            # server-only, never committed
#   NEXT_PUBLIC_DATA_PROVIDER=supabase         # flip to "memory" for the demo provider
```

`.env.local` is gitignored. The secret key is only read server-side (the engine
write path and the seed script); it is never shipped to the browser.

## 2. Create an auth user (the cycle owner)

Dashboard → **Authentication → Users → Add user** (email + password,
auto-confirm). This is the account you'll sign in as. The seed gives it a
`lead_admin` membership on the seeded cycle automatically.

> Optional: to make this user a **workspace** lead (access to every cycle +
> the workspace config RPCs), add a membership with `cycle_id = NULL`:
> ```sql
> insert into memberships (cycle_id, user_id, role)
> values (null, '<USER_UUID>', 'lead_admin');
> ```

## 3. Seed the database

```bash
npm run seed:supabase
# SEED_OWNER_EMAIL=you@example.com npm run seed:supabase   # pick a specific owner
```

**No-Node alternative (browser only):** paste `supabase/seed.sql` into the SQL
editor and Run. It's a static, fixed-UUID dump of the same demo cycle (genuine
engine-computed `item_stats`/`participant_scores`); the **first** auth user
becomes the owner. Regenerate it with `npm run seed:sql` if the sample data or
engine changes.

Expected output (counts vary with the sample file):

```
Owner: you@example.com (…)
Cleaned 3000 responses.
Cycle <uuid> created.
Inserted 177 items.
Inserted 15 participants.
  responses: 3000/3000
Computed: 177 item stats, 75 participant scores across 5 assessments.
Done. Sign in as you@example.com and open the cycle.
```

## 4. Verify the seed round-trip

**Through the app:**
```bash
npm run dev
```
Open http://localhost:3000 → you're routed to `/signin` (no session) → sign in
with the owner account → the cycle list loads, and opening it shows Review with
real item statistics, Boundaries/Grades computed from the seeded scores, and
Diagnostics. (A user with **no** membership is routed to `/access-denied`.)

**Through SQL** (Dashboard → SQL editor) — confirm the rows landed:
```sql
select
  (select count(*) from exam_cycles)        as cycles,
  (select count(*) from assessments)        as assessments,
  (select count(*) from items)              as items,
  (select count(*) from item_stats)         as item_stats,
  (select count(*) from participants)       as participants,
  (select count(*) from responses)          as responses,
  (select count(*) from participant_scores) as scores;
```

**Through the provider** (optional, Node): the app's `hydrate()` is the
read-back path — opening the cycle in step 4 exercises it end to end.

## 5. Re-run the engine write path (optional)

The seed already wrote `item_stats` + `participant_scores`. To recompute on
demand (e.g. after exclusions/essays/alterations change), POST to the route as a
signed-in lead — the engine runs server-side and writes via the secret client:
```bash
# with a browser session cookie, or from the app; 401/403 if not a lead.
curl -X POST http://localhost:3000/api/cycles/<CYCLE_UUID>/recompute
```

## 6. RLS smoke test

Run in the SQL editor. The editor normally runs as a privileged role that
**bypasses RLS**, so we simulate a signed-in **Reviewer** to prove the
column/table locks hold. Replace the UUIDs first.

```sql
-- pick a cycle + a reviewer user (create one and give it a 'reviewer' membership)
-- insert into memberships (cycle_id,user_id,role) values ('<CYCLE>','<REVIEWER_UUID>','reviewer');

begin;
  set local role authenticated;
  select set_config(
    'request.jwt.claims',
    json_build_object('sub','<REVIEWER_UUID>','role','authenticated')::text,
    true);

  -- (a) reviewer cannot flip a status/computed/decision column directly:
  update exam_cycles set status = 'locked' where id = '<CYCLE>';   -- ERROR: permission denied for column status
  update grades set locked = true where cycle_id = '<CYCLE>';      -- ERROR: permission denied for column locked

  -- (b) responses are immutable (no UPDATE granted to authenticated):
  update responses set answer_score = 0 where cycle_id = '<CYCLE>'; -- ERROR: permission denied

  -- (c) audit_log is append-only (no DELETE granted):
  delete from audit_log where cycle_id = '<CYCLE>';                 -- ERROR: permission denied
rollback;
```

Each statement above must **fail**. (Run them one at a time; the first error
aborts the transaction.) For a positive check, the same reviewer *can* read:
```sql
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object('sub','<REVIEWER_UUID>','role','authenticated')::text, true);
  select count(*) from items;            -- > 0  (member can read)
  -- and the sanctioned decision path works for a reviewer:
  select public.decide_item_exclusion('<ITEM_UUID>', true, 'Negative discrimination');
rollback;
```

A **non-member** sees nothing (invite-only):
```sql
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object('sub','<RANDOM_UUID>','role','authenticated')::text, true);
  select count(*) from exam_cycles;      -- 0
rollback;
```

Confirm the transition functions exist:
```sql
select proname
from pg_proc
where proname in (
  'create_cycle','create_cycle_with_assessments','set_cycle_status','decide_item_exclusion','write_item_stats',
  'lock_grades','unlock_grades','save_grade_scheme','set_import_validation',
  'record_export','write_scores','upsert_essay_marks','clear_essay_marks',
  'insert_incidents','clear_incidents','decide_incident','confirm_distinction_caps',
  'override_distinction_cap','undo_distinction_override','set_document_settings',
  'record_documents','set_workspace_setting')
order by 1;   -- expect all 21
```

---

## Notes / known limitations (v1)

- **Reads** are async-hydrated into the synchronous provider: the cycle shows a
  brief "Loading…" then renders. Writes apply optimistically and persist via the
  SECURITY DEFINER RPCs; the DB rejects anything the user isn't allowed to do.
- **Essays/incidents**: a fresh upload re-hydrates to pick up the new DB ids
  (incident triage maps the inner `inc-N` ids to the DB rows on hydration).
- **Roles/members/config** persist as `workspace_settings` blobs; the config
  blobs (grading defaults, thresholds, retention, branding, safeguard) are
  re-applied on hydration. Member/role *management* still uses the in-memory list
  for the UI — `memberships` remains the source of truth for access.
- **`createCycle`** persists through `create_cycle_with_assessments` (migration
  `0004`): it inserts the cycle + its chosen assessments in one audited call,
  re-hydrates (the new cycle becomes the live one), and returns the real DB id so
  the UI navigates straight to it. The assessment picker is the canonical G12++
  subject catalog (`lib/data/subject-catalog.ts`), so it is populated even before
  any cycle exists.
- **Engine write path** writes `item_stats`/`participant_scores` directly with
  the secret client (the SECURITY DEFINER role-checks need an `auth.uid()`, which
  the secret client doesn't have). This is the sanctioned privileged-writer path.
- Tests/`next build`/typecheck stay green and never touch the DB.
