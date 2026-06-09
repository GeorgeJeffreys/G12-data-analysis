# G12++ Exam Processing Suite — Architecture (backend & engine)

This document summarises what has been built so far: the data model, the
computation engine and its swap point, the validation gates, and exactly what is
stubbed. The source of truth for *intent* is `G12pp_Exam_Suite_Design_Spec.md`;
this document describes the *implementation*.

> **Scope note.** Per the kickoff, only the parts that do **not** depend on the
> visual design are built: the database schema, the computation engine and the
> ingest/export logic. There is one minimal placeholder route (`app/page.tsx`)
> and no other UI. Screens wait on the design mockup.

## Stack

- **Next.js 14 (App Router) + TypeScript (strict)** — see `tsconfig.json`
  (`strict`, `noUncheckedIndexedAccess`).
- **Tailwind** — configured, unused beyond the placeholder.
- **Supabase** (Postgres/Auth/Storage/RLS) — env-var-based clients in
  `lib/supabase/`. No keys committed; see `.env.example`.
- **SheetJS (`xlsx`)** for Excel I/O.
- **Vitest** for tests. `npm test` runs 211 tests, all passing.

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

## What is stubbed / deferred

- **The engine itself is the stub.** It is a faithful TS implementation, kept
  strictly behind `ComputationEngine` so the validated Python can replace it
  with zero caller changes (see the swap point above).
- **No UI** beyond the placeholder route — screens wait on the design mockup.
- **No auth wiring / middleware** beyond the Supabase client factories. Session
  refresh middleware and the actual sign-in screen come with the UI.
- **Server actions / RPC callers** for the transition functions are not written
  yet (they are UI-driven); the database functions they will call exist.
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

## Running things

```bash
npm install
npm test          # 211 tests incl. the 177-item parity gate
npm run typecheck # tsc --noEmit, strict
npm run build     # next build
```

Database: copy `supabase/migrations/0001_init.sql` into the Supabase SQL editor
and run it once (see `supabase/README.md`). No CLI is required.
