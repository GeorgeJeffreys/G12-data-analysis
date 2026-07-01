# Critical path — participant identity & the numerator / denominator flow

This document is the contract for two grade-bearing invariants that must hold end
to end, from raw upload to the final award. They are enforced by tests
(`tests/critical-path.test.ts`, `tests/participant-identity-collapse.test.ts`,
`tests/build-live-cycle.invariants.test.ts`) — this file explains *why*.

## 1. Stable, unique participant identity

Every per-student number in the app is only as trustworthy as the key that groups
a student's rows together. Get the key wrong and distinct students silently fold
into one record (the "~8 participants when 15 sat it" collapse) and the per-student
score matrix is overwritten.

**The only collision-free field in the raw Questionmark export is
`ResultParticipantName` — the participant's email / login** (18 distinct, 0
collisions, 0 splits). Every other candidate collides:

| Field | Collides? |
|---|---|
| `ResultParticipantName` (email) | **no — unique** |
| `ResultParticipantFirstName` | yes (two shared — the two Fatimas / Nours) |
| `ResultParticipantLastName` | yes (one shared) |
| `ResultSpecialField4` (date of birth) | yes (shared + placeholder `01-01` dates) |
| first + last initial (login code) | yes (three share `A-A`) |

### The rule

1. Resolve each participant to their natural, collision-free key, following the
   analyst's fallback order where the fields exist:
   **`ParticipantID → email (`ResultParticipantName`, backup `ResultSpecialField3`) → `ResultId`**.
2. Mint a **stable internal participant id** as a deterministic, **injective (1:1)**
   function of that key — `internalParticipantId()` (trim + case-fold). The same
   email always yields the same id; two different emails never collide. It is a
   plain normalisation, **not a hash** (a hash could collide and break 1:1), and it
   **never** reads a name, initial or DOB.
3. The display pseudonym `P00xx` maps **1:1** from the internal id (display only).
4. **Every per-student structure is keyed on the internal id** (via the pseudonym) —
   score matrix, item stats, raw scores, cohort set, cut scores, grades. The email
   string is retained only as the human `studentId`; it is never scattered as a join
   key, and nothing keys on a name or DOB.

### The invariant — assert it everywhere participants are counted

> `#distinct-input participants (by unique id) == #distinct-output participants`

Enforced, and made to **fail loudly**, at each stage a drop could hide:

- **Ingest / detection boundary** — `assertParticipantIdentityIntact` (a subject's
  distinct output participants must equal its distinct sitters / `ResultId`s).
- **`buildLiveCycleData`** — the pseudonym ↔ internal-id bijection, plus an explicit
  cardinality check (distinct input ids == distinct output participants).
- **Grades** — `getGrades` asserts the cohort's distinct participants each surface as
  exactly one award row.

A silent drop breaks a test at the earliest stage, never at issuance.

## 2. The numerator / denominator flow

A student's per-subject percentage is **always**:

```
pct = earned marks on currently-INCLUDED items (+ adjustments)
      ────────────────────────────────────────────────────────  × 100
      max marks on currently-INCLUDED items
```

keyed on the internal id and consistent through every stage. The engine
(`lib/engine/scores.ts`) is the single place this is computed; the stages below only
change its inputs.

| Stage | Numerator (earned) | Denominator (max) |
|---|---|---|
| **Clean** — participant / row removal | changes *who* is in the cohort; the removed student leaves every downstream view | cohort max is recomputed over the retained cohort's items |
| **Raw marks** — from the score matrix | sum of scores on retained MCQ items the student answered, keyed on the internal id | Σ maxScore over the subject's retained scored items |
| **Question review** — exclude an item | item's earned mark leaves the numerator | item's max leaves the denominator — **both** move together. A max-0 stimulus item is already out of the denominator. |
| **Essay marks** | add the offline essay mark to the numerator | unchanged — the essay max is already reserved in the denominator |
| **Technical adjustments** | add / adjust net earned marks (the delta rides the `alterations` input) | unchanged |
| **Cut scores** | — classification only — | never changes the score |
| **Re-adjust** | same invariants hold after iteration (deltas computed against the un-adjusted base, never compounded) | unchanged |
| **Grades** | every exclusion / adjustment above is reflected in the final award (award recomputes through the full engine path) | — |

### Key consequences

- Excluding an item **must** remove it from the numerator *and* the denominator. An
  exclusion that only dropped the earned mark (leaving the max) would silently
  penalise everyone; the engine removes the item from the retained set, so both move.
- Essay marks and technical adjustments are **numerator-only** — the essay max is
  reserved in the denominator up front, so adding the earned essay mark (or a
  technical delta) never changes the max.
- Cut scores classify; they never alter a score.

### Worked end-to-end example

`tests/critical-path.test.ts` takes a real Applicable Math student, records the
baseline `mcq / max / pct`, then:

1. **excludes one item** the student answered correctly — numerator −1, denominator
   −1 — and asserts `pct == (mcq−1) / (max−1) × 100`;
2. **adds a technical adjustment** to a target mark — numerator only — and asserts
   the final `raw`, unchanged `max`, recomputed `pct`, and the **grade**
   (`classify(pct, …)`) all equal the hand-computed values.

The award is re-derived through the full engine path, so the exclusion and the
adjustment both flow into the final grade.
