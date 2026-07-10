# Diagnostic — essay marks → score wiring audit (prompt 05)

**Date:** 2026-07-10
**Type:** Wiring audit of the essay → score path. `lib/engine/*` untouched.
**Verdict:** The path is **correctly wired end-to-end on current `main`**. Persisted
essay marks reach `computeScores` and land at **full weight** (the reconciled /20
adds into the /66 total; it is **not** halved again). The 17-student audit oracle
reproduces exactly against **unmodified `main`**. The symptom in the brief ("Score
shows MCQ-only / banner says not loaded") does **not** reproduce here — it was the
pre-wiring state; the masterfile ingest work (#87/#88) closed the seam. This
diagnostic adds a **regression lock** so it can never silently regress.

> No behaviour change is made. Fabricating a "fix" for already-correct grade-bearing
> wiring would be wrong. Instead we (a) trace the path with file/line refs, (b) prove
> correctness with the independently-computed oracle, and (c) lock it with a test.

---

## Phase 1 — the flow, traced (each answered with refs + real data)

### 1. Storage side — what is persisted
Essay marks persist to `essay_marks` (migration `0003_adjustments_essays_config.sql:42-55`):
one row per `(cycle_id, participant_id, assessment_id)`, `mark` numeric /20,
`essays_counted`. `participant_id`/`assessment_id` are **UUIDs** (FKs to
`participants.id` / `assessments.id`). The row set written is exactly
`InMemoryDataProvider.essayMarksForPersistence` (`lib/data/in-memory-provider.ts:3041-3052`)
→ RPC `upsert_essay_marks` (`supabase-provider.ts:714-723`, migration `0003:212-228`,
full-cycle replace). Each row's `participant_id` is the **resolved participant UUID**
(from `matchEssayStudent`), `assessment_id` is the English assessment UUID, `mark`
the reconciled /20.

### 2. How `assessmentId` is set on write
`uploadEssayMarks` → `buildEssayState` resolves the subject via
`essayAssessmentForCode(code)` (`in-memory-provider.ts:714-719`): `ESL`/`english` →
the assessment whose **name** matches `/english/i`; its `.id` is stored as the
mark's `assessmentId`. Source of the code: the parser infers it from the **file
name** (`inferEssayLanguage`), so the English masterfile → `ESL` → the English
assessment's id. (In the seed the assessment `id` *is* its name,
`"English as a 2nd Language"`; in production it is that assessment's UUID.)

### 3. Consumption side — how the Score page reads it
Score page → `getComposition` (`app/cycles/[cycleId]/score/page.tsx:31`, delegated
`supabase-provider.ts:385`) → `pctByParticipant`
(`in-memory-provider.ts:673-684`), which calls
`engine.computeScores(responsesOf(a), excluded, { essayMarks: this.essayMarksFor(cycleId, a.id), essayMax: reservedEssayMax(a), essayAssessmentIds: this.essaySubjectIds(), items })`.
`essayMarksFor(cycleId, a.id)` (`:705-708`) returns the stored marks **filtered by
`assessmentId === a.id`**. **Lookup key = `(a.id, participant r.p)`.**

### 4. The key comparison (stored vs looked-up)
- **assessmentId:** stored = `essayAssessmentForCode('ESL').id`; looked-up = `a.id`
  in the score loop. Both are the **same English assessment object's id** →
  **match**.
- **participantId:** stored = `matchEssayStudent(...).id` = participant `p.id`;
  looked-up against the response accumulator's `e.participantId` = `r.p` =
  `responses.participant_id` = the same participant `p.id` → **match**.
- **cycle/scope:** both read/write `essayMarksByCycle.get(cycleId)` for the live
  cycle → **same scope**.
No mismatch. The engine keys essays by `key(participantId, assessmentId)`
(`lib/engine/scores.ts:98,103-105`) and both components align.

### 5. The banner
`useProvisionalNotice` (`components/shell/ProvisionalBanner.tsx:22,25`):
`missingEssay = getEssayMarks(cycleId).subjects.filter(s => s.count === 0)`. `count`
(`in-memory-provider.ts` `getEssayMarks`) is the distinct participants with a mark
under `assessmentId === a.id` — the **same lookup** as scoring. So once English
marks flow, English `count > 0` and the banner clears; Arabic stays at `count = 0`.

### 6. The +20 max
`essayMax: reservedEssayMax(a)` (`:681`) = `isEssaySubject(a) ? essayItemMaxSum(a)/2 : 0`
(`lib/data/essays.ts`); for English that is `40/2 = 20`. The engine adds it to the
denominator only for essay subjects (`scores.ts:108`, `max = mcqMax + (hasEssay ? essayMax : 0)`)
→ 46 + 20 = **66**. This is why the max reserves the essay allowance regardless of
whether a value is present.

### 7. The weight
The engine **sums** the per-subject essay `mark` and adds it to the numerator
**as-is** (`scores.ts:98,105,109`: `essayBy = sumByKey(essayMarks, e => e.mark)`;
`raw = e.mcq + essay + alt`) — **no ×0.5, no rounding**. The reconciled /20 (the
halving already done in the parser) therefore contributes at **full weight**. Net
subject essay is halved exactly **once**.

---

## Root cause of the brief's symptom
On current `main` there is **no key mismatch** — the stored `(participant_id,
assessment_id)` equal the score's lookup keys, so essays reach the total. The
"MCQ-only / not loaded" state described is the **pre-wiring** condition (before the
masterfile ingest was connected to the existing essay layer). It is resolved.

**If it is ever seen again in a live cycle** (which the seed cannot reproduce,
because the seed collapses `id == name` and `id == studentId`), it is almost
certainly one of two production-data key drifts — diagnose with:
```sql
-- stored essay key vs the assessment the score reads
select em.participant_id, em.assessment_id, a.name, em.mark
from essay_marks em join assessments a on a.id = em.assessment_id
where em.cycle_id = :cycle;
-- does the stored participant_id exist in the scored responses?
select em.participant_id,
       exists(select 1 from responses r where r.participant_id = em.participant_id
              and r.assessment_id = em.assessment_id) as in_responses
from essay_marks em where em.cycle_id = :cycle;
```
A `false` in `in_responses`, or an `assessment_id` that is not the English
assessment the Score page iterates, is the miss.

---

## The regression lock (Phase 3)
`tests/essay-score-wiring.test.ts` + `tests/fixtures/essays/english_essay_audit_february_2026.csv`:
- **Audit oracle:** 17 English students, independently computed as `MCQ + essay/20`
  = the /66 totals (Abed 39, Afraa 55, … Wissal 54). Asserts `computeScores` yields
  each `raw` exactly, `essay` at **full weight** (Abed 16, not 8), `max = 66`.
- **Guard:** a double-halve (Abed essay 8 → 31) would miss the oracle.
- **End-to-end:** apply → `essayMarksForPersistence` → hydrate mapping (mirror of
  `supabase-hydrate.ts:658-664`) → fresh provider → the essay **still** counts in
  `getComposition`; banner clears for English (`count > 0`), stays for Arabic
  (`count = 0`).

This is a reusable oracle for future subjects/cohorts.
