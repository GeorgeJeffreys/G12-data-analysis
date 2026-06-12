# Supabase provider — verification runbook

This is the **provider built blind** (no DB access from the build environment).
Run these steps from your own machine to seed the database and verify the
round-trip, RLS, and the privileged transitions. Everything is reversible.

Prereqs: migrations `0001`, `0002`, **and `0003`** applied in the Supabase SQL
editor (run `supabase/migrations/0003_adjustments_essays_config.sql` if you
haven't), and Node ≥ 20.

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
  'create_cycle','set_cycle_status','decide_item_exclusion','write_item_stats',
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
- **`createCycle`** returns a local id and fires `create_cycle`; the full async
  new-cycle flow (navigating to the DB-returned id) is a follow-up. The seeded
  demo cycle is the primary path.
- **Engine write path** writes `item_stats`/`participant_scores` directly with
  the secret client (the SECURITY DEFINER role-checks need an `auth.uid()`, which
  the secret client doesn't have). This is the sanctioned privileged-writer path.
- Tests/`next build`/typecheck stay green and never touch the DB.
