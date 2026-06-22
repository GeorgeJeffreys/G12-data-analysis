# Supabase provider — verification runbook

This is the **provider built blind** (no DB access from the build environment).
Run these steps from your own machine to seed the database and verify the
round-trip, RLS, and the privileged transitions. Everything is reversible.

Prereqs: migrations `0001`–`0008` applied in the Supabase SQL editor (run any you
haven't, in order — `0003_adjustments_essays_config.sql`,
`0004_create_cycle_with_assessments.sql`, `0005_year_sitting_structure.sql`,
`0006_qm_3csv_model.sql`, `0007_ingest_idempotent_topic_id.sql`,
`0008_clean_exclusions.sql`), and Node ≥ 20.

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
