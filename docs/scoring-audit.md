# Scoring audit — half-weighted essays, full-marks denominator, screen convergence

Status: **resolved**. Reproduced against the seed (`lib/data/seed.generated.json`) +
the parity fixtures (`data/parity_fixtures.json`) using the same engine the app
runs (`lib/engine`); live Supabase is unreachable (egress blocked).

## The decided rule

Score each subject **out of the full marks available, with the essay component
half-weighted**:

```
denominator = MCQ max + (sum of the subject's essay item max) / 2
numerator   = MCQ marks + (essay marks) / 2          (essay marks default to 0)
pct         = numerator / denominator × 100
```

- **Graded items:** 175 MCQ at max 1 across the five G12++ subjects, **plus 4
  essays at max 20** — 2 in G12++ English (ESL) and 2 in G12++ Arabic /
  اللّغة العربيّة (AFL). Essays are marked **offline** (online scores are all 0).
- **Half-weight:** the 2 × 20 = 40 raw essay marks per subject contribute **20**
  (40 / 2). This is why an essay subject reserves 20 in its denominator — that is
  correct, not a bug. A student's essay marks enter the numerator at half their
  raw value (the provider stores them as the per-subject average out of 20, which
  for two essays equals (essay 1 + essay 2) / 2).
- Surveys (max-4 Likert) are dropped at ingest; max-0 stimulus items are excluded
  from the scored max. Neither is graded.

## Worked example — P0010 English

| | numerator | denominator | % |
|---|---|---|---|
| essays unmarked | 36 (MCQ) + 0 | 46 + 20 | **54.55%** |
| perfect essays (40 raw) | 36 + 20 | 46 + 20 | 84.85% |
| partial essays (12 + 16 = 28 raw) | 36 + 14 | 46 + 20 | 75.76% |

The deflated 54.55% when essays are unmarked is the **intended "essay marks
missing" flag**, not an error.

## What was fixed

1. **One data-driven, script-aware essay detector** — `lib/data/essays.ts`
   `isEssaySubject`. Detects from the item data first (any item whose max exceeds
   the dichotomous MCQ 1 is a polytomous/essay item) and falls back to a
   **script-aware** name match that recognises the **Arabic-script** subject name.
   The previous `/arabic|english/i` predicate in the in-memory provider was
   Latin-only (English worked, Arabic silently did not). The three predicates
   (in-memory `essaySubjectIds`, server `engine-write`, and the supabase-hydrate
   classifier) now share one detector / script constant.
2. **Derived half-weighted essay max** — `reservedEssayMax` /
   `ESSAY_MAX_RESERVED` = `(sum of essay item max) / 2`. No hard-coded 20: the
   engine default is 0 and callers pass the derived value, so it stays correct if
   essay counts / maxes change.
3. **Half-weighted essay marks** — the numerator adds the per-subject essay mark
   on the half-weighted /20 scale (40 raw → +20).
4. **One shared computation** — Score (`getComposition`) and Grades (`getGrades`)
   both run through `pctByParticipant` → `engine.computeScores`. The Score screen
   shows 54.55% on P0010 English, equal to Grades. (`getNaiveScores` is **kept**:
   it backs the distinct, clearly-labelled *pre-exclusion "Raw scores"* screen
   — "as submitted, no items dropped" — not a competing final-score path.)
5. **Essays never enter item-stats** — they are dropped at ingest as non-MCQ
   rows, so `computeItemStats` never sees them. Engine parity stays **183/183**.

## Counts — what each one means (reconciled)

Per subject (English shown):

| count | meaning | English |
|---|---|---|
| total items | every item kept after ingest (surveys already dropped) | 60 |
| scored MCQ items | items with max ≥ 1 (the MCQ max) | 46 |
| max-0 stimulus | passage/stimulus items, max 0 — **excluded from the scored max** | 14 |
| survey items | max-4 Likert — **dropped at ingest, excluded entirely** | 0 |
| reserved essay max | half-weighted essay block = (2 × 20) / 2 — **included in the denominator** | 20 |
| subject denominator | scored MCQ max + reserved essay max | 66 |

Reconciliation: `total = scored MCQ + max-0 stimulus` (surveys never reach the
cycle); `denominator = scored MCQ max + reserved essay max`; essays are counted in
the element/denominator reservation but **never** in the MCQ item-stats pipeline.

## Probes

`tests/scoring-reconciliation.test.ts` pins all of the above: the Arabic-script
detection case, the derived essay max, the half-weighting in the numerator, the
Score % == Grades % guard, the P0010 English worked example (54.55%), and the
survey/stimulus/essay exclusions. Engine parity is guarded by
`tests/engine.parity.test.ts` (183/183).

## Out of scope (deferred)

The `pValue` polytomous-normalisation issue is latent (no graded polytomous items
reach item-stats) and is the only change that would touch parity-pinned maths. It
is left for a separate pass and is **not** changed here.
