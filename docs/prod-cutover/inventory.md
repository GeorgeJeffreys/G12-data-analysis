# Prod Cutover — Seed / Mock / Building-Phase Inventory

> **Update (Prompt 02 — executed, rebased onto latest `main`).** The removal plan
> below has been carried out in code on this branch: the `loadSample*` provider
> generators + "Load sample" buttons/badges are hard-removed, `supabase/seed.sql`
> is deleted (which also removes the "first auth user → lead_admin" auto-elevation),
> `KNOWN_TEST_ACCOUNT_EMAILS` is emptied (ingest is as-exported; exclusion is a
> manual Clean action), and dead files are archived.
> The database side ships as **reviewable, not-auto-run** files:
> `supabase/migrations/0045_remove_seeded_cohort_exclusions.sql`,
> `docs/prod-cutover/data-cleanup.sql`, and `docs/prod-cutover/RUNBOOK.md`.
>
> **Analytics/Feb-baseline deferred (by decision):** while this branch was in
> review, `main` merged #93 (a new "Overall analytics" page that *intentionally*
> ships a labelled, reversible synthetic seed) and #94 (essay rework). Per George's
> call, the analytics-specific cutover (removing `mockPriors` / the synthetic
> Overall-analytics seed / the Feb-baseline synthesis) is **not** applied here so
> as not to undo that just-merged work — it is a separate follow-up. `lib/engine/*`
> and the parity fixtures were **not** touched.
>
> The original discovery pass (below) created only this document.
>
> Branch: `claude/prod-cutover-inventory-7yxdma` (cut from `origin/main` @ `c60248b`).
> Date: 2026-07-10. Every claim below cites `path:line`. A zero-hit finding is recorded as such.

---

## Executive summary

- The **entire live/demo cohort in the database is disposable synthetic data**. There is exactly one demo cycle, generated from the de-identified `data/sample_qm_export.xlsx` through the real ingest + engine. It has a **stable, known marker**: cycle id `3385d4a5-b4c2-5331-a7a9-53a03f3f4869` (year id `20260000-0000-4000-8000-000000002026`). A single scoped `DELETE` (cascade) removes it cleanly — see Section D.
- The **role × action permission grid is real bootstrap** and lives in migration `0040_dynamic_roles.sql:27-98`. It must survive to production. (KEEP)
- All the app's scoring/award/reliability reference data (PLD definitions, PLD→award mapping, cut-score guardrails, target-band defaults, α bands) is **code in `lib/engine/*`**, not DB seed — it is KEEP and is explicitly out of scope for this pass.
- **Two expected bootstrap items are ABSENT** and are flagged as potential production blockers:
  1. **Ksenia Klubova admin bootstrap — ZERO hits anywhere in the repo.** There is no seeded first-admin identity. Production admin access depends entirely on "the first `auth.users` row" heuristic in the seed/RUNBOOK.
  2. **Lavinia has no account/role seed.** `lavinia.cavalet@alsamaproject.com` appears **only as a hard-coded staff-exclusion filter** (`0033_cohort_exclusions.sql:104,111`) and in test fixtures — never as a provisioned member/role.
- The user-facing mock/demo affordances are a small, well-labelled set: the analytics **MOCK priors**, the **"Load sample (labelled)"** buttons (essay marks, incident log, technical errors, CGJ, incident rows), and the **February-baseline-synthesized-from-May** fallback on the Overall page. All are REMOVE-CANDIDATE (gate/remove for prod), none are load-bearing for real data.
- **`console.log` count: 14, all in `scripts/*.mts` build/dev tooling — none in `app/`, `components/`, or `lib/` runtime.** Reported only, no action proposed.

---

## Task A — Grep sweep

### A.1 Seed / sample / mock / dummy / faker / INSERT INTO

**`faker` / `@faker-js` / `dummy` / `generateSample` / `sampleData` / `mockData` / `seedData` / `loadSample` (as a string) — ZERO hits.** No faker/dummy generators exist. (The capability is named `loadSample*` on the provider — see below — but the literal token `loadSample`/`load sample` as searched returns the real methods only.)

#### Database seed generators & sources (REMOVE-CANDIDATE / see Task B)
- `supabase/seed.sql:1-3915` — the whole demo cycle as pure SQL (generated). Disposable. **Marker: cycle `3385d4a5-…`.**
- `scripts/build-seed.mts:1-343` — builds `lib/data/seed.generated.json` from `data/sample_qm_export.xlsx`. Dev tooling.
- `scripts/build-seed-sql.mts:1-246` — generates `supabase/seed.sql` (fixed UUIDs). Dev tooling.
- `scripts/seed-supabase.mts:1-103` — inserts the demo cycle into a live Supabase via admin client. Dev tooling.
- `scripts/sample-export.mts:1-108` — one-off SAMPLE draft-export producer for a PR. Dev tooling.
- `scripts/diagnostics-reproduce.mts:19` — reads `data/sample_qm_export.xlsx` for a diagnostics oracle. Dev tooling.
- `lib/data/seed.generated.json` — the in-memory provider's baked seed (binary-large JSON; loaded by the demo/tests). Disposable demo, but **also read by tests** (see DO NOT REMOVE).

#### In-memory demo "Load sample (labelled)" generators — provider (REMOVE-CANDIDATE)
- `lib/data/in-memory-provider.ts:2901` — `loadSampleTechnicalErrors()` — 6 synthetic technical-fault incidents (`sample_technical_errors.csv`).
- `lib/data/in-memory-provider.ts:3058` — `loadSampleEssayMarks()` — 10 students × 2 essay subjects, deterministic marks (`sample_essay_marks.xlsx`).
- `lib/data/in-memory-provider.ts:3272` — `loadSampleIncidentLog()` — 5 synthetic incident/complaint rows (`sample_incident_log.xlsx`).
- `lib/data/in-memory-provider.ts:3395` — `loadSampleCgj()` — sample centre-grade-judgement expectations off real grades (`sample_centre_expectations.xlsx`).
- `lib/data/in-memory-provider.ts:5139` — `loadSampleIncidentRows()` — 3 synthetic resolved incident rows.
- Interface + Supabase pass-through (non-persisting): `lib/data/provider.ts:470,483,489,507,593`; `lib/data/supabase-provider.ts:699,726-728,755,772,1004` (each notes "Sample/demo data is not persisted to the live database").

#### In-memory demo MOCK analytics/priors (REMOVE-CANDIDATE)
- `lib/data/mock-admin.ts:36-128` — `mockPriors()`, `mockCompareSubjects()`, `ANALYTICS_CYCLE_*` — deterministic illustrative prior-cycle figures. (File also defines the *real* quality thresholds at `:29-34` and empty real-roster helpers at `:18-26` — those are KEEP; see below.)
- `scripts/build-seed.mts:334-336` — three `mock:true` prior sittings (`jan-2026`, `nov-2025`, `may-2025`) baked into the generated seed.

#### The three "MOCK" analytics surfaces (UI — REMOVE-CANDIDATE / gate)
- `components/ui/analytics.tsx:208-215` — `MockBanner` ("Prior sittings are illustrative mock data…").
- `app/analytics/page.tsx:6,15,81,87` — MOCK PRIOR labelling + banner.
- `app/analytics/compare/page.tsx:11-12,21,117,144,158` — MOCK labels + banner on Compare.
- `components/ui/compare.tsx:21,258,300,506` — `mock` opacity styling for prior columns.
- Supporting model flags (KEEP as types; drive the honest labels): `lib/data/types.ts:95,130,150-151,191,205-206,1508-1538,1603-1604` etc.

#### "SAMPLE" upload badges in the UI (REMOVE-CANDIDATE / gate — the buttons)
- `app/cycles/[cycleId]/cgj/page.tsx:200,206,222-225` — "Load sample (labelled)" + SAMPLE badge.
- `app/cycles/[cycleId]/adjustments/manual/page.tsx:101,120,149,155-163` — "Load sample" incident log.
- `components/cycle/EssayMarksCard.tsx:180-206` — "Load sample" essay marks + SAMPLE badge.
- `components/incidents/IncidentReviewSurface.tsx:83-95,255-307` — "Load sample" incident rows + SAMPLE badge + replace-prompt.

#### February-baseline demo synthesis (REMOVE-CANDIDATE / gate)
- `lib/data/in-memory-provider.ts:2326,2483-2520` — the Overall's February baseline is **synthesized from the May cohort** when Supabase is unreachable (draft/preview only).
- `app/years/[yearId]/overall/page.tsx:187` — user-facing copy explaining the synthesized February baseline.

#### Benign / not-seed hits (informational, NOT actioned)
- `INSERT INTO` matches inside migration **function bodies** (RPCs such as `ingest_persist`) and inside **migration tests** (`tests/migration.*.test.ts`) are engine/RPC logic and test assertions, not disposable seed rows.
- "Beta" in `lib/ingest/qm/*` (`model.ts:8,50,117`, `canonical.ts:371`, `ingest-write.ts:197`) is the Questionmark **QuestionStatus** attribute (informational, never filtered) — not building-phase.
- "sample" throughout `data/sample_qm_export.xlsx` references is the **de-identified fixture** name (dual-use: seed source + test fixture).

### A.2 Building-phase / dev commentary

- `coming soon` / `under construction` / `not implemented` / `work in progress` / `WIP` / `FIXME` / `HACK` / `XXX` in `app|components|lib|scripts` (excl. `lib/engine/*`): **ZERO hits.**
- `TODO` in runtime code (excl. `lib/engine/*`): **1 hit** — `lib/data/provider.ts:323` ("Create a centre. Lead/Admin only (TODO P3: admin-only)."). Doc-comment note; not a dev banner. (AMBIGUOUS — see Task C.)
- `placeholder`: all hits are **benign** — empty-state UI (`app/cycles/[cycleId]/boundaries/page.tsx:205,348-349`, `app/cycles/[cycleId]/page.tsx` SSR placeholder), input attributes (24× `placeholder=` in `.tsx`), or "provisional policy default" copy (`app/settings/config/page.tsx:103` "±2% is a placeholder until G12 confirms"; `lib/incidents/config.ts:61` "placeholder pending G12 policy"). No dev-only placeholder UI.
- `debug`: **ZERO hits** in `app|components|lib` runtime.
- `beta` / `staging` / `internal only` / `dev only` / `dev-only`: no dev banners; only the Questionmark "Beta" data attribute noted above.
- `demo`: pervasive but **descriptive** — refers to the in-memory demo provider / demo seed throughout `lib/data/*` and `ARCHITECTURE.md`. Not building-phase copy to remove; it labels the demo data path.

### A.3 `console.log` occurrences (count only — NOT actioned)

**Total: 14 — every one in `scripts/*.mts`** (`seed-supabase.mts` ×6, `diagnostics-reproduce.mts` ×5, `build-seed-sql.mts` ×1, `sample-export.mts` ×1, `build-seed.mts` ×1). **Zero in `app/`, `components/`, `lib/` runtime.** No action proposed.

---

## Task B — DB seed source inventory (READ, not run)

| Source | Writes to | Rows (approx) | Verdict |
|---|---|---|---|
| `supabase/seed.sql` (`:1-3915`) | `exam_years`, `exam_cycles`, `memberships`, `assessments`, `participants`, `items`, `responses`, `item_stats`, `score_runs`, `participant_scores`, `grade_schemes` | 1 year, 1 cycle, 1 membership, 5 assessments, ~16 participants, hundreds of items, thousands of responses (3915 lines total) | **Disposable demo.** Pure-SQL dump of one synthetic cycle from `sample_qm_export.xlsx`. Fixed UUIDs; header itself documents the delete-to-reseed path. **Marker: cycle `3385d4a5-…`.** |
| `scripts/build-seed.mts` | (file) `lib/data/seed.generated.json` | — | Dev tooling. Regenerates the in-memory demo seed. Not a DB writer. |
| `scripts/build-seed-sql.mts` | (file) `supabase/seed.sql` | — | Dev tooling. Regenerates `seed.sql`. Not a DB writer. |
| `scripts/seed-supabase.mts` | live Supabase: cycle/assessments/items/participants/responses + engine-computed `item_stats`,`participant_scores` | one cycle per run (NOT idempotent — re-running inserts another) | Dev tooling. **Inserts disposable demo data into a live DB.** Should not be run against production. |
| `scripts/sample-export.mts` | none (writes a `.zip` file) | — | One-off SAMPLE draft-export producer. |
| `supabase/migrations/0040_dynamic_roles.sql:27-98` | `roles`, `role_actions` | 3 roles + ~40 grants | **Essential bootstrap (KEEP).** The role × action permission grid. |
| `supabase/migrations/0036_role_permissions.sql:119` | `role_permissions` (upsert RPC body) | via RPC | Superseded permission layer (0041 drops `role_permissions`/`permissions`/`role_grants`). Structural, not disposable seed. KEEP (migration history). |
| `supabase/migrations/0039_configurable_permissions.sql` / `0041_action_gates.sql` | `permissions`, `role_grants` (created then dropped by 0041) | — | Migration history — RPC/table plumbing, **not** disposable cohort seed. KEEP. |
| `supabase/migrations/0001_init.sql:624` | `grade_schemes` | inside `upsert` RPC body | Not seed data — a definer function. KEEP (structural). |
| `supabase/migrations/0034_remove_mock_workspace_settings.sql` / `0038_drop_orphaned_roles_setting.sql` | `delete from workspace_settings …` | — | **Already-authored cleanup** of prior mock settings. KEEP (forward-only history; do not revert). |
| Other `insert into responses/result_totals/…` across migrations | — | — | Inside RPC function bodies (`ingest_persist` etc.) or migration tests. **Not disposable seed.** KEEP. |

**Source-of-truth data file:** `data/sample_qm_export.xlsx` (1.3 MB, de-identified) feeds *all* seed generation **and** the ingest/parity tests (`tests/fixtures.ts` → `tests/ingest.ts:19-21`). It is **dual-use** — disposable as a seed source but **required by the suite** (see DO NOT REMOVE).

---

## Task C — Categorisation

### KEEP — essential bootstrap / reference data (must survive to production)

| Item | Location | Present? |
|---|---|---|
| **Role × action permission grid** (3 roles + granted actions) | `supabase/migrations/0040_dynamic_roles.sql:27-98` | ✅ Yes |
| Enforcement primitive `app.can_do` | `supabase/migrations/0040_dynamic_roles.sql:136-147` | ✅ Yes |
| Real member roster helpers (start empty; fill from `list_members` RPC) | `lib/data/mock-admin.ts:18-26` | ✅ Yes (empty by design) |
| Real item-quality rating thresholds (display) | `lib/data/mock-admin.ts:29-34` | ✅ Yes |
| **Five subjects / PLD definitions** (performance levels + award levels) | `lib/engine/config.ts:103-116` (`DEFAULT_SCORING_CONFIG`) | ✅ Yes (code, not DB) |
| **PLD → award mapping** (Layer-2 rule) | `lib/engine/award.ts:104-149` (`deriveAward`) | ✅ Yes (code) |
| **Cut-score guardrail defaults** | `lib/engine/cut-scores.ts:33` (`POLICY_GUARDRAILS`), `:44` (`POLICY_BAND_RANGES`) | ✅ Yes (code) |
| **Target-band distribution defaults** | `lib/engine/cut-scores.ts:49` (`DEFAULT_POLICY_TARGETS` → [15,20,50]) | ✅ Yes (code) |
| **Reliability α bands / thresholds** | `lib/engine/reliability.ts:32` (`LOW_ITEMS_THRESHOLD=5`), `:34` (`SMALL_SAMPLE_THRESHOLD=30`), `:36-` (`ReliabilityLevel`) | ✅ Yes (code) |
| Incident-adjustment safe defaults | `lib/incidents/config.ts:37-67` (`DEFAULT_PER_STUDENT_CAP=5`) | ✅ Yes (code) |
| Prior mock-settings cleanup migrations (forward-only) | `0034_…sql`, `0038_…sql` | ✅ Yes |

> ⚠️ **KEEP-item absences (flagged as possible production blockers):**
> - **Ksenia Klubova admin bootstrap: NOT FOUND (zero hits, whole repo).** No seeded first-admin identity exists. Admin access is conferred only by "first `auth.users` row → `lead_admin`" in `supabase/seed.sql:7-8,24-25` and the RUNBOOK. Production needs a deliberate first-admin provisioning step (or a real bootstrap row) — this does not exist today.
> - **Lavinia account/role: NOT FOUND as a member/role.** `lavinia.cavalet@alsamaproject.com` exists **only** as a hard-coded cohort-exclusion filter (`supabase/migrations/0033_cohort_exclusions.sql:104,111`) and as test-fixture pseudonyms. If Lavinia is meant to be a provisioned production user, that seed is missing.

*(All `lib/engine/*` items are KEEP **and** out of scope for removal this pass — not touched, listed for confirmation only.)*

### DO NOT REMOVE — test fixtures (parity suite depends on them)

Removing any of these breaks the suite (parity/oracle harnesses).

- `data/parity_fixtures.json` — engine parity oracle (`lib/engine/stats.ts:7`, `tests/fixtures.ts:50`; 177/177 parity — `lib/engine/config.ts:26`).
- `data/sample_qm_export.xlsx` — ingest/parity source (`tests/fixtures.ts` → `tests/ingest.ts:2-3,19-21`). Dual-use; **must stay for tests.**
- `lib/data/seed.generated.json` — read by `tests/routing-year-id.test.ts:13`, `tests/incidents.test.ts:8`, `tests/essay-marks.test.ts:9`, `tests/diagnostics.notebook.test.ts`, `tests/grading.distinction.test.ts`, etc. Disposable as demo, **required by tests.**
- `tests/fixtures/` tree — `oracles/` (`oracle_rosters.csv`, `oracle_applicable_math_matrix.csv`), `essays/`, `qm/`, `qm-attribution/`, `qm-collide/`.
- `reconcile.py:1-` — the raw-data reconciliation gate over the committed oracles (staff excluded).
- `tests/helpers/mock-supabase-read.ts`, `tests/helpers/mock-rpc-admin.ts` and all `vi.mock(...)` usage — test doubles, not app mocks.
- All `tests/**/*.test.ts` sample/mock/`seedWith`/`twoCentreSeed`/`loadSample*` references — fixtures and assertions (e.g. `tests/essay-marks.test.ts:54-59`, `tests/incidents.step-wiring.test.ts:104-107`, `tests/member-directory.test.ts:136-139` which asserts mock accounts are **gone**).

### REMOVE-CANDIDATE — disposable demo / synthetic / building-phase (for a later PR/SQL)

**Database (data rows):**
- The entire demo cycle in `supabase/seed.sql` — cycle `3385d4a5-b4c2-5331-a7a9-53a03f3f4869` and everything it cascades to.

**Code (demo affordances — gate behind a dev flag or remove for prod):**
- Provider sample generators: `lib/data/in-memory-provider.ts:2901,3058,3272,3395,5139` (+ interface/pass-throughs in `provider.ts`, `supabase-provider.ts`).
- MOCK analytics/priors: `lib/data/mock-admin.ts:36-128`; `scripts/build-seed.mts:334-336`.
- "MOCK" analytics UI: `app/analytics/page.tsx`, `app/analytics/compare/page.tsx`, `components/ui/analytics.tsx:208-215`, `components/ui/compare.tsx` mock styling.
- "Load sample (labelled)" buttons/badges: `app/cycles/[cycleId]/cgj/page.tsx:206`, `app/cycles/[cycleId]/adjustments/manual/page.tsx:149`, `components/cycle/EssayMarksCard.tsx:206`, `components/incidents/IncidentReviewSurface.tsx:261,307`.
- February-baseline synthesis: `lib/data/in-memory-provider.ts:2326,2483-2520`; copy at `app/years/[yearId]/overall/page.tsx:187`.

**Dev-only scripts (keep in repo, but never run against prod):**
- `scripts/seed-supabase.mts`, `scripts/build-seed.mts`, `scripts/build-seed-sql.mts`, `scripts/sample-export.mts`, `scripts/diagnostics-reproduce.mts`, `scripts/wipe-cycle-ingest.sql`, `scripts/diagnose-participant-collapse.sql`.

### AMBIGUOUS — human (George) decides

- **Root-level design prototypes** `hf.jsx`, `hfA.jsx`, `hfB.jsx`, `hfBoundaries.jsx`, `hfDiag.jsx` (repo root) — **not imported anywhere** (grep for imports: zero hits). Look like leftover design scratch files distinct from the referenced `design/*.jsx`. Not seed/mock; likely deletable, but out of this pass's strict scope — George to confirm.
- `design/` tree (`*.jsx`, `*.html`, screenshots) — the source-of-truth design references that `components/ui/*` cite in comments (e.g. `components/ui/primitives.tsx:3`). Probably KEEP as design reference; confirm.
- Root screenshots `Screenshot 2026-06-09 at *.png` (×3) — repo-root artifacts; keep or move.
- `lib/data/provider.ts:323` — `TODO P3: admin-only` on `createTestCentre`. A latent authz tightening, not building-phase copy. Decide whether P3 is in-scope for prod.
- `app/settings/config/page.tsx:103` "±2% is a placeholder until G12 confirms the policy value" & `lib/incidents/config.ts:61-62` default cap "placeholder pending G12 policy" — **provisional real defaults**, not mock data. Keep unless George has the confirmed policy values to hardcode.

---

## Task D — Proposed removal plan (PROPOSAL ONLY — nothing executed)

### D.1 Code (for a later PR)

Ordered, REMOVE-CANDIDATE only. **No edits performed now.** Recommended approach: **gate, don't hard-delete**, so the demo path survives for local dev/tests while being unreachable in production. A single `DEMO_MODE`/`NEXT_PUBLIC_DEMO` flag (off in prod) gating the provider methods + UI buttons is the lowest-risk surgical option.

1. **Gate the "Load sample" UI buttons** (make them render only when demo flag on):
   - `components/cycle/EssayMarksCard.tsx:206`
   - `app/cycles/[cycleId]/adjustments/manual/page.tsx:149`
   - `app/cycles/[cycleId]/cgj/page.tsx:206`
   - `components/incidents/IncidentReviewSurface.tsx:261,307`
2. **Gate/stub the provider sample generators** (return early unless demo flag on) — `lib/data/in-memory-provider.ts:2901,3058,3272,3395,5139`. Leave the interface signatures (`lib/data/provider.ts`) intact so the Supabase provider's non-persisting pass-throughs still compile.
3. **Gate the MOCK analytics priors** — decide whether Analytics/Compare should render at all with no real history, or show an honest empty state instead of `mockPriors()`/`mockCompareSubjects()` (`lib/data/mock-admin.ts:36-128`, `app/analytics/*`).
4. **Gate the February-baseline synthesis** — `lib/data/in-memory-provider.ts:2483-2520`; with real two-sitting data this path is never needed.
5. **Leave `scripts/*seed*` and `lib/data/seed.generated.json` in place** (tests depend on the generated seed). Just ensure `seed-supabase.mts` is never wired into a prod deploy step.

> The exact gating mechanism (env flag name, empty-state vs. hidden) is a design decision — **do not implement without George's sign-off on the approach.**

### D.2 Database (for a later SQL file George runs in Supabase — text only, do NOT run)

**A reliable marker EXISTS.** The disposable demo data is one cycle with a fixed UUID, and every child row is FK-linked to it (cascade). No `is_seed` flag exists, and none is needed — the cycle id is the marker.

- **Primary marker:** `exam_cycles.id = '3385d4a5-b4c2-5331-a7a9-53a03f3f4869'` (the "May 2026" demo cycle).
- **Secondary marker:** `exam_years.id = '20260000-0000-4000-8000-000000002026'` (the demo "2026" year).
- Both are documented as fixed in `supabase/seed.sql:12-14,18-25` and `scripts/build-seed-sql.mts:52`.

**Proposed statements (TEXT ONLY — for George to review and run manually; not committed as a runnable migration):**

```sql
-- Demo-cohort teardown. REVIEW before running. Deletes the single synthetic cycle
-- and everything cascading from it. Run inside a transaction; verify counts first.
begin;

-- 0. Inspect first (do NOT delete blind):
select id, name, status, created_at from exam_cycles
  where id = '3385d4a5-b4c2-5331-a7a9-53a03f3f4869';

-- 1. Remove the demo cycle (cascades to assessments/participants/items/responses/
--    item_stats/score_runs/participant_scores/grade_schemes/memberships-for-cycle):
delete from exam_cycles where id = '3385d4a5-b4c2-5331-a7a9-53a03f3f4869';

-- 2. Remove the demo year IF no real cycle references it:
delete from exam_years where id = '20260000-0000-4000-8000-000000002026'
  and not exists (select 1 from exam_cycles c where c.year_id = '20260000-0000-4000-8000-000000002026');

commit;
```

**Caveats to resolve before running:**
- **`memberships`:** the seed grants the first `auth.users` row a `lead_admin` membership on the demo cycle (`supabase/seed.sql:24-25`). The cascade removes that cycle-scoped membership — but confirm the real admin has a **workspace-scoped** membership (NULL `cycle_id`) so they are not locked out after teardown. **This ties directly to the missing Ksenia bootstrap above.**
- **Roles/permissions are NOT touched** — `roles`/`role_actions` (0040) carry no cycle id and are pure bootstrap. Do not include them in any delete.
- **`workspace_settings`:** already cleaned by migrations `0034`/`0038`; no demo rows expected. Verify none remain before assuming clean.
- If a live sitting was **re-ingested onto the same fixed UUID** at any point, the marker would also match real data. **Verify the cycle really is the untouched demo** (name "May 2026", `created_by` = seed owner, no real sign-off) before deleting.

**Recommendation:** because the only "real vs demo" discriminator in the DB is *this one known UUID*, and because production admin bootstrap is currently undefined, the **safest cutover path is a fresh production database** (apply migrations `0001–0042`, **do not** run `seed.sql`/`seed-supabase.mts`, then provision the first real admin) rather than in-place deletion from a DB that already mixes demo and real rows. In-place `DELETE` is viable **only** if you can confirm no real data was ever written under the demo UUIDs.

---

## Exit confirmation

- ✅ **Nothing deleted.** Only `docs/prod-cutover/inventory.md` created.
- ✅ **No SQL run.** No migration/seed executed against any database.
- ✅ **`lib/engine/*` untouched.** Referenced read-only for KEEP confirmation.
- ✅ **Test/parity suite unmodified.** Fixtures catalogued under DO NOT REMOVE.
- ⚠️ **Flagged blockers:** missing Ksenia Klubova admin bootstrap (zero hits); Lavinia present only as an exclusion filter; the only DB demo/real discriminator is a single fixed cycle UUID.
