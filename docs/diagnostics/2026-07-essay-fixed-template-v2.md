# Essay marks — the app's fixed upload template (v2): generate + ingest

**Date:** 2026-07-11
**Scope:** The app no longer parses the markers' working spreadsheet. It owns **one
fixed template on both ends** — it **generates** the template pre-filled from the
roster and **parses only that template**. `lib/engine/*` untouched. Full suite green.

## The template contract (the only shape the app deals with)
- `.xlsx`, two sheets `English Essay master` / `Arabic Essay master`. **Sheet name →
  subject** (English → English as a 2nd Language; Arabic → Arabic as a 1st Language).
- Header row: `QM email · Student name · Alsama Student ID · Essay ID · Marker ·
  Mark (/20) · Final essay mark (/20)`.
- **4 rows per student per subject** (2 essays × markers M1/M2). `Final essay mark`
  is filled **once per student**, on that student's first row.
- **The app reads ONLY three things:** the tab name (→ subject), `QM email`, and
  `Final essay mark`. `Essay ID` / `Marker` / `Mark` / `Student name` / `Alsama
  Student ID` are the team's working record and are ignored. The two data columns
  are matched by header name (case-insensitive, tolerant of extra columns /
  whitespace / a `(/20)` suffix): email column contains "email"; final column
  contains "final".

## A — Generate (`lib/data/essay-template.ts`, "Download template")
For each essay subject in the registry (`context.subjects` — English + Arabic, never
hardcoded), emit a 4-row block per roster participant: identity (`QM email`,
`Student name`) **pre-filled from the roster** — *this is the point: emails are
never hand-typed, so the join key can't drift.* `Essay ID` = Essay 1/1/2/2, `Marker`
= M1/M2/M1/M2, `Mark` blank; `Final essay mark` on the block's first row =
`=IFERROR(AVERAGE(F{start}:F{start+3}),"")` (auto-averages the four marks, blank
until filled, the team types over it to moderate). The roster is the SAME
participant source the score path uses (`getEssayContext` → subject responses), and
`QM email` = the participant's `qm_participant_id` (= `ResultParticipantName` = the
email). File name `G12_Essay_Marks_TEMPLATE_v2.xlsx`.

## B — Ingest (`lib/data/parse-essay-masterfile.ts` + `validate-essay-masterfile.ts`)
1. Route each sheet to its subject by name.
2. Group data rows by `QM email` (lower-cased); take the single non-blank `Final`.
   None → reject (`no final mark`); more than one → reject (`multiple final marks`).
3. Resolve `QM email` to a roster participant by exact, case-insensitive email.
   Blank / off-roster → reject with a reason. **No DOB, no Student-ID, no crosswalk.**
4. `ESSAY_MARK_ROUNDING` (default `half_up` → whole /20; `none` keeps e.g. 15.25 —
   George to confirm) → the subject essay /20.
5. Ignore `Essay ID` / `Marker` / `Mark`.

Validation surfaces the matched participant (email + name) and the Final /20 per row;
only valid rows upsert idempotently via `uploadEssayMarks`, keyed to the matched
participant + subject, at the `(participantId, assessmentId)` the score path reads.
Write gated behind `incidents.upload` (admin/lead).

## Full weight (not double-halved)
The Final **is** the /20 subject essay; the engine adds it as-is against a reserved
max of 20 (`lib/engine/scores.ts`; wiring in `2026-07-essay-score-wiring.md`). Fed
straight through — halved zero further times. English max stays /66 = 46 + 20.

## Deleted (grep: zero code hits)
The marking-masterfile parser (`Dim1–5` / `Total score` / `Average` / `Final
scores:` / `Adjusted scores`, two-marker-row assumptions), the halve/sum
reconciliation, and any DOB / Alsama-Student-ID / crosswalk resolution.

## Acceptance (`ESSAY_MARK_ROUNDING='half_up'`)
Reproduced by `tests/essay-masterfile.test.ts` against
`tests/fixtures/essays/G12_Essay_Marks_TEMPLATE_v2_filled.xlsx` (team's Final → /20):

- **English:** abed 15 (15.25) · afraa 19 · amal 13 (12.5) · dalal 19 (19.25) ·
  elaph 16 · fatima.alissa 15 · fatima.aljasem 17 · hussien 18 (18.25) · louay 13 ·
  marah 16 (15.5) · maram 18 (18.25) · marwa 17 (17.25) · nour.alissa 16 ·
  nour.zaqzaq 16 (16.25) · oula 17 (16.75) · safa 17 (16.75) · wissal 19 (18.5).
- **Arabic:** abed 15 (14.5) · afraa 17 (16.75) · amal 15 · dalal 15 (15.25) ·
  elaph 19 (18.5) · fatima.alissa 14 · fatima.aljasem 15 · hussien 16 (15.75) ·
  louay 14 (13.5) · marah 16 (16.25) · maram 16 (15.75) · marwa 16 · nour.alissa 14
  (13.75) · nour.zaqzaq 16 · oula 13 · safa 18 (17.5) · wissal 15 (15.25).

## Tests
- `essay-masterfile.test.ts` — rounding, routing, email/Final extraction + the
  acceptance values (both sheets), single/no/multiple-Final, working-column ignore.
- `essay-masterfile-join.test.ts` — all 34 rows match on QM email (case-insensitive);
  blank / off-roster / no-Final / multiple-Final rejected with reasons.
- `essay-masterfile-flow.test.ts` — apply at full weight, idempotency, per-subject
  merge, the **generate → fill → re-parse round-trip**, pending, exclusions.
- `essay-score-wiring.test.ts` — the Final /20 reaches the score after a
  persist→hydrate round-trip.
