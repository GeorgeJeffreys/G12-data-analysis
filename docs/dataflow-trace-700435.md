# Dataflow trace — sitting 700435 (data selection & aggregation)

> Written **before** any code change (per the P1 brief: diagnose first, trace, then
> fix). It records, for each pipeline stage, the exact source it reads, the
> participant key it aggregates on, and where surveys / non-MCQ / excluded
> participants are filtered. It then pins the five root causes (A–E) to concrete
> code locations, with evidence reproduced from the de-identified 700435 fixture
> (`tests/fixtures/qm/{Items,Assessments,Topics}.csv` — 18 result-participants,
> the same shape as the live export).

## The roster (700435)

18 result-participants = **16 real students + 2 to exclude**:

| fixture id | real-world role | sat | exclude because |
|---|---|---|---|
| `student15@example.edu` | G12 Lead (**lavinia.cavalet**) | English only (+ survey) | staff account |
| `student16@example.edu` | re-sit/test (**muamina.mlisho**) | `G12++ Applicable Maths` (attempt 2) **+ Life Success Skills** | test account / typo re-sit form |

The fixture reproduces the published oracles **exactly** once these two are
excluded and the re-sit form is not merged (verified with the real engine):

| Subject | Participants | MCQ items | Cohort avg % |
|---|---|---|---|
| Applicable Math | 15 | 41 | **40.3%** |
| Scientific Thinking | 12 | 36 | 49.1% |
| English as a 2nd Language | 11 | 63 | 44.7% |
| Life Success Skills | 10 | 25 | 80.4% |
| Arabic (اللّغة العربيّة) | 9 | 31 | 62.0% |

Applicable Math raw MCQ scores out of 41 (the 15 real students):
`24, 19, 19, 19, 17, 17, 17, 16, 16, 16, 16, 14, 14, 14, 10` → mean pct 40.3%.
(De-identified: the `14` that the brief calls "Louay = 14/41" is reproduced; the
top `24` is "dalal".)

## Stage-by-stage trace

| Stage | Code | Reads | Participant key | Survey / non-MCQ / exclusion filter |
|---|---|---|---|---|
| **Ingest (3-CSV)** | `lib/ingest/qm/canonical.ts` `buildCanonicalModelFromTables` | the three QM CSVs joined on `ResultId` | `participantEmail` = `ResultParticipantName` (lowercased) | surveys dropped (`isSurveyAssessment`); subject name **merged** by `normalizeSubjectName` ← **root cause A** |
| **Ingest → engine bridge** | `lib/ingest/qm/bridge.ts` `toCombinedRows` | Items ⋈ Assessments | — | rewrites `AssessmentName` through `normalizeSubjectName` (merges "Maths"→"Math") ← **A** |
| **Normalize / clean** | `lib/ingest/normalize.ts` `normalizeResponses` | combined rows | `qmParticipantId` = `ResultParticipantName` \|\| `ResultId`; pseudonym `P0001…` assigned by first appearance | drops surveys (`isSurveyAssessment`) + non-MCQ (`QuestionType !== "Multiple Choice"`) ← **E** anchor |
| **Build live cycle** | `lib/data/build-live-cycle.ts` `buildLiveCycleData` | `CleanResponse[]` | `participantPseudonym` (email-derived, unique) | items keyed `qmQuestionId`; subjects grouped by (merged) `assessmentName` |
| **Clean (row/col removal)** | provider `setCleanRemoval` → `cleanRows`/`cleanCols` | seed + decision state | participant id (`p.id`) / item id | per-subject; cohort-wide only if removed from **every** subject ← **C** gap |
| **Raw scores** | provider `getNaiveScores` | seed responses | `p.id` | honours `cleanRows`/`cleanCols`; scored items = `maxScore ≥ 1` |
| **Score** | provider `getComposition` → `pctByParticipant` → `engine.computeScores` | `responsesOf(a)` | `participantId+assessmentId` (sums, never overwrites) | `responsesOf` drops clean-removed rows; `excludedSet` drops clean-removed + item-review cols |
| **Cut scores** | provider `boundaryState` / `getBoundaries` | per-subject score maps | `p.id` | inherits the cleaned score maps |
| **Grades** | provider `getGrades` | per-assessment `pctByParticipant` + `cohortRemovedParticipants` | `p.id` | drops cohort-removed participants from the rows |
| **Analytics / overall** | `lib/data/overall.ts`, provider `getReliability` etc. | grades / score maps | `p.id` | inherits the cleaned set |

## Root causes — located & evidenced

### A. Two assessment names merged → Math inflated to 85 items / `/83`
`normalizeSubjectName` (canonical.ts:46) rewrites `Applicable Maths` →
`Applicable Math`, and `toCombinedRows` (bridge.ts:37) applies it before
splitting. The 44-question re-sit form (`G12++ Applicable Maths`, sat only by the
test account) therefore folds into Applicable Math: **85 MCQ items, `/83`
denominator, 17–20% cohort average**. The existing `tests/qm-3csv.test.ts`
pins this *wrong* behaviour (`itemCount === 86`, "merges the 'Applicable Maths'
variant"). Real Applicable Math = **41 MCQ items** (85 − the 44-item re-sit form;
verified: un-merged Math = 41 items / 15 participants).

**Fix:** stop merging. `normalizeSubjectName` canonicalises only (trim + collapse
whitespace + a configurable alias map, default empty). The re-sit form is
**surfaced for review** (`canonical.resitForms` + a validation warning) and
**not** built as a graded subject — never unioned into Applicable Math's item set.

### B. Staff / test accounts not excluded
`lavinia.cavalet` (`student15`, English-only staff) and `muamina.mlisho`
(`student16`, re-sit/test) appear as ordinary participants. There is no
authoritative "this login is staff/test — exclude from the cohort" action; the
only lever is per-subject row removal.

**Fix:** add `excludeParticipantFromCohort(cycleId, participantId, excluded,
reason)` to the provider. It records an authoritative cohort exclusion (audited as
a staff/test exclusion) that every downstream stage honours. **No emails are
hardcoded** — the analyst flags the accounts; the regression test drives the API.

### C. Clean-stage removals don't propagate cohort-wide
`cohortRemovedParticipants` (in-memory-provider.ts:502) only treats a participant
as cohort-removed when they are clean-removed from **every** subject they sat.
Removing muamina on one tab (8→7) leaves her in Life Success Skills, so she
re-appears in Grades. There was no single authoritative removal.

**Fix:** the cohort exclusion (B) is folded into the **one** filtered source that
`responsesOf`, `getNaiveScores`, `cohortRemovedParticipants`, the headline counts
and reliability already read — so an excluded participant vanishes from Raw
scores, Score, Cut scores, Grades **and** Analytics in one action.

### D. Participant collapse + per-student corruption
The brief's signature ("7 of 15 participants, survivor holding a tiny value")
points to a per-student map keyed on a non-unique key. **In the in-memory + engine
path this does not reproduce** — `computeScores` keys on `participantId +
assessmentId` and *sums* (scores.ts:36–96), and `buildLiveCycleData` keys on the
email-derived pseudonym (unique). Verified: build-live-cycle emits all 15 (16 with
the re-sit) Math participants with correct raw scores. The live-app collapse is a
selection/merge artefact, not an engine bug.

**Fix / guard:** add an invariant in `buildLiveCycleData` asserting, per subject,
`#distinct input participant keys == #output participants` (a silent overwrite
fails loudly), and keep the participant key the guaranteed-unique email-derived
pseudonym. A regression test pins it.

### E. Survey / non-MCQ filtering must be uniform
Surveys (`Survey - …`, `User Experience …`, `مقدمة …`) are dropped in
`isSurveyAssessment`; non-MCQ types are dropped by the `Multiple Choice` gate in
`normalizeResponses`. The inflated counts in A were the merge, not a filter leak —
but the invariant is pinned by a regression test (no survey / non-MCQ row reaches
any subject's scored item set or denominator).

## Invariants added (verified by tests)

1. **Canonical per-subject item set (A):** a subject's scored item set, element
   denominators and scoring all use one canonical item set; re-sit forms are
   surfaced, never unioned.
2. **Unique participant key (D):** `#distinct input results/participants ==
   #output participants` per subject in `buildLiveCycleData`.
3. **Authoritative cohort exclusion (B/C):** one removal → gone from every stage.

## Methodology flags surfaced for G12 sign-off (not decided here)

- **Result status:** 14 of 15 Applicable Math sittings are `Finished Abnormally`
  (normal for this delivery; kept). Surfaced as a count, behaviour unchanged.
- **Typo re-sit form** (`G12++ Applicable Maths`, attempt 2): surfaced as a
  re-sit form and excluded with the test account — **not merged**.
- **Staff/test exclusion** (`lavinia.cavalet` and future staff logins): excluded
  via the cohort-exclusion action, configurable, never hardcoded.
