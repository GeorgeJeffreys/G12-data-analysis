# Production Cutover — Runbook

The ordered steps to take this PR to production. **Migrations run BEFORE the merge**
so the live schema never drifts from `main`. Destructive steps are reviewable files,
never auto-run. Nothing here has been executed for you.

> Environment: Supabase EU (single project — clean in place, **not** a fresh
> project). App on Vercel. Run SQL as the **service role** in the Supabase SQL
> editor so RLS does not block the deletes.

---

## 0. Pre-flight

- Confirm you can sign in to the app at least once as George — this creates his
  `auth.users` row, which `data-cleanup.sql` requires (it fails loudly otherwise).
- Note George's **login email** (the one on his `auth.users` row). You will paste
  it into `data-cleanup.sql`.
- Optional but recommended: take a Supabase backup / snapshot before step 2.

## 1. Review the PR

- Read the code diff (sample/mock removal, analytics live-only, ingest-as-is).
- Read the two SQL deliverables in `docs/prod-cutover/`:
  `data-cleanup.sql` and this runbook.
- Read the new migration(s) under `supabase/migrations/`:
  - **`0045_remove_seeded_cohort_exclusions.sql`** — removes migration 0033's
    seeded identity-based staff/test exclusions (the rows with no human decider),
    keeping the `cohort_exclusions` table + `set_cohort_exclusion` RPC intact.

  There is **no migration for admin auto-elevation**: the old "first `auth.users`
  row → `lead_admin`" behaviour lived only in `supabase/seed.sql`, which this PR
  deletes. No trigger on `auth.users` ever existed, so nothing else to remove.

## 2. Apply the new migration(s) — BEFORE merging

In the Supabase SQL editor, run the forward migration(s) added in this PR, in
order (only `0043` is new here):

```
supabase/migrations/0045_remove_seeded_cohort_exclusions.sql
```

Confirm it completes cleanly (it is idempotent — safe to re-run).

## 3. Run the data cutover — `docs/prod-cutover/data-cleanup.sql`

1. Open `docs/prod-cutover/data-cleanup.sql`.
2. **Edit the placeholder**: replace every `:'george_email'` (3 occurrences) with
   George's login email in single quotes, e.g. `'george@alsamaproject.com'`.
3. Run it as the **service role**. It runs in ONE transaction and prints:
   - `BEFORE` / `BEFORE-keep` counts,
   - the deletes,
   - `AFTER` counts (every exam/data table should be **0**),
   - `AFTER-keep` counts (roles / role_actions / auth.users / workspace
     memberships should be **unchanged**),
   - `GEORGE-ADMIN` — exactly one row showing George with `role_name = Admin`,
     `enum_role = lead_admin`.
4. **Lockout guard — do not continue past this step until you have SEEN the
   `GEORGE-ADMIN` row.** If it is missing (e.g. George never signed in), the
   script will have raised an error and rolled back; fix and re-run.
5. To preview without committing, change the final `commit;` to `rollback;`,
   run, inspect the counts, then switch back to `commit;` and run for real.

> Note — `test_centres` is **preserved** (it is workspace config, not exam data).
> If a demo centre row (e.g. "Alsama Shatila 1") exists and you want a clean
> centre list, delete synthetic centres by hand in the app or SQL editor after
> cutover — it is not touched here.
>
> Note — the Overall-analytics visualisation seed from `0043_overall_analytics_seed.sql`
> (the `seed-ov-` "△ Sample" centres/cycles) IS exam-cycle data, so `delete from
> exam_cycles` removes those synthetic cycles too. Their `seed-ov-` **test centres**
> remain (test_centres is preserved) but hold no cycles. If you want the Overall
> analytics page populated again for a demo, re-run `0043_overall_analytics_seed.sql`
> after cutover; otherwise delete the leftover `seed-ov-` centres by hand.

## 4. Merge the PR

Once migration 0045 is applied and `data-cleanup.sql` has confirmed George is a
`lead_admin` and the exam data is gone, merge this PR into `main`.

## 5. Redeploy (Vercel)

Trigger a production redeploy from the merged `main`.

## 6. Smoke test (as George)

- Sign in → land in the app as an admin (Users & access is reachable).
- **Create another admin**: Settings › Users & access → invite a user (or change
  an existing member's role) → set their role to **Admin**. Confirm it sticks.
- Confirm **no sample/mock affordances** anywhere:
  - No "Load sample (labelled)" buttons on Essay marks / Incident log / Incident
    review / CGJ.
  - Analytics › Trends and Compare show only the real current sitting with an
    honest "no prior sittings yet" note — no MOCK banners or invented priors.
  - The year Overall shows the real sitting only (no "Demo February sitting").
- Confirm **ingest is as-exported**: upload a full Questionmark export and verify
  every row is present at ingest (staff/test rows included) — nothing is
  auto-excluded. Removing rows/columns happens in the **Clean** step as a manual
  human action (via "Remove from all subjects" / row removal), not before it.

---

## Rollback notes

- `0043` is forward-only; its `.rollback.sql` is an intentional no-op (restoring
  the seeded identity exclusions would re-introduce hard-coded PII, which the
  cutover removes on purpose).
- `data-cleanup.sql` is destructive and **not reversible** without a backup —
  that is why step 0 recommends a snapshot and step 3 offers a `rollback;`
  dry-run first.
