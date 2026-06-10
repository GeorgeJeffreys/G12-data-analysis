# G12++ Exam Processing Suite — Architecture (backend & engine)

This document summarises what has been built so far: the data model, the
computation engine and its swap point, the validation gates, and exactly what is
stubbed. The source of truth for *intent* is `G12pp_Exam_Suite_Design_Spec.md`;
this document describes the *implementation*.

> **Scope note.** The backend (schema, parity-verified engine, ingest/export)
> and the **six-screen front end** are both built. The UI runs entirely against
> an in-memory `DataProvider` seeded from real engine output — **no Supabase,
> no live database** yet (see "Frontend (UI)" below).

## Stack

- **Next.js 14 (App Router) + TypeScript (strict)** — see `tsconfig.json`
  (`strict`, `noUncheckedIndexedAccess`).
- **Tailwind** + ported design-system CSS (`app/globals.css`) and tokens
  (`lib/ui/tokens.ts`). Fonts via `next/font`: **Sofia Sans** (UI), **IBM Plex
  Mono** (data), **Yellowtail** (the script “A” mark) — matching the Claude
  Design hi-fi in `design/`.
- **recharts** for the score-distribution histogram and breakdown charts.
- **Supabase** (Postgres/Auth/Storage/RLS) — env-var-based clients in
  `lib/supabase/`. Not yet wired to the UI. No keys committed; see `.env.example`.
- **SheetJS (`xlsx`) / `xlsx-js-style`** for Excel I/O.
- **Vitest** for tests. `npm test` runs 214 tests, all passing.

## Repository layout

```
app/                      Placeholder home route + layout (no styled UI)
lib/
  supabase/               Browser + server Supabase clients (RLS-bound)
  types/database.ts       Hand-written strict types mirroring the schema
  engine/                 Computation engine (Section 8 interface)
  ingest/                 Questionmark parse → clean → validate
  export/                 SheetJS workbook builders
supabase/
  migrations/0001_init.sql  Schema, RLS, column grants, SECURITY DEFINER fns
  README.md               How to run the migration in the SQL editor
data/                     De-identified fixtures (parity + sample export)
tests/                    Vitest suites (parity is the trust gate)
```

## Database schema & security model

`supabase/migrations/0001_init.sql` implements the Section 5 model:
`exam_cycles, memberships, assessments, items, item_stats, participants,
responses, item_reviews, score_runs, participant_scores, grade_schemes, grades,
import_batches, audit_log`. Status fields use Postgres **enums**.

Non-negotiable security model (Sections 3 & 5), all enforced in the database:

- **RLS is enabled on every table.** Read access = members of the cycle; write
  access is role-gated through `memberships` (`lead_admin`, `reviewer`,
  `viewer`).
- **Status / computed / decision columns are never client-writable.** This is
  enforced with column-level `REVOKE`/`GRANT`: clients receive `UPDATE` only on
  the specific editable columns, never on `exam_cycles.status`,
  `assessments.status`, `items.status`, any of `item_stats`,
  `participant_scores`, `grades.locked` / `signed_off_*`,
  `score_runs.computed_at`, or `import_batches.validation_passed`. Those change
  **only** through `SECURITY DEFINER` functions, which run as the table owner
  and bypass the column grants.
- **`responses` are immutable after ingest** — insert-only; `UPDATE`/`DELETE`
  are revoked and no policy permits them.
- **`audit_log` is append-only** and written exclusively by the definer
  functions; `INSERT`/`UPDATE`/`DELETE` are revoked from clients.
- **Every privileged transition writes an audit row** — exclusions
  (`decide_item_exclusion`), boundary changes (`save_grade_scheme`), grade
  lock/unlock (`lock_grades`/`unlock_grades`), exports (`record_export`),
  status changes and `write_item_stats` all call the internal `app.audit(...)`.

The transition RPCs (`public.*`, callable by `authenticated`, each enforcing its
own role check):

| Function | Purpose |
| --- | --- |
| `create_cycle` | Create a cycle and make the creator its `lead_admin`. |
| `set_cycle_status` / `set_assessment_status` | Move status enums (lead only). |
| `decide_item_exclusion` | Record human gate 1 + flip `items.status` + audit. |
| `write_item_stats` | Engine writes `item_stats`, tagged with `engine_version`. |
| `save_grade_scheme` | Save boundaries + audit the change. |
| `lock_grades` / `unlock_grades` | Sign-off lock; unlock requires a reason. |
| `set_import_validation` | Mark `validation_passed` + advance status. |
| `record_export` | Audit an export. |

Types in `lib/types/database.ts` are hand-written to match, with `Insert`/
`Update` shapes that omit protected columns (the real guarantee is in the DB).

## Computation engine (Section 8) and its swap point

The engine lives behind a single interface, `ComputationEngine`
(`lib/engine/index.ts`):

```ts
interface ComputationEngine {
  readonly version: string;
  ingestAndClean(rawExport): { cleanedResponses, validationReport };
  computeItemStats({ responses, items? }): ItemStat[];
  computeScores(responses, excludedItemIds): ParticipantScore[];
  rollUp({ participantScores, responses, items, excludedItemIds? }): RollUp;
}
```

- The active implementation is `TypeScriptEngine`, a transparent TS port. Every
  result is tagged with `ENGINE_VERSION` (`ts-engine-0.1.0`).
- **Swap point:** callers depend only on the interface and the domain types in
  `lib/engine/types.ts`. To drop in the validated Python later: implement the
  interface against the Python service, bump `ENGINE_VERSION`, and return it from
  `getEngine()`. **No caller, route, table or test signature changes — only
  `lib/engine/index.ts`.** The parity test must pass against the new engine
  before it is trusted in production.

### The maths (verified)

For dichotomous (0/1) items, grouped per assessment:

- **p-value** = mean item score.
- **item-total** (corrected) = Pearson(item score, total of the *other* items).
- **point-biserial** = Pearson(item score, full total incl. the item).
- **discrimination** = mean(upper group) − mean(lower group), where the groups
  are the top/bottom `g = round(n/3)` participants ranked by the corrected
  (item-excluded) total **descending, ties broken by the full total
  descending**. (The tie-break by full total is what reproduces the published
  values exactly; it is principled — among equal rest-totals, the participant
  who got *this* item right ranks higher.)
- A correlation with zero variance (undefined) is stored as `null` and rated
  **Flag**.
- **Ratings** (computed on full precision, values rounded to 3 dp for display):
  - p-value: `<0.20` Flag · `<0.30` Review · `≤0.85` Good · `≤0.90` Review · else Flag.
  - item-total / point-biserial / discrimination: undefined→Flag · `<0.10` Flag · `<0.30` Review · else Good.
  - overall = worst of the four (Flag > Review > Good).

### Parity (the trust gate)

`tests/engine.parity.test.ts` feeds each assessment's de-identified responses
from `data/parity_fixtures.json` through the engine and asserts it reproduces the
data scientist's published p-value, item-total, point-biserial and discrimination
for **all 177 items across the five assessments** within rounding tolerance, with
ratings and overall review matching exactly. `computeScores` is separately
checked for self-consistency against the raw response matrix.

## Ingest + validation (Sections 5 & 10)

`lib/ingest/` parses a Questionmark export (xlsx/csv via SheetJS) and:

- **repairs mojibake** — the Arabic arrives as UTF-8 bytes mis-decoded as
  CP1252; `repair.ts` reverses the CP1252 mapping and re-decodes as UTF-8,
  leaving ASCII and already-correct text untouched (`repairText`).
- **filters to Multiple Choice** only and **drops survey assessments**.
- **parses demand level** (`D1/D2/D3`) from the `MetaTags` field
  (`Demand Level==Dx||…`).
- **derives major/sub element** from the backslash-delimited
  `QuestionTopicPath`.
- assigns each participant a **sequential pseudonym** so downstream data carries
  no PII.
- tolerates the historical **Remove-column variants** (`Remove Item?`,
  `Remove item?`, `Remove?`, `Column1`) via `normalizeRemoveColumnHeader`.

`validate.ts` runs the Section 10 gates and returns a structured pass/warn/fail
report (`passed` is false on any hard-fail):

| Gate (`id`) | Checks |
| --- | --- |
| `schema` | Required Questionmark columns present. |
| `encoding` | No residual mojibake after repair. |
| `no_leak` | No survey / non-MCQ rows in the analysis set. |
| `demand_tag` | Every retained item has a D1/D2/D3 tag. |
| `result_status` | Every participant has a result status. |
| `duplicates` | No duplicate participant/item responses. |
| `reconciliation` | Per-participant item counts reconcile (warn-level). |

`tests/ingest.test.ts` runs the whole pipeline against the de-identified
`data/sample_qm_export.xlsx` (`in` sheet).

## Excel export (Section 9)

`lib/export/` builds three workbooks. Generation uses **`xlsx-js-style`** (a
drop-in SheetJS fork) so cell fills are written; the upstream community `xlsx`
build silently drops styles on write. Import/parsing still uses `xlsx`.

- **Item Analysis** — reconciled to the exact `MCQ_Item_Analysis` layout:
  - a **`README & Summary`** sheet (title, purpose, then one row per assessment
    with participant/item/row counts, the discrimination group size,
    Good/Review/Flag tallies and median statistics — header exported as
    `ITEM_ANALYSIS_SUMMARY_HEADERS`);
  - one sheet **per assessment** with row 1 title, row 2 meta
    (`Participants | Items | Rows analysed | Upper/Lower group size`), row 3
    reading guide, two blank rows, the **20-column header on row 6**
    (`ITEM_ANALYSIS_HEADERS`, including a **single** `Remove Item?` /
    `Reason for removing item` pair), then one row per item from row 7.
  - The five rating columns (P-Value, Item-Total, Point-Biserial, Discrimination
    ratings and Overall Item Review) carry **green/amber/red fills** per
    Good/Review/Flag (`RATING_STYLES`).
  - `assembleItemAnalysis(...)` joins engine `ItemStat[]` with response-level
    facts to derive Presented/Answered counts and average response time, and the
    per-assessment participant/row counts and group size.
- **Overall Score Analysis** — a `Scores` sheet (raw + % per assessment and
  overall) and a `Summary` sheet (per-assessment means + distribution).
- **Grades** — a `Grades` sheet (section + overall grades) and a `Distribution`
  sheet.

`workbookToBuffer` serialises for download/storage. `tests/export.test.ts`
asserts the exact layout, the README & Summary sheet, the rating fills, average
response time from the real sample export, and xlsx round-trip.

## Frontend (UI) and the DataProvider

The six-screen flow is built against a single repository abstraction, the
**`DataProvider`** (`lib/data/provider.ts`) — the same discipline as the engine.
Components import only this interface and the read-model types in
`lib/data/types.ts`; they never touch the engine, ingest, export or Supabase
directly.

### Swap point

`InMemoryDataProvider` (`lib/data/in-memory-provider.ts`) seeds itself from
**genuine engine output** and keeps decisions (exclusions, boundaries, locks) in
memory. To go live: implement `DataProvider` backed by Supabase (queries + the
`SECURITY DEFINER` RPCs from migration 0001) and construct it in
`lib/data/context.tsx` instead of the in-memory one — **no screen or component
changes**.

### Seeding with real data

`scripts/build-seed.mts` (run via `npm run seed`) runs the **real ingest +
engine** over `data/sample_qm_export.xlsx` and writes `lib/data/seed.generated.json`
(5 assessments, 193 items, 18 participants). The provider ships that to the
client and recomputes scores / distributions / grades **through the engine** on
every exclusion, boundary drag and lock — so the item-review KPIs, the live
histogram, the boundary band counts and the grade matrix are all real computed
numbers, not hand-typed mocks. Reactivity is via `useSyncExternalStore`
(`lib/data/context.tsx`).

### Screens (routes)

The left nav rail splits into three areas — **Cycles**, **Analytics**,
**Settings** — each with a secondary tab bar (subnav). Entry screens sit outside
the shell.

| Area | Screen | Route |
| --- | --- | --- |
| Entry | Sign-in (mocked Microsoft) | `/signin` |
| Entry | Access denied | `/access-denied` |
| Cycles | Cycles dashboard | `/` |
| Cycles | New cycle | `/cycles/new` |
| Cycles | Cycle overview (Pipeline) | `/cycles/[cycleId]` |
| Cycles | Ingest & validate | `/cycles/[cycleId]/ingest` |
| Cycles | Item review & scoring (hero) | `/cycles/[cycleId]/review/[assessmentId]` |
| Cycles | Scoring & grade boundaries | `/cycles/[cycleId]/boundaries` |
| Cycles | Grades & sign-off | `/cycles/[cycleId]/grades` |
| Cycles | Audit log | `/cycles/[cycleId]/audit` |
| Cycles | Certificates / documents | `/cycles/[cycleId]/documents` |
| Analytics | Trends | `/analytics` |
| Analytics | Compare cycles | `/analytics/compare` |
| Settings | Users & access | `/settings/users` |
| Settings | Roles & permissions | `/settings/roles` |
| Settings | Configuration | `/settings/config` |

Shared shell (`components/shell/`): three-area nav rail, top bar, the secondary
subnav (`lib/ui/subnav.ts`) and the pipeline stepper on cycle screens. Design
system (`components/ui/`): buttons, chips, KPI/stat blocks, quality bars, status
marks + badges, avatars, toggles/checkboxes, dense tables, recharts histogram +
breakdown bars, and the analytics sparkline / stacked-award column — all ported
from the batch-1 and batch-2 design (`design/hf*.jsx`).

### Admin, audit & analytics (provider-backed, mostly MOCK)

- **Users & access / Roles & permissions** read-models + mutations live in the
  provider (`getMembers`, `getRoles`, `inviteMember`, `setMemberRole`,
  `removeMember`, `createRole`, `renameRole`, `setCapability`). Defaults: a **G12
  Lead** (full) and a **Data Scientist** (everything except sign-off/admin/create)
  with a capability matrix; the mocked signed-in user is the Lead. All mock —
  no directory.
- **Audit log** (`getAuditLog`): every consequential action — exclusions,
  boundary edits, lock/unlock, exports, document generation, duplicate
  resolution, new cycle — writes an entry via the provider's internal `audit(...)`.
  A few seeded entries (flagged `seeded`/"example") populate the list before any
  session action.
- **Analytics** (`getAnalyticsTrends` / `getAnalyticsCompare`): the **live
  cycle's aggregates are REAL** (computed from the engine — participants, cohort
  mean/median/σ, items excluded, mean item quality, award distribution,
  per-assessment means); **prior cycles are clearly-labelled MOCK** (a "MOCK
  PRIORS" banner + tags), since there's no real cross-cycle history.
- **Configuration** (`getConfig`): the item-quality thresholds shown are the
  engine's **real active rating rules** (display-only — editing them needs an
  engine change); the grade-vocabulary defaults editor is real and editable;
  data-retention and branding are mock per-workspace settings.
- **New cycle** (`createCycle`): records the intent in the audit log and returns
  the live cycle (no DB) — clearly labelled mock.

### Grade vocabulary (the real named levels)

The A–E placeholder from the batch-1 screens is replaced everywhere by the
production vocabulary (`lib/data/grading.ts`), and the schemes are generalised so
nothing hardcodes band names or counts:

- **Per-assessment performance level** (best → lowest): *Outstanding
  performance*, *Exceeds expectations*, *Meets expectations*, *Doesn't yet meet
  expectations* — **four bands → three cut-points**. Star mapping for reports:
  `***` / `**` / `*` / `` (blank).
- **Overall award** (best → lowest): *Distinction award*, *Advanced achievement
  award*, *Secondary achievement award*, *No Award* — a **separate four-band
  classification** with its own cut-points.
- A grading scheme is `{ levels[], cuts[] }` where `cuts[i]` is the minimum score
  for `levels[i]` and the lowest level is the remainder. `BoundaryModel`
  carries `levels`, a `cuts` array and `isAward`; `GradesModel` carries
  per-assessment `{ level, stars }` cells plus the overall `award`.
- **Labels, star mapping and default cut-points are configurable** in Settings →
  Grading defaults (`getGradingDefaults` / `setGradingDefaults`).
- **`// CONFIRM:` the overall-award derivation rule is a placeholder** — the real
  rule isn't in the source files. The default classifies the overall score into
  the four awards by configurable cut-point; the Settings screen surfaces this as
  an "Unverified rule" warning. Confirm with the assessment team before go-live.

### What is mocked in the UI (honestly labelled)

- **No Supabase / no persistence.** Exclusions, boundaries and locks live in the
  in-memory provider and **reset on reload**.
- **Auth / roles.** Sign-in (`/signin`, "Sign in with Microsoft") and the
  access-denied state are mocked — no real OAuth; sign-in goes straight in. The
  current user is the mocked **G12 Lead** (Rana Mansour, `InMemoryDataProvider.user`);
  members, roles and the capability matrix are mock fixtures
  (`lib/data/mock-admin.ts`). Role-gated controls read from this so real Microsoft
  Entra auth slots in later.
- **Admin areas.** Members/roles/audit/analytics/config and the new-cycle action
  are all mock (in-memory) — see "Admin, audit & analytics" above. Analytics
  priors and the data-retention/branding config are labelled `MOCK`; only the
  live cycle's analytics and the engine's quality thresholds are real.
- **Prior cycles + cross-cycle comparisons.** There is only one real cycle. Prior
  cycles are clearly-labelled `MOCK` rows; the "vs Jan 2026" boundary comparison
  is driven by a labelled fixture behind a `SHOW_CROSS_CYCLE` flag and tagged
  `MOCK` in the UI — no delta is computed against invented numbers as if real.
- **Duplicate-resolution** is detected by the real validator; the resolution
  action is a provider **stub** (records the choice, no row mutation). The sample
  export has no duplicates, so the panel doesn't appear on the live cycle.
- **"Start new cycle"** is a no-op (needs the database).
- **Quality index** (the 0–100 bar in item review) is a transparent composite of
  the four engine ratings (`scripts/build-seed.mts` `qualityIndex`), not a
  fabricated statistic.

## Document generation (certificates & reports) and its swap point

Per-student PDFs are generated from PowerPoint templates once grades are locked.
The UI depends only on the **`DocumentGenerator`** interface
(`lib/documents/generator.ts`) and the types in `lib/documents/types.ts` — never
on the Python renderer or LibreOffice directly.

- **Student Summary, not a spreadsheet.** `getDocuments(cycleId)` builds the
  Student Summary (name, `RESULTID` = ParticipantID, overall award, the five
  performance levels + stars) from the **locked-grades read-model**. It is empty
  until the cycle is locked. Subjects are mapped to the template's fixed
  **S1..S5 slots by an explicit alias** (S1 Applicable Math, S2 Scientific
  Thinking, S3 Arabic 1st, S4 English 2nd, S5 Life Success Skills) — by keyword,
  **not by position**, because the template order differs from the suite's.
- **Tokens.** Certificate: `{{NAME}}`, `{{AWARD}}`, `{{RESULTID}}`. Report:
  `{{NAME}}`, `{{S1..S5_LEVEL}}`/`{{S1..S5_STARS}}`, `{{RESULTID}}`. `{{RESULTID}}`
  **replaces the certificate's baked-in fixed ID**, and test centre / exam date /
  issue date are **per-cycle settings** (`setDocumentSettings`); the renderer
  normalises those baked/placeholder values to tokens before filling. Stars are
  derived from the level, never entered.
- **Dev implementation:** `HttpDocumentGenerator` POSTs the Student Summary +
  uploaded template(s) to `POST /api/documents/generate` (Node runtime), which
  shells out to `scripts/doc_gen.py` (adapted from the reference `gen.py`):
  python-pptx fill → LibreOffice (`soffice --convert-to pdf`) → one zip per type.
  Artifacts stream back through `GET /api/documents/download` (path-guarded).
  Verified end-to-end against both real templates and the seeded cycle —
  18 students × 2 docs = 36 PDFs, with the alias mapping and Result-ID
  replacement confirmed in the rendered output.
- **Fonts:** Barlow is fetched; **Georgia Pro Condensed** (certificate name line)
  is proprietary and detected-as-absent — the UI warns that a substitute will be
  used and surfaces the "embed fonts in the template" guidance.
- **Swap point / deployment:** **do not render in a Vercel serverless function** —
  LibreOffice is too heavy. Production implements the same `DocumentGenerator`
  against a **dedicated Python worker** (queue + object storage for artifacts);
  only `lib/documents/generator.ts` changes. This sits alongside the Supabase
  swap as the two production follow-ons.

## What is stubbed / deferred (backend)

- **The engine itself is the stub.** It is a faithful TS implementation, kept
  strictly behind `ComputationEngine` so the validated Python can replace it
  with zero caller changes (see the swap point above).
- **No auth wiring / middleware** beyond the Supabase client factories, and the
  Supabase-backed `DataProvider` is not written yet (the in-memory one stands in).
- **Server actions / RPC callers** for the transition functions are not written
  yet; the database functions they will call exist.
- **Certificates, essay marking, cross-cycle analytics, multi-workspace** —
  out of MVP scope (Section 7), and the schema is designed not to need rework.

## Divergences from the spec (and why)

1. **`rollUp` signature.** Section 8 sketches `rollUp(participantScores)`, but
   the by-major-element and by-demand-level breakdowns need item-level scores
   and item metadata that participant totals do not carry. `rollUp` therefore
   also takes `responses` and `items`. Same boundary, slightly richer input.
2. **Discrimination tie-break.** The spec says "ranked by total score excluding
   the item"; it does not specify tie handling. Reproducing the published
   numbers required breaking ties by the full total descending. This is
   documented in `lib/engine/stats.ts` and is the only detail beyond the spec's
   wording needed for exact parity.
3. **SheetJS source + styled writer.** The spec's CDN tarball for `xlsx` is
   blocked by the environment's network policy, so reading uses the public npm
   registry build (`xlsx@0.18.5`). The community build cannot *write* cell
   styles, so the colour-coded item-analysis fills are generated with
   `xlsx-js-style` — a drop-in SheetJS fork with the identical `XLSX.utils` API.
4. **Item-analysis layout** is reconciled to the exact `MCQ_Item_Analysis` file
   (20-column header, title/meta/guide preamble, README & Summary sheet, rating
   fills). The `MCQ_Overall_Score_Analysis` and grades workbooks still use a
   sensible canonical layout to be reconciled against their real templates when
   available.
5. **Demand-tag gate severity.** The "every item has a demand-level tag" gate is
   classified as a **warning** (fixable, evidence-for-review), not a hard fail —
   matching the design's treatment (hard-fail is reserved for duplicates /
   schema / encoding / survey leakage) and keeping a clean sample export
   validating so the seeded cycle is coherent. Behaviour only; the ingest
   interface is unchanged.

## Running things

```bash
npm install
npm run dev       # the app (in-memory provider, real engine)
npm run seed      # regenerate lib/data/seed.generated.json from the sample export
npm test          # 214 tests incl. the 177-item parity gate
npm run typecheck # tsc --noEmit, strict
npm run build     # next build
```

Database: copy `supabase/migrations/0001_init.sql` into the Supabase SQL editor
and run it once (see `supabase/README.md`). No CLI is required.
