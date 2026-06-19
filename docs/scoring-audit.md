# G12++ Scoring-logic audit — root-cause report

**Status:** Diagnose-only. No scoring logic was changed in this pass. The
existing suite is green and engine parity remains **183/183**
(`tests/engine.parity.test.ts`). The only files added are this report and a
clearly-separated, currently-passing probe suite
(`tests/scoring-audit.probe.test.ts`).

**How the numbers were reproduced:** the live Supabase host is unreachable
(egress blocked), so every figure below was produced from the in-repo seed
(`lib/data/seed.generated.json`, the "May 2026" live cycle: 18 participants ×
5 subjects) and the raw Questionmark fixture (`data/sample_qm_export.xlsx`,
4,659 rows) using the same engine the app runs (`InMemoryDataProvider` →
`lib/engine`). The probe suite encodes the worked examples so they can be
re-run.

---

## 1. How scoring is computed, stage by stage (the actual code path)

| Stage | Code | What it does |
|---|---|---|
| Parse raw export | `lib/ingest/parse.ts` | Reads the XLSX into rows. |
| Normalise / clean | `lib/ingest/normalize.ts` → `normalizeResponses` | Drops survey assessments; **keeps only `QuestionType === "Multiple Choice"`**; reads `maxScore` from the `QuestionMaximumScore` column (default 1); emits `CleanResponse[]`. |
| Build cycle (demo) | `scripts/build-seed.mts` → `lib/data/seed.generated.json` | Latinises subject names, groups responses into `assessments[].items[]` carrying `maxScore`. |
| Build cycle (live upload) | `lib/data/build-live-cycle.ts` → `buildLiveCycleData` | Same grouping **but keeps the raw assessment name** (Arabic stays Arabic-script). |
| Per-item max | `lib/engine/scores.ts` `computeScores` | `maxByItem = it.maxScore ?? 1`; subject MCQ max = Σ `maxScore` over retained items that appear in the responses. |
| Subject total | `lib/engine/scores.ts` `computeScores` | `raw = mcq + essay + alterations`; `max = mcqMax + (hasEssay ? essayMax(20) : 0)`; `pct = raw/max*100`. `hasEssay` = membership of `essayAssessmentIds`. |
| Essay subjects | `lib/data/in-memory-provider.ts:400` `essaySubjectIds()` (in-memory) / `lib/server/engine-write.ts:54` `isEssaySubject()` (server) | Decide which subjects reserve the +20 essay max. **The two predicates differ** (see §2A). |
| Essay marks | `lib/data/parse-essays.ts` + `in-memory-provider.ts` `buildEssayState` | Separate spreadsheet (AFL/ESL sheets), averaged per student/subject /20, matched by ParticipantID. |
| Item stats | `lib/engine/stats.ts` | `pValue = mean raw item score` (**not** normalised by `maxScore` — see §2D). |
| Read-models | `getComposition` (Grades), `getNaiveScores` (Score) | Two *different* score computations surface to two screens (see §2B). |

Two important architectural facts fall out of this:

- **Essays are not scored from the export.** Online essay rows carry
  `QuestionMaximumScore = 20` but `AnswerScore = 0` (essays are marked
  offline). The engine never sees them anyway because the MCQ filter drops
  them; the essay numerator comes *only* from the separate essay-marks upload.
- **There is more than one scoring path.** The engine (`computeScores`) is the
  canonical one, but `getNaiveScores` re-implements a parallel MCQ-only
  computation, and these disagree on the denominator.

---

## 2. Where the numbers diverge from expected

### A. Arabic essays aren't detected on a live upload — Latin-only predicate *(primary, matches the team's report)*

There are **three** essay/subject detectors and they use **three different
predicates**:

| # | Location | Predicate | Catches Arabic-script name? |
|---|---|---|---|
| 1 | `scripts/build-seed.mts:37` (naming) | `/[؀-ۿ]/` | ✅ (also renames it to Latin "Arabic as a 1st Language") |
| 2 | `lib/data/in-memory-provider.ts:401` `essaySubjectIds()` and `:419` `essayAssessmentForCode()` | `/arabic\|english/i` | ❌ **Latin only** |
| 3 | `lib/server/engine-write.ts:55` `isEssaySubject()` | `/arabic/i \|\| /english/i \|\| /[؀-ۿ]/` | ✅ |

The raw Questionmark name for the Arabic subject is Arabic script —
`"G12++ اللغة العربية"` (mojibake `"G12++ Ø§Ù„Ù„Ù‘ØºØ©…"`, repaired by
`repairText`). It contains **no Latin "arabic" substring**.

- In the **demo/seed**, `build-seed` (#1) rewrites the name to
  `"Arabic as a 1st Language"`, so detector #2 *accidentally* works and every
  test passes — the bug is masked.
- On a **real upload** through `buildLiveCycleData`, the name stays
  Arabic-script (`build-live-cycle.ts:185` keeps `name` raw; only `shortName`
  and `rtl` use the script test). Detector #2 (`/arabic|english/i`) then
  returns **false**, so:
  - Arabic is **not** added to `essayAssessmentIds` → its `max` does **not**
    reserve +20, and any uploaded Arabic essay mark is dropped
    (`hasEssay` false ⇒ `essay = 0` in `computeScores`).
  - `essayAssessmentForCode("AFL")` (`:419`, also Latin-only) **cannot find**
    the Arabic assessment to attach an AFL upload to, so the essay file silently
    fails to match.
- English keeps the Latin word "English" in its raw name, so it is detected in
  every path. → **English essays work, Arabic essays don't** — exactly the
  asymmetry reported.

Probe: `ROOT CAUSE A — Arabic essay detection diverges between code paths`
asserts `/arabic|english/i` returns `false` while the server predicate returns
`true` for the live Arabic-script name.

**Fix direction:** Make essay/subject detection a single shared helper that
uses the Arabic-script range (or, better, a stable subject *code* assigned at
ingest) rather than a Latin substring, and call it from all three sites.
Aligning #2 with #3 is the minimal change.

### B. The same student shows two different percentages on the Score vs Grades screens

`getNaiveScores` (Score screen) and `getComposition` (Grades screen) compute
the denominator differently:

- **Score screen** (`in-memory-provider.ts:732`): `mcqMax = scoredItems.length`
  (count of items with `maxScore ≥ 1`), `pct = raw / mcqMax`. **No essay max.**
- **Grades screen** (engine, `scores.ts:102`): `max = mcqMax + 20` for essay
  subjects, **even when no essay marks are uploaded** (because
  `essaySubjectIds()` flags English/Arabic unconditionally).

Worked example — **Student P0010, English as a 2nd Language** (no essay marks
uploaded, the default state):

| Screen | raw | max | pct |
|---|---|---|---|
| Score (`getNaiveScores`) | 36 | 46 | **78.3 %** |
| Grades (`getComposition`) | 36 (mcq 36 + essay 0 + alt 0) | 66 (46 + 20) | **54.55 %** |

A **23.8-percentage-point** gap on the same student/subject, driven purely by
the unearned +20 essay denominator. The Grades screen depresses every
English/Arabic student until essay marks happen to be uploaded.

Probe: `Score screen … vs Grades screen … — same student, divergent %` and
`essay subjects — max reserves +20 even with NO essay marks uploaded`.

**Fix direction:** Decide one rule and apply it in both read-models. Either
(a) only reserve the essay max once essay marks exist for the subject (so an
un-marked cycle scores MCQ-only and the two screens agree), or (b) make the
Score screen reserve the same +20 so both denominators match. (a) matches the
intuition that an un-uploaded essay shouldn't count as 0/20.

### C. Three different "item counts" for the same subject — zero-max stimulus items

Each graded subject contains unscored stimulus/container items with
`maxScore = 0` (English has 14: six "Listening comprehension" audio item-set
pages plus eight untagged). These leak inconsistently:

For **English** (`getRawData` / `getNaiveScores`):

| Count | Value | Source |
|---|---|---|
| Total items | 60 | `a.items.length` |
| Element item-count | 52 (Listening 30 + Reading 22) | `byElement` counts items by `major`, **including** `maxScore = 0` items |
| Scored MCQ items | 46 | `scoredItems` filter `maxScore ≥ 1` |

So the "Listening comprehension: 30 items" element badge counts six
unscorable audio pages as if they were questions, while the score for that
element is out of only the scorable subset. `itemsSeen` in the engine
(`ParticipantScore.itemsSeen`) has the same problem — it increments for every
answered response, **including** `maxScore = 0` items, so it can exceed the
scored-item count (probe: `subject MCQ max = sum of retained item maxScores`
asserts `itemsSeen > scoredItemCount` for Applicable Math: 41 vs 40).

The subject **max** is *not* affected (zero-max items add 0), but the **counts
shown to users** are, and they don't reconcile across panels.

**Fix direction:** Pick one definition of "item" for display (almost certainly
scored items, `maxScore ≥ 1`) and apply it in `byElement`, `itemsSeen`, and the
element rollups, or surface "scored vs total" explicitly. This is reporting
only — it does not change `raw`/`max`.

### D. `pValue` is not normalised by `maxScore` — latent break for any polytomous item

`stats.ts:195` computes `pValue = Σ score / n` (mean raw item score), with the
Good/Review/Flag difficulty bands assuming a 0–1 scale (`config.ts`). The raw
export **does** contain polytomous items: `QuestionMaximumScore` distribution
across distinct question-parts is `{0: 51, 1: 175, 4: 57, 20: 7}` — the `4`s
are Likert survey items, the `20`s are essays. Today this is **benign** because
every *retained MCQ* item in the graded subjects is max 0 or 1 (the 4s live in
survey assessments that are dropped; the 20s are essays dropped by the MCQ
filter), so parity (177 dichotomous items) is exact. But the moment a
multi-mark item is admitted as MCQ, its `pValue` can exceed 1 and silently
misrate difficulty — a real "question cost" inconsistency waiting to surface.

**Fix direction:** Normalise difficulty as `mean(score) / maxScore` (and verify
the discrimination/correlation inputs are on a consistent scale) before any
polytomous MCQ items are ingested. Guard with a parity re-run.

---

## 3. On the team's main suspicion — "question costs seem different"

The per-question max-marks data flow itself is **wired correctly end to end**:
`QuestionMaximumScore` → `normalize.ts:157` → `CleanResponse.maxScore` →
`ItemMeta.maxScore` → `computeScores` (sum of retained item `maxScore`). The
probe `subject MCQ max = sum of retained item maxScores` confirms the subject
max equals Σ item max.

What actually makes costs *look* different is the **interaction** of the issues
above, not a broken per-item value:

1. **The export carries genuinely different costs (1, 4, 20)**, but the MCQ
   filter (`normalize.ts:138`) discards the 4-mark (Likert) and 20-mark (essay)
   items. Within graded MCQ scoring everything that survives is worth 1, while
   the +20 essay max is **re-attached synthetically** through
   `essayAssessmentIds`. The essay's "cost" is therefore reserved in the
   denominator but earned only via a side-channel upload — so per the subject,
   20 of the marks behave unlike the others (probe: `ROOT CAUSE B — embedded
   max-20 Essay items are dropped by the MCQ filter`).
2. **Different denominators per subject** (Math 40, English 66, Scientific 35,
   Arabic 50, Life 24 — overall 215 for P0010, which does reconcile: the
   per-subject and overall sums are internally consistent, see
   `overall reconciliation` probe). The +20 reservation on English/Arabic makes
   an individual question "worth" a different fraction of the subject than in a
   non-essay subject.
3. **Zero-max stimulus items** inflate item/element counts (§C) so a subject
   looks like it has more "questions" than it scores.

Net: individual `maxScore` values are right; the *effective* weighting is
distorted by the essay reservation, the essay-detection asymmetry, and the
count leakage.

---

## 4. Adjustments / alterations and exclusions — verified correct

- **Item exclusions** flow into both numerator and denominator: excluded items
  are removed from `retainedItemsByAssessment` (so they leave the `max`) and
  skipped in the per-student MCQ sum (`scores.ts:54,64,81`). Demand rollups and
  D3 pools also honour exclusions (`in-memory-provider.ts:2098,2179`).
- **Alterations** are summed per (participant, subject) and added to `raw` only
  (`scores.ts:93,103`); they do not move the denominator, which matches the
  "net raw-mark adjustment" intent.
- **Overall reconciliation holds** inside `getComposition`: overall `raw` = Σ
  subject `raw`, overall `max` = Σ subject `max`, and `pct = raw/max` (probe
  `overall reconciliation`). The reconciliation failures are **across screens**
  (§B) and **in displayed counts** (§C), not within the engine's own roll-up.

---

## 5. Invariant scorecard

| Invariant | Result |
|---|---|
| Subject MCQ max = Σ retained item `maxScore` | ✅ holds |
| Overall raw = Σ subject raw; overall max = Σ subject max; pct = raw/max | ✅ holds (within `getComposition`) |
| Per-subject pct = raw/max | ✅ holds |
| Score-screen pct == Grades-screen pct (same student/subject) | ❌ **fails** for essay subjects (§B) |
| Essay max reserved ⇔ essay marks exist | ❌ **fails** — reserved unconditionally (§B) |
| Arabic essay detected on live upload | ❌ **fails** — Latin-only predicate (§A) |
| Displayed item counts reconcile (total / element / scored / itemsSeen) | ❌ **fails** — zero-max leakage (§C) |
| `pValue` on a 0–1 scale for all scored items | ⚠️ holds today; ❌ breaks for any polytomous MCQ (§D) |

---

## 6. Recommended fixes (each scoping a separate reviewed change)

1. **Unify essay/subject detection** behind one helper that recognises
   Arabic-script names (or a code assigned at ingest), used by
   `essaySubjectIds`, `essayAssessmentForCode`, and `isEssaySubject`. *(Fixes
   §A — the Arabic-essay report.)*
2. **One denominator rule for essays**, applied to both `getNaiveScores` and
   `computeScores`/`getComposition`; reserve +20 only when essay marks exist (or
   reserve consistently in both). *(Fixes §B — cross-screen %.)*
3. **One "item" definition for display** (`maxScore ≥ 1`) across `byElement`,
   `itemsSeen`, and element rollups, or label "scored vs total" explicitly.
   *(Fixes §C — count reconciliation.)*
4. **Normalise `pValue` by `maxScore`** before admitting any polytomous MCQ
   item, behind a parity re-run. *(Pre-empts §D.)*

Each is independently shippable and none requires touching the parity-pinned
item-statistics maths except (4), which must re-run `engine.parity.test.ts`.
