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

| # | Screen | Route |
| - | --- | --- |
| 01 | Cycles dashboard | `/` |
| 02 | Cycle overview | `/cycles/[cycleId]` |
| 03 | Ingest & validate | `/cycles/[cycleId]/ingest` |
| 04 | Item review & scoring (hero) | `/cycles/[cycleId]/review/[assessmentId]` |
| 05 | Scoring & grade boundaries | `/cycles/[cycleId]/boundaries` |
| 06 | Grades & sign-off | `/cycles/[cycleId]/grades` |

Shared shell (`components/shell/`): nav rail, top bar, and the pipeline stepper
shown on every cycle screen. Design system (`components/ui/`): buttons, chips,
KPI/stat blocks, quality bars, status marks, dense tables, and the recharts
histogram + breakdown bars — all ported from `design/hf.jsx`.

### What is mocked in the UI (honestly labelled)

- **No Supabase / no persistence.** Exclusions, boundaries and locks live in the
  in-memory provider and **reset on reload**.
- **Auth / roles.** A current user is mocked with the Lead role
  (`InMemoryDataProvider.user`, marked `// MOCK:`). Role-gated controls (Lock is
  Lead-only) read from it so real auth slots in later.
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
