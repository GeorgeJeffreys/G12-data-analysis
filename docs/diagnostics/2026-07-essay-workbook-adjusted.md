# Essay marks — ingest the workbook natively (two sheets, Adjusted column, QM-email join)

**Date:** 2026-07-10
**Scope:** Ingest the marking team's essay **workbook** directly. Two things are
settled — by the file and by George — and encoded as explicit rules. `lib/engine/*`
untouched. Full suite green.

## What changed vs the earlier `03` drafts
- **No identity mapping in the app.** G12 populate the participant's **QM email**
  in the file; the app joins on that email (exact, case-insensitive) to the roster.
  Blank email → the row is rejected (G12's cue to fill it). The Alsama `Student ID`
  is a **display label only**. All DOB / Student-ID resolution / crosswalk code is
  **removed** (grep: zero hits).
- **The team already reconciled & moderated.** The app reads the single per-student
  **`Adjusted scores (USE THESE)`** column **directly** and never recomputes. The
  old halve/sum reconciliation and the Moderated/Final per-essay logic are
  **deleted**.

## The file
- `.xlsx` workbook, two sheets: **`English Essay master`** and **`Arabic Essay
  master`** — routed to their subjects **by sheet name** (`sheetSubjectCode`;
  English → ESL, Arabic word/script → AFL). A single-language file (CSV or one-sheet
  xlsx) is also accepted, inferring the subject from the **filename** as fallback.
- Per sheet, the mark is **`Adjusted scores (USE THESE)`** — one value per student
  (on the student's first row; blank on the marker/essay detail rows). It is the
  moderated **subject essay /20**. `Dim1–5`, `Total score`, `Average`,
  `Final scores:`, `Moderated final score` and all tracking/junk columns are
  ignored. Rows are grouped into students by the Student ID column with
  **forward-fill** (the merged-cell layout), so the blank detail rows attach to the
  student above.
- **Join key:** the column G12 fill with the QM email, matched defensively
  (case-insensitive, header contains "email"). *Tell George to have G12 label it
  clearly, e.g. `QM email`.*

## Rules (encoded)
1. Per student, take the single populated `Adjusted scores (USE THESE)` → subject
   essay /20. No value → **reject** with a reason. One value per student per subject.
2. **`ESSAY_MARK_ROUNDING`** (named constant). Default **`'half_up'`**:
   `round_half_up(adjusted)` → whole /20 (15.25 → 15, 18.5 → 19). Alternative
   `'none'`: keep the exact quarter-point value. One-line change; **George to
   confirm** (default stands).
3. Join on the QM email — exact, case-insensitive — to the subject roster's
   participant (email = `qm_participant_id`, surfaced as the context's `studentId`).
   Blank / off-roster email → **reject**, never guessed.
4. **Never recompute** from per-essay scores. `Adjusted` is authoritative.

## Full weight (not double-halved)
The engine adds the per-subject essay `mark` to the numerator **as-is** against a
reserved max of 20 (`lib/engine/scores.ts`; wiring proven in
`2026-07-essay-score-wiring.md`). The Adjusted value **is** the /20 subject essay,
so it is fed straight through — halved **zero** further times. English max stays
/66 = 46 MCQ + 20 essay, the essay contributing its /20 at full weight.

## Acceptance oracle (`ESSAY_MARK_ROUNDING='half_up'`)
Reproduced exactly by `tests/essay-masterfile.test.ts` against the synthetic
two-sheet fixture `tests/fixtures/essays/FEB26_essay_master_workbook.xlsx` (raw
Adjusted → rounded /20):

- **English:** afraa 19 · abed 15 (15.25) · amal 13 (12.5) · dalal 19 (19.25) ·
  elaph 16 · fatima.alissa 15 · fatima.aljasem 17 · hussien 18 (18.25) · louay 13 ·
  marah 16 (15.5) · maram 18 (18.25) · marwa 17 (17.25) · nour.alissa 16 ·
  nour.zaqzaq 16 (16.25) · oula 17 (16.75) · safa 17 (16.75) · wissal 19 (18.5).
- **Arabic:** afraa 17 (16.75) · abed 15 (14.5) · amal 15 · dalal 15 (15.25) ·
  elaph 19 (18.5) · fatima.alissa 14 · fatima.aljasem 15 · hussien 16 (15.75) ·
  louay 14 (13.5) · marah 16 (16.25) · maram 16 (15.75) · marwa 16 · nour.alissa 14
  (13.75) · nour.zaqzaq 16 · oula 13 · safa 18 (17.5) · wissal 15 (15.25).

## Tests
- `essay-masterfile.test.ts` — rounding, sheet/filename routing, Adjusted
  extraction + the full oracle (both sheets), junk-column tolerance, forward-fill.
- `essay-masterfile-join.test.ts` — all 34 rows match the roster on email
  (case-insensitive); blank / off-roster / no-Adjusted are rejected with reasons.
- `essay-masterfile-flow.test.ts` — provider apply at full weight, idempotency,
  per-subject merge, pending disclosure, flagged/off-roster exclusion.
- `essay-score-wiring.test.ts` — the Adjusted /20 reaches the score after a
  persist→hydrate round-trip (updated off the old reconciliation).
