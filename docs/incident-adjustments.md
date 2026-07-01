# Incident Adjustments — 02a (input / config half)

Systematises the old **"Technical adjustments"** step into a rules-based,
capped, auditable **"Incident adjustments"** subsystem. This is the *input +
configuration* half: the config registry and the import parser. The **apply +
review** half (02b) consumes this config and feeds the existing scoring seam.

## Phase 0 — the existing step, and the mark-application seam

How adjustments work today, and where a mark adjustment actually lands:

- **Entry.** The Adjustments screen (`app/cycles/[cycleId]/adjustments/page.tsx`)
  triages each incident-log / complaint row into a decision via
  `provider.decideIncident(...)`.
- **Storage.** A decision becomes a `+/−` raw-mark row in the **`alterations`**
  table (migration `0003`), applied to one student or a whole subject. Incidents
  themselves live untriaged in `incidents`. Manual Grades-view nudges also write
  `alterations` (migration `0008`, `incident_id IS NULL`).
- **The application seam (preserved, not duplicated).** The engine turns
  `alterations` into marks in **`lib/engine/scores.ts` → `computeScores`**: it
  sums the per-(participant, assessment) alteration marks into `raw`
  (`raw = mcq + essay + alterations`). The server-side caller assembles the
  `alterations[]` input at **`lib/server/engine-write.ts:139–151`** (reading the
  `alterations` table, expanding whole-subject rows across the roster) and passes
  it to `engine.computeScores(...)`.

**02b will produce `alterations` (or an equivalent capped layer) from this
config and feed that same seam** — the engine and the `alterations` table are
untouched here, so the adjustment layer stays *on top of* the parity-locked
engine (parity remains **183/183**).

## What 02a adds

### Pure library (`lib/incidents/`)
- `types.ts` — incident-code / formula / mapping domain types.
- `config.ts` — the registry defaults + validation. Enforces **add-only**
  (no negative grant survives) and **caps**; `classifyIncidentType` buckets an
  incident type to a code (unmatched → unclassified).
- `formula.ts` — formula semantics: `evaluateFormula` (add-only), `evaluateCapped`
  (per-incident ceiling), `capStudentTotal` (per-student global ceiling).
- `section-max.ts` — `% of section` denominator from the **engine's scored
  denominator** (`ParticipantScore.max`), never a naïve sum of raw item maxes;
  `major_element` variant excludes max-0 stimulus + cohort-excluded items.
- `import.ts` — reconfigurable-mapping parser: validates rows, surfaces row-level
  errors, buckets into codes / unclassified (nothing dropped), and resolves
  participants on the **P-A stable internal id**.

### Admin config page
`app/settings/incident-adjustments/page.tsx` (Settings subnav). **Admin-only**
editing via `hasRole(user, 'admin')` (provider `canEdit`); lower roles view
read-only. Edits: incident codes (label / match-types / formula / per-code cap),
the per-student global cap, and the import column mapping.

### Migrations (run order)
Run once in the Supabase SQL editor (EU), **after 0001–0015**:

1. `supabase/migrations/0016_incident_adjustments.sql`
   - `incident_codes`, `incident_settings` (per-student cap),
     `incident_import_mappings` (column mapping), `incident_rows` (parsed rows).
   - Add-only at rest: `CHECK (… >= 0)` + `app.incident_formula_add_only(jsonb)`.
   - Config writes **admin-only** (`app.is_workspace_admin`); importing rows is a
     cycle-role action; RLS + write revokes follow the `0003` pattern.
   - `incident_rows` keys on **`participant_key`** (P-A internal id =
     `participants.qm_participant_id`) and resolves the cohort UUID via that key —
     never the per-ingest `participants.id`. Unmatched rows are kept (surfaced).

   Rollback: `0016_incident_adjustments.rollback.sql`.

## Enforcement summary
- **Add-only:** config validation rejects negatives; DB CHECKs + the formula
  validator reject them at rest; `evaluate*` never returns `< 0`.
- **Per-code cap:** every code carries a `perCodeCap`; `evaluateCapped` clamps.
- **Per-student global cap:** `incident_settings.per_student_cap`; `capStudentTotal`
  clamps (02b enforces at apply time).
- **Admin-gated config:** UI (`canEdit`), provider (`hasRole`), and RPCs
  (`app.is_workspace_admin`).

## Assumed import schema — confirm when the real file arrives
The real incident file isn't available yet; the column mapping is reconfigurable
precisely so these can change with **no code change** (edit them on the config
page). Assumptions made:

- Columns: `Student ID`, `Student Name`, `Incident Type`, `Question Number`,
  `Incident Duration` (the mapping defaults to these headers).
- **`Incident Duration` is a length of time in minutes.** The parser accepts a
  bare number, a number + unit ("15 min"), or `h:mm`/`mm:ss` clock form. If the
  real file uses seconds or start/end timestamps, adjust the parser / mapping.
- **`Student ID` is the participant's stable identity** and matches P-A's internal
  id (the normalised email `qm_participant_id`). If the file carries a *school* id
  instead, we'll need a lookup table; unmatched rows are surfaced (not dropped) so
  a mismatch is visible immediately. Name is a secondary, unique-only fallback.
- Header on row 1, first sheet (SheetJS default). Adjust `readIncidentWorkbook`
  if the real file has a banner/among multiple sheets.
- The canonical calculator rule ships as a default: **+0.5 marks per 5 minutes**,
  capped at 3 marks/incident (`per_duration`, whole-block units). Tune on the page.

---

# Incident Adjustments — 02b (apply engine + per-student review surface)

The **grade-bearing** half: applies the 02a config to parsed incidents, and
presents the result for team sign-off before results finalise.

## Phase 0 — the application seam (re-confirmed)

Base scores come from the parity-locked engine (`lib/engine/scores.ts` →
`computeScores`), persisted to `participant_scores` (assembled server-side in
`lib/server/engine-write.ts`). 02a noted the engine sums the `alterations` table
into `raw` for **human-triage** adjustments.

For the **rules-based incident layer**, the reconcile discipline is decisive:
`reconcile.py` derives ground truth from the raw QM CSVs (no incidents), so the
**base score path must keep reconciling 1:1** and the adjustment layer must not
alter base scores. Accordingly the incident adjustment is applied as a
**separate, stored, admin-committed layer ON TOP of the engine's base scores**,
composed at read time as `adjusted = base + adjustment`. It is **never folded**
into `participant_scores.raw` or written to `alterations`, and the engine is
untouched — parity stays **183/183**. The delta is validated via the review
surface (team sign-off), not via reconcile.

## Auto-apply engine — `lib/incidents/apply.ts` (pure, tested)

`computeStudentAdjustments(rows, codes, perStudentCap, ctx)`:

1. Per incident → `evaluateFormula` (fixed / per-duration / %-of-section), then
   **clamp to the code's per-incident cap** (`evaluateCapped`); flag `perCodeCapHit`.
2. Sum a student's per-code-capped marks, then **clamp the total to the
   per-student global cap** (`capStudentTotal`); flag `perStudentCapHit`.
3. **Add-only**: unmatched / unclassified / errored rows (and rows whose matched
   code was removed / deactivated) grant **zero** and are surfaced — never applied,
   never reduce a score. No path returns `< 0`.
4. The result is **decomposable**: each `StudentIncidentAdjustment` carries its
   per-incident `contributions` + both cap flags, so `base + adjustment` is
   auditable at all times — never a silently merged number.

`%-of-section` uses the **engine scored denominator** via an optional
`sectionMaxFor` resolver; with no resolver it grants nothing (degrade, not guess)
— pending the real file's subject column.

## Per-student review surface

`app/cycles/[cycleId]/adjustments/review/page.tsx` (linked from the Incident
adjustments step). Per student: **base**, **cumulative incident mark change**,
**adjusted total**, the per-incident breakdown (code, matched incident, computed
marks, cap hit), and clear flags where a **per-code** or the **per-student global**
cap was binding. Unmatched incidents are surfaced separately for manual attention.

- **Viewable by all roles** (`getIncidentReview`).
- **Only admin may commit/apply** (`review.canApply` → `hasRole(user,'admin')`);
  application is an **explicit admin action** (`applyIncidentAdjustments`), never
  automatic on import. `unapplyIncidentAdjustments` reverts to base-only.

## Migration (run order)

`supabase/migrations/0017_incident_apply.sql` — **after** the two `0016_*` files.
Adds `incident_applications` (per-cycle admin commit flag + provenance). Commit /
revert are `app.is_workspace_admin`-only SECURITY DEFINER functions that audit the
decision. **No** grade-bearing table is written (base reconciles 1:1). Rollback:
`0017_incident_apply.rollback.sql`.

## Reconcile discipline

With adjustments **un-applied** (the default; or reverted), `participant_scores`
and any Raw / Candidate Scores export are the pure engine base — they match the
raw oracle **cell-for-cell**. The incident delta is a separate layer validated on
the review surface, not through reconcile.
