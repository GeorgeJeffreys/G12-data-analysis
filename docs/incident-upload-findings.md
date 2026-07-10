# Technical Incident Upload — Phase A findings & decision gate

Discovery for the **Incident Adjustments** upload (ingest the technical-incident
export, match each incident to a real sitting, stage it for the step). No
application code or schema was changed in Phase A. Every claim below is grounded
in a `file:line` reference found by grep.

---

## A1. The engine's Incident Adjustments contract (the critical unknown)

The step already exists and is **wired to a config-driven apply engine** — the
"upload that was never built" is the ingest of the *real technical-incident
export*, not the adjustment machinery.

- **Where the adjustment is produced.** `lib/incidents/apply.ts` →
  `computeStudentAdjustments(rows, codes, perStudentCap, ctx)`
  (`lib/incidents/apply.ts:140`). It turns resolved incident rows into a
  per-student, capped, **add-only** mark adjustment and is a *bounded layer on
  top of* the engine — it never mutates base scores.
- **The engine seam it feeds.** The adjustment is summed into a participant's
  `raw` total via the `alterations` path in the parity-locked engine
  (`lib/engine/scores.ts`), as documented at `lib/incidents/apply.ts:6-9` and
  migration `0016_incident_adjustments.sql:6-9`. `lib/engine/*` is **off-limits**
  and was not touched.
- **Exact input shape the engine consumes, per incident** — a
  `ResolvedIncidentRow` (`lib/incidents/import.ts:143`) whose adjustment-bearing
  fields are:
  - an **enumerated remedy** — a matched `IncidentCode` whose `formula.kind ∈
    { "fixed", "per_duration", "pct_section" }` (`lib/incidents/types.ts:15`,
    `:64-77`). The code is matched from the incident **type string** via
    `classifyIncidentType` (`lib/incidents/config.ts:158`). **This is the remedy
    enum, and it is the field the export cannot supply.**
  - a **magnitude in raw exam marks**, computed by the formula
    (`lib/incidents/formula.ts:27`): `fixed` → flat marks; `per_duration` →
    `marksPerUnit` per `perMinutes` of **duration (minutes)**; `pct_section` →
    `percent` of the engine's **scored section max** (`sectionMax`, resolved via
    `lib/incidents/section-max.ts`). Units are **marks** (never minutes/%
    directly); duration-minutes and section-max are *inputs* to the formula.
  - **no per-question voiding path.** `question_number` is carried
    (`lib/incidents/import.ts:29`) but no formula kind consumes a list of
    affected QM `question_id`s — so an affected-question list is **not** a
    machine input the current engine can act on.
  - caps: a per-code ceiling (`perCodeCap`) and a per-student global cap, both
    add-only (`lib/incidents/formula.ts:58`, `:72`).
- **Source of truth for the step's input.** Persisted records, not manual entry:
  parsed rows live in `incident_rows` (`0016_incident_adjustments.sql:100`), the
  config in `incident_codes` / `incident_settings` / `incident_import_mappings`;
  the per-student capped ledger is **derived at read time** from
  `incident_rows` + config (`getIncidentReview` →
  `computeStudentAdjustments`). The apply/commit flag is `incident_applications`
  (`0017_incident_apply.sql:29`); the imported-file provenance is
  `incident_import_source` (`0018_incident_import_source.sql:28`).

**Note on the existing importer.** The current importer
(`components/incidents/IncidentReviewSurface.tsx:274`,
`lib/incidents/import.ts:76`) reads a **reconfigurable** column mapping
(`studentId, studentName, incidentType, questionNumber, duration`,
`lib/incidents/config.ts:27`) and matches on the internal participant id / name
(`resolveParticipants`, `lib/incidents/import.ts:159`). It assumes a file that
already carries a classifiable **incident-type** column and a duration — i.e. the
*idealised* internal format, not the 20-column technical-incident export. It is
the future **adjudication** path; this prompt builds the ingest that stages the
real export ahead of it.

## A2. Participant / sitting resolution, staff exclusion, subject mapping

- **Cycle scoping is by `cycle_id`, not `ResultFolderName`.** `ResultFolderName`
  exists only as a raw Questionmark export column; no TypeScript reads it. The
  active cycle "G12++ May 2026" is the `exam_cycles` row whose `id` scopes every
  cycle-scoped table. All resolution below is scoped to that `cycle_id`.
- **Email → participant → sitting.** The stable participant key is
  `participants.qm_participant_id`, which **is the lowercased email**
  (`internalParticipantId(naturalKey) = naturalKey.trim().toLowerCase()`,
  `lib/ingest/participant-identity.ts:53`). A sitting is one
  `(cycle_id, qm_result_id)` (`lib/types/database.ts:159`), and
  **`qm_result_id` is `text`, not `bigint`** (`lib/types/database.ts:161`,
  canonicalised by `normalizeResultId`, `lib/ingest/qm/result-id.ts:37`). The
  in-memory model already carries `resultIdByParticipant` (participant →
  `qm_result_id`) per subject (`lib/data/seed-types.ts:107`) and the participant's
  email as `studentId` (`lib/data/build-live-cycle.ts:136-137`), so the reusable
  join is **email → `participants.qm_participant_id` within `cycle_id` → the
  subject's sitting `qm_result_id`**. The existing `import_incident_rows` RPC
  resolves the participant server-side exactly this way
  (`0016_incident_adjustments.sql:251-253`).
- **Staff / non-cohort exclusion.** No hard-coded email any more — it is data in
  `cohort_exclusions` (`0033_cohort_exclusions.sql:34`), keyed on
  `participant_key` = `qm_participant_id` (email). Lavinia is seeded there
  (`0033_cohort_exclusions.sql:110-113`). Read at hydrate
  (`lib/data/supabase-hydrate.ts:374`), mutated via
  `excludeParticipantFromCohort` (`lib/data/provider.ts:447`) /
  `set_cohort_exclusion`. **Reused as the `staff_excluded` bucket source.**
- **Subject name → key.** `classify(rawName)` maps an assessment name to a
  subject code (`AFL/ESL/AM/ST`, or `null` for Life Skills)
  (`lib/data/supabase-hydrate.ts:128`): `/arabic/i → AFL`,
  `/applicable math/i → AM`, `/english/i → ESL`, `/scientific/i → ST`. The
  matcher reuses the same regex rules to map the file's `Subject`
  ("Arabic as a First Language" → AFL, "Applicable Math" → AM) and confirms the
  code exists among the cycle's assessments.

## A3. Provider trio + persistence pattern

- The three providers are `lib/data/provider.ts` (interface),
  `lib/data/in-memory-provider.ts`, `lib/data/supabase-provider.ts`
  (hydrate-replay-delegate: every read/mutation runs on an inner in-memory
  provider first, then a `SECURITY DEFINER` RPC + `rehydrate()`).
- **Essay masterfile upload is the mirror.** Pure parser
  (`lib/data/parse-essay-masterfile.ts`) + pure email-join validation against a
  provider-supplied context (`lib/data/validate-essay-masterfile.ts` +
  `getEssayContext`), then `uploadEssayMarks` persists via a full-cycle-replace
  RPC and `rehydrate()` reloads it (`supabase-provider.ts:714`). In-memory holds
  the state and a `*ForPersistence` bridge; supabase delegates reads to `inner`.
  This upload mirrors that shape (`getExamIncidentMatchContext` →
  `matchExamIncidents` → `upsertExamIncidents`).
- **Migration convention.** `NNNN_snake_case.sql` (+ matching
  `.rollback.sql`); the next free number after the current head (`0043`) is
  **`0044`**.
  Cycle-scoped RLS pattern (copied from `0018_incident_import_source.sql`):
  `enable row level security` → `select` policy `using (app.is_member(cycle_id))`
  → `revoke insert,update,delete ... from authenticated, anon` → all writes via
  `SECURITY DEFINER ... set search_path = public, app` functions that role-check
  (`app.has_role(p_cycle, array['lead_admin','reviewer']::member_role[])`) and
  `app.audit(...)`.

## A4. Upload surface / UX

- The essay upload is **entirely client-side through the provider** (parse +
  validate in the browser, then an RPC via supabase-js) — **no API route, no
  server action** (`components/cycle/EssayMarksCard.tsx`). Its reconciliation
  report renders inline (`ReviewPanel`, same file) as a valid/rejected/flagged
  per-row table with per-bucket counts, and **nothing is written until the
  operator clicks apply**. This upload mirrors that UX on the Incident
  Adjustments step.
- **gzip.** `lib/transport/gzip.ts` (`CompressionStream`, no deps) exists to keep
  the raw-export **POST body** under Vercel's 4.5 MB cap; it is used only by the
  ingest API route (`supabase-provider.ts:497` → `app/api/cycles/[cycleId]/ingest`).
  Like the essay upload, the incident upload **persists via RPC (no POST body)**
  and the export is tiny (tens of rows), so there is no >4.5 MB payload to
  compress — the helper stays reserved for the raw-export path. (See the PR note.)

---

## Decision gate (§3): field → engine-input mapping

| Engine input (A1)                              | Machine-readable in the export? | Source column |
|---|---|---|
| **Remedy enum** (`fixed`/`per_duration`/`pct_section` code) | **NO** | `Action Taken` is free text ("gave the candidate more time"); `Code` (POW, SAN…) classifies the *issue*, not the remedy |
| **Magnitude** (raw marks) | **NO** | derivable only *after* a remedy enum is chosen |
| Duration (minutes) — a formula *input* | yes | `Duration (min)` (authoritative; not recomputed from times) |
| Affected QM `question_id` list | **NO** (empty) | `Questions Affected (list)` is blank in the sample; and no formula kind consumes it |
| Per-code / per-student caps | n/a (config, not file) | — |

**Outcome — STAGED-ONLY (gate not passed).** The engine requires an enumerated
remedy + magnitude per incident, and the export supplies **neither** in
machine-readable form (`Action Taken` is free text; `Questions Affected (list)`
is empty). Per §3 the correct safe outcome is to build everything **except the
engine-adjustment wiring**: ingest, email-scoped matching, and the reconciliation
report are wired; records land in `exam_incidents` with `adjustment_type` /
`adjustment_magnitude` / `adjustment_notes` **nullable and unpopulated**. No mark
is adjusted. A remedy is **never** guessed from `Action Taken`, `Code`, or
`Duration`.

> **BLOCKER:** engine expects an enumerated remedy (`fixed` / `per_duration` /
> `pct_section` incident code) + a magnitude per incident; the export supplies
> none in machine-readable form (`Action Taken` is free text, `Code` classifies
> the issue not the remedy, `Questions Affected (list)` is empty). Adjustment
> wiring is deferred pending (a) an adjudication UI/step that sets remedy +
> magnitude per matched incident, or (b) an enriched export. Records land matched
> and staged; **no marks are adjusted yet.**

## Match buckets (§4.3) — precedence

Each row gets exactly one **report** status. The stored `match_status` is the
substantive bucket; `duplicate` is an upload-relative observation surfaced in the
report (a re-uploaded `Reference` is an *update*, not a new row).

1. `error` (report-only, not persisted) — no `Reference`, or blank `Student
   Email` (both are `NOT NULL` on the table). Surfaced, never fails the batch.
2. `out_of_scope_cycle` — `Exam Cycle` ≠ the active cycle (e.g. the Feb 2026 row).
3. `staff_excluded` — email is on `cohort_exclusions` for the cycle (e.g. Lavinia).
4. `unmatched_subject` — `Subject` maps to no subject code present in the cycle.
5. `matched` — email + subject resolve to a sitting's `qm_result_id` in the cycle.
6. `unmatched_email` — otherwise (email present but no matching sitting in scope).

`duplicate` (report) — `Reference` already staged (prior batch or earlier in this
batch); still upserted. `multiple_incidents` — flag on rows where an
`(email, subject)` pair has >1 matched incident (composition is deferred to the
adjudication/engine step, per §5).
