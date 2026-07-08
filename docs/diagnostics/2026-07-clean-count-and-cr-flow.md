# Diagnostic — Clean-tab question count (41 vs 40) & constructed-response / essay flow

**Date:** 2026-07-08
**Type:** Read-only investigation. No behavioural code changed; `lib/engine/*`, scoring
logic and migrations untouched.
**Scope proven:** Full test suite **1169 passed / 130 files** at start and at end
(the "183/183" parity figure in the brief refers to the scoring-engine parity
subset; the suite as a whole is 1169, unchanged by this diagnostic). Only file
added is this document.

> **TL;DR.** The "41" and the "40" are two different quantities computed from two
> different rules over the **same** item set. **41** = the count of *distinct
> items* (`a.items.length`). **40** = the *scored denominator*, which drops any
> item whose `maxScore` is 0. Applicable Math has exactly **40 items at
> `maxScore: 1` and 1 item at `maxScore: 0`** — the 41st item is the
> `maxScore: 0` **"Welcome to the G12++ Applicable Maths section"** instruction
> page (`QuestionType = "Multiple Choice"`, `QuestionMaximumScore = 0`,
> `AnswerScore = 0`). It is **not** an essay. The reduction is **automatic and
> structural** (driven by `maxScore === 0`), not a user "clean" and not a dropped
> column. The **actual constructed-response essays** (`QuestionType = "Essay"`,
> max 20) are a *separate*, earlier silent drop at ingest, and already re-enter
> scoring through a dedicated half-weighted `essayMarks` layer — not through the
> response store.

---

## 1. Root cause of 41 vs 40

There is no single line where "41 becomes 40". They are **two independent
derivations** over the same per-subject item list `a.items`:

### The 41 — distinct-item count (`a.items.length`)

The item count shown across the app is the length of the subject's item list:

| Surface | Field | Citation |
|---|---|---|
| **Clean** tab → "Items" metric | `raw.items` | `app/cycles/[cycleId]/clean/page.tsx:399` (`{ label: "Items", value: raw.items }`) |
| `getRawData` builds `raw.items` | `a.items.length` | `lib/data/in-memory-provider.ts:1296` |
| **Question Review** KPI "items" | `a.items.length` | `lib/data/in-memory-provider.ts:1790` |
| **Raw Scores** `totalItems` | `a.items.length` | `lib/data/in-memory-provider.ts:1717` |

`a.items` is the list of **distinct `qmQuestionId`s that appear in the cleaned
responses**, built once in `lib/data/build-live-cycle.ts:146-161` (the
`itemMetaMap`, first-occurrence per question id) and mapped to `SeedItem[]` at
`lib/data/build-live-cycle.ts:187-211`. Each item carries
`maxScore: m.maxScore ?? 1` (`build-live-cycle.ts:196`). **All 41 items —
including the `maxScore: 0` one — are counted here**, because the item is
genuinely present in the response matrix (17 students were "presented" it and
"answered" it; it just scores 0).

### The 40 — scored denominator (max-0 items removed)

The "out of 40" a student is marked against is computed by two paths that agree:

**(a) Raw Scores page — a simple count of scored items.**
```
lib/data/in-memory-provider.ts:1680   const scoredItems = cleanItems.filter((it) => (it.maxScore ?? 1) >= 1);
lib/data/in-memory-provider.ts:1681   const mcqMax = scoredItems.length;
...
lib/data/in-memory-provider.ts:1716   mcqItems: mcqMax,
lib/data/in-memory-provider.ts:1717   totalItems: a.items.length,
```
The denominator is displayed at `app/cycles/[cycleId]/raw-scores/page.tsx:160`
(`{s.raw} / {model.mcqItems}`). **The max-0 item is filtered out at line
1680**, so `mcqMax = 40` while `totalItems = 41`.

**(b) Engine scored path (Score / Grades / Summary) — a sum of `maxScore`.**
`lib/engine/scores.ts:65-82` builds the cohort denominator as the **sum of
`maxScore` over the distinct retained items that appear in the responses**:
```
lib/engine/scores.ts:78   for (const [aid, set] of retainedItemsByAssessment) {
lib/engine/scores.ts:79     let m = 0;
lib/engine/scores.ts:80     for (const id of set) m += maxByItem.get(id) ?? 1;
lib/engine/scores.ts:81     mcqMaxByAssessment.set(aid, m);
```
The max-0 item **is** in `retainedItemsByAssessment` (it is in the responses and
not user-excluded), but it contributes `maxByItem.get(id) === 0` to the sum
(`itemMetasFor` passes its real `maxScore` of 0 — `lib/data/in-memory-provider.ts:692-701`,
called at `:679`). So the engine denominator is also **40**.

Both mechanisms therefore land on 40 for Applicable Math: the 40 scored items each
have `maxScore 1`, and the single unscored item has `maxScore 0`.

### Is the reduction silent/automatic or config-driven?

**Automatic and structural — not config-driven, not a "clean".** No user action
and no flag is involved; the item is dropped from the denominator purely because
`maxScore === 0` in the Questionmark export. It is **partially disclosed** but only
on one screen: `app/cycles/[cycleId]/raw-scores/page.tsx:104` prints *"...(showing
40 scored MCQ items of 41)"* when `mcqItems !== totalItems`. **The Clean tab shows
a bare "Items: 41"** with no note that one of them is unscored — this mismatch,
seen next to a `/40` mark elsewhere, is exactly what prompted the report.

---

## 2. Is it the essay item?

**No — for Applicable Math the 41st item is a `maxScore: 0` instruction / welcome
page, not a constructed-response essay.** Math carries no essay at all.

### Empirical confirmation (from `data/sample_qm_export.xlsx` and the seed)

Per-subject item counts in `lib/data/seed.generated.json` (verified by script):

| Subject | Items | `maxScore` distribution |
|---|---|---|
| **Applicable Math** | **41** | **40 × `1`, 1 × `0`** |
| English 2nd Lang | 60 | 46 × `1`, 14 × `0` |
| Scientific | 36 | 35 × `1`, 1 × `0` |
| Arabic 1st Lang | 31 | 30 × `1`, 1 × `0` |
| Life Skills | 25 | 24 × `1`, 1 × `0` |

Every subject carries ≥1 `maxScore: 0` item. The Applicable-Math max-0 item is:

```
id=100002785249  major=None  demand=D1
wording="Welcome to the G12++ Applicable Maths section Here, you can show how confident you are ..."
```
and in the raw export its row is `QuestionType = "Multiple Choice"`,
`QuestionMaximumScore = 0`, `QuestionStatus = "Normal"`, `AnswerScore = 0`. The
other subjects' max-0 items are the same species — welcome pages, section
intros, listening-comprehension **audio "item-set home pages"** (shared stimulus),
practice questions ("*This is a practice ... It will not count to your final
mark.*"), and end-of-exam checks ("*Have you answered all questions in this
exam?*"). These are **MC-typed, zero-mark presentation items**, not essays.

### How the three CSVs represent a non-auto-marked item

`QuestionType` in the export takes these values (row counts from
`data/sample_qm_export.xlsx`): `Multiple Choice` 3346, **`Essay` 306**, `Likert`
847, `Explanation` 59, `Yes No` 69, `Pull Down List` 32. Two distinct kinds of
"not auto-marked" item exist:

1. **Constructed-response / essay** — `QuestionType = "Essay"`,
   `QuestionMaximumScore = 20` (e.g. the G12++ English essays: *"Topic: Moving
   countries can be difficult..."*). Questionmark records **no auto `AnswerScore`**;
   these are marked offline out of 20.
2. **Zero-mark MC presentation items** — `QuestionType = "Multiple Choice"`,
   `QuestionMaximumScore = 0` (welcome pages, stimulus/audio home pages, practice
   items). Auto-marked to 0 by design.

### How each currently flows

- **Essays (kind 1) are dropped entirely at ingest**, before any item count.
  `lib/ingest/normalize.ts:191-194` drops every row whose `questionType !==
  "Multiple Choice"` (incrementing `droppedNonMcqRows`). This is the single source
  of truth noted in `lib/data/essays.ts:24` ("*Essays are dropped at ingest as
  non-MCQ rows (`lib/ingest/normalize.ts`)*"). Consequently **essays never appear
  in `a.items`** and are in neither the 41 nor the 40.
- **Zero-mark MC items (kind 2) survive ingest** (they *are* `"Multiple Choice"`),
  land in `a.items` → **counted in the 41**, but score 0 and carry `maxScore 0` →
  **excluded from the 40 denominator**. This is the item behind 41 vs 40.

So the 41st item is an **unscored MC presentation item**, which is grade-neutral
today (it adds 0 to both numerator and denominator). The essays are a *different*
concern handled on a separate path (§3, §5c).

---

## 3. The response → score data path

Canonical keys: participant = P-A internal id / pseudonym (`participantPseudonym`,
email-derived); sitting = numeric QM `ResultId` (`qmResultId`); response key =
`(qm_result_id, question_id)` i.e. `(r.qmResultId, r.qmQuestionId)`.

```
Questionmark CSVs (Items · Assessments · Topics)
  │  3-CSV path: lib/ingest/qm/bridge.ts  (join Items→Assessments on canonical ResultId)
  ▼
lib/ingest/normalize.ts :183-222   normalizeResponses → CleanResponse[]
  • :187 drop survey assessments            (droppedSurveyRows)
  • :191 drop QuestionType != "Multiple Choice"  (droppedNonMcqRows)  ← essays vanish here
  • :216 maxScore = QuestionMaximumScore, default 1  ← the 0 is carried through as-is
  ▼
lib/data/build-live-cycle.ts :140-278   buildLiveCycleData
  • :146-161 itemMetaMap  → distinct (qmQuestionId) items, carrying maxScore
  • :163-168 responses    → ResponseRecord { participantId, itemId, assessmentId, score }
  • :187-211 SeedItem[]   → a.items (the 41)
  ▼
lib/data/in-memory-provider.ts  (the runtime store)
  • responsesOf(a)                 :649-663  responses minus cleaned/cohort-excluded participants
  • excludedSet(cycleId, aid)      :590-599  item-review exclusions ∪ Clean-stage removed columns
  • itemMetasFor(a)                :692-701  ItemMeta[] carrying each item's real maxScore (incl 0)
  • pctByParticipant → computeScores  :670-682   ← per-student total + max
  ▼
lib/engine/scores.ts :47-123   computeScores            [OFF-LIMITS — lib/engine/*]
  • :65-82  mcqMax = Σ maxScore over retained items      → 40
  • :84-96  per (participant, assessment) mcq = Σ score
  • :98,105 essay = Σ essayMarks (SEPARATE array), half-weighted
  • :108    max = mcqMax + (hasEssay ? essayMax : 0)
  • :118    pct = raw / max * 100
  ▼
Raw Scores page uses the simpler count path: getNaiveScores :1656-1722
  mcqItems = count(maxScore ≥ 1) = 40  ·  totalItems = a.items.length = 41
  displayed at app/cycles/[cycleId]/raw-scores/page.tsx:160 ( raw / mcqItems )
```

**Modules on the path, with off-limits ones marked:**

| Module | Role | `lib/engine/*`? |
|---|---|---|
| `lib/ingest/qm/bridge.ts` | 3-CSV → combined rows | no |
| `lib/ingest/normalize.ts` | drop surveys + non-MCQ, build `CleanResponse[]` | no |
| `lib/data/build-live-cycle.ts` | `CleanResponse[]` → `a.items` + `ResponseRecord[]` | no |
| `lib/data/in-memory-provider.ts` | store; `getRawData`, `getNaiveScores`, `getReview`, `pctByParticipant`, `excludedSet`, `itemMetasFor` | no |
| `lib/server/engine-write.ts` | Supabase equivalent of the above wiring | no |
| **`lib/engine/scores.ts`** | `computeScores` — denominator = Σ `maxScore`; essay/alteration add | **YES — off-limits** |
| **`lib/engine/types.ts`** | `EssayMark`, `ScoreOptions`, `ParticipantScore` | **YES — off-limits** |
| **`lib/engine/rollup.ts`**, `index.ts`, others | roll-ups / engine API surface | **YES — off-limits** |

The dropped max-0 item **does have responses** (17 presented / 17 answered in the
sample) — it is not an all-blank column; it is simply worth 0 marks.

---

## 4. Silent auto-clean inventory

Every place columns/items/rows are removed **without an explicit user action**:

| # | Site | Removes | Silent? | Source of 41→40? |
|---|---|---|---|---|
| 1 | `lib/ingest/normalize.ts:187-190` (`isSurveyAssessment`, def `:39-47`) | whole **survey assessments** (User Experience, "introduction to the G12", Arabic مقدمة) | Automatic; only a row count surfaced | No |
| 2 | `lib/ingest/normalize.ts:191-194` | every **non-MCQ row** — `Essay`, `Likert`, `Explanation`, `Yes No`, `Pull Down List` (counted as `droppedNonMcqRows`) | Automatic; surfaced only as a passing "No survey / non-MCQ leakage" check, `lib/ingest/validate.ts:82-90`, framed as *filtered*, not *N essays pending marks* | **No — but this is where the real essays vanish** |
| 3 | `lib/data/in-memory-provider.ts:1680-1681` | **max-0 items** from the Raw Scores denominator (`filter(maxScore ≥ 1)`) | Automatic; partially disclosed at `raw-scores/page.tsx:104` | **YES (Raw Scores denominator)** |
| 4 | `lib/engine/scores.ts:78-82` | max-0 items contribute **0** to the engine scored denominator (sum of `maxScore`) | Automatic / structural | **YES (engine denominator)** |

**Not silent (user-initiated), listed for completeness:**

| Site | Removes | Trigger |
|---|---|---|
| `lib/data/in-memory-provider.ts:596-598` (`excludedSet` folds `cleanCols`) + `getNaiveScores` `:1663-1665` | Clean-stage **column** removals from scoring | user removes a column on Clean |
| Item-review exclusions → `status "excluded"` (`lib/server/engine-write.ts:81`) → `excludedItemIds` | item removed from denominator | user excludes an item in Question Review |
| `lib/ingest/qm/sitting-guard.ts:51-70` | whole-sitting drop | **throws loudly**, not silent |

**Conclusion:** the 41-vs-40 discrepancy is entirely sites **3 & 4** (max-0 item
structurally outside the denominator). Site **2** is a separate silent removal —
it is where the *constructed-response essays* disappear, and it is the one that
matters for prompts `02`/`03`.

---

## 5. Recommendation

### (a) Should the silent auto-clean become a visible flag + manual delete? (prompt `02`)

**Partly — and be precise about *which* auto-clean.**

- The **max-0 item (sites 3/4)** should **not** be turned into a delete — it is
  already grade-neutral (adds 0 to numerator and denominator). What it needs is a
  **visible flag/label**, not a removal: on the Clean tab surface it as *"41 items
  (1 unscored: instruction / stimulus page)"* so the item count and the `/40`
  denominator visibly reconcile. The disclosure already exists on Raw Scores
  (`raw-scores/page.tsx:104`); the Clean tab (`clean/page.tsx:399`) should carry
  the same note. This is a **display-only** change — no scoring impact.
- The **non-MCQ drop (site 2)** is the one that genuinely warrants **visible
  flag + manual/opt-in handling**, because that is where offline-marked essays are
  silently discarded. Rather than a hard drop with only a count in a validation
  detail, non-MCQ items (especially `QuestionType = "Essay"`) should be surfaced
  as *flagged, retained-but-unscored* so the operator sees "N essay items awaiting
  offline marks" instead of a silent "-306 non-MCQ rows".

### (b) Correct default for an unscored / essay item

**Confirmed: "visible and flagged, excluded from the auto-mark denominator until
marks exist" (grade-neutral) is correct** — with a split by item kind:

- **Zero-mark MC presentation items** (welcome / stimulus / practice): keep exactly
  today's behaviour — **visible in the item list, scored 0, `maxScore 0` so
  automatically outside the denominator**. This already *is* "visible + excluded
  from the denominator, grade-neutral". Only the labelling is missing (§5a).
- **Constructed-response essays**: the correct default is **visible + flagged +
  excluded from the auto-mark denominator until marks exist** — *not* dropped
  (today's behaviour) and *not* silently scored 0. Dropping them is the current
  wrong default; scoring them 0 would be grade-bearing and wrong. The reserved
  essay max should only enter the denominator once marks are present, which is what
  the existing essay layer already does (essay max is reserved only for essay
  subjects — `lib/engine/scores.ts:104-108`).

### (c) How essay marks should enter scoring without touching `lib/engine/*`

**Do not insert essays as responses on `(qm_result_id, question_id)`.** The engine
**does not sum essays from the response store.** It sums MCQ from
`options.responses`, but essays come from a **separate `options.essayMarks`
array** keyed on `(participantId, assessmentId)` and added **half-weighted** on top:

```
lib/engine/types.ts:98-103    EssayMark { participantId, assessmentId, mark }   // mark already /20, half-weighted
lib/engine/types.ts:113-129   ScoreOptions.essayMarks / essayMax / essayAssessmentIds
lib/engine/scores.ts:98       essayBy = sumByKey(essayMarks, e => e.mark)        // NOT from responses
lib/engine/scores.ts:105-108  essay = essaySubjects.has(aid) ? essayBy.get(k) : 0 ;  max = mcqMax + essayMax
```

Inserting essays as `(qm_result_id, question_id)` responses would (i) fail — the
essay item ids were dropped at ingest and are absent from `itemMetas`/the response
store; (ii) if forced in, be summed as **MCQ** marks and add each essay's
`maxScore` to `mcqMax`, **double-counting** against the reserved essay max and
**bypassing the half-weighting** — a grade-bearing change. So the "insert as
responses" hypothesis is **not** the right path here.

**The correct, already-built, engine-free path exists and prompt `03` should use
it:** the **essay-marks layer**.
- UI: `components/cycle/EssayMarksCard.tsx` (on Upload) → `parseEssayMarks`
  (`lib/data/parse-essays.ts`) → `provider.uploadEssayMarks`.
- In-memory wiring: `essayMarksFor` (`lib/data/in-memory-provider.ts:702-704`) →
  `pctByParticipant` passes `essayMarks` + `essayMax: reservedEssayMax(a)` into
  `computeScores` (`:672-680`).
- Supabase wiring: `lib/server/engine-write.ts:160-193` builds `essayMarks` from
  the `essay_marks` rows and passes the same options.
- Half-weighting / reserved-max derivation is centralised in `lib/data/essays.ts`
  (`ESSAY_MAX_RESERVED = 20`, `reservedEssayMax`), **outside** `lib/engine/*`.

**Answer:** the engine sums essays from a **separate `essayMarks` array**, not the
response store; the mechanism for essays to enter scoring already exists and is
engine-neutral. Prompt `03` should feed marks through `uploadEssayMarks` /
`essay_marks`, keyed `(participantId, assessmentId)` on the half-weighted /20
scale — never as `(qm_result_id, question_id)` responses.

### (d) How a user-initiated column exclusion should propagate to the denominator

**This path already exists and is low-risk for the count/denominator, because it
routes through the same exclusion set the engine already reads — no engine
change.** A Clean-stage column removal is stored in `cleanCols` and folded into
`excludedSet` at `lib/data/in-memory-provider.ts:596-598`, so:
- **Engine denominator:** the removed item id lands in `computeScores`'
  `excludedItemIds` (via `pctByParticipant` `:671`), and `lib/engine/scores.ts:69`
  skips it from `retainedItemsByAssessment` → it leaves the sum-of-`maxScore`
  denominator automatically.
- **Raw Scores denominator:** `getNaiveScores` filters `cleanItems` by `remCols`
  first (`:1663-1665`), so `mcqMax` drops too.

**Trivial vs risky:** propagating a user column exclusion to the **denominator** is
**trivial** — the plumbing is done and parity-safe (with no removals it is
byte-identical, per the comment at `:594-597`). The **risk** is only in the
**count/label reconciliation**: `totalItems`/`raw.items` (`a.items.length`) is
*not* reduced by `remCols`, so after a user removes a column the Clean "Items"
count and the denominator will legitimately differ by the removed column too —
the UI must show *why* (removed columns + unscored max-0 items) rather than a bare
number. That gates prompt `02`: **the scoring propagation is safe to build; the
work is making the item-count panel explain the delta**, not touching the scoring
math. Anything that would change how the denominator itself is computed (e.g.
counting max-0 items, or re-including essays as responses) is grade-bearing and
out of bounds for `02`.

---

## Appendix — verification commands

```
# per-subject item counts + maxScore distribution (uses lib/data/seed.generated.json)
#   Applicable Math: items=41 maxScoreDist={'1':40,'0':1}
# raw export QuestionType distribution (data/sample_qm_export.xlsx):
#   Multiple Choice 3346 · Essay 306 · Likert 847 · Explanation 59 · Yes No 69 · Pull Down List 32
# the Applicable-Math max-0 item 100002785249 is QuestionType="Multiple Choice", QuestionMaximumScore=0
```
