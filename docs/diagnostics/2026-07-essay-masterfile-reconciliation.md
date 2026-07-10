# Essay marks — masterfile ingest & signed-off reconciliation (prompt 03)

> **SUPERSEDED (2026-07-10).** The halve/sum reconciliation and the
> Moderated/Final per-essay logic described below are **no longer used**. The team
> now moderates the essays themselves and the app reads their single per-student
> **`Adjusted scores (USE THESE)`** column directly from a two-sheet workbook,
> joining on the QM email. See `2026-07-essay-workbook-adjusted.md` and
> `lib/data/parse-essay-masterfile.ts`. This file is kept for history only.


**Date:** 2026-07-09
**Scope:** Ingest the marking team's REAL double-marking masterfile (CSV, one file
per language) and reconcile it to a per-subject essay score per a policy **signed
off by George**. Encoded as named, explicit rules — never silent guesses.
`lib/engine/*` untouched. Full suite green.

## The file (verified against `[INTERNAL] FEB26 marking masterfile [AFL ESL] (English Essay master).csv`)
- **One file per language** (English → ESL, Arabic → AFL). Subject is determined
  by **which file is uploaded** (the file name), not a column. The file name
  carries the literal `[AFL ESL]` split instruction, so we key on the language
  word in the parenthetical (`(English Essay master)`), not the AFL/ESL codes.
- Header columns by position (names are messy — we match on header **text**,
  whitespace/case-tolerant, and fall back to position):
  `0 Marker A · 1 Student name · 2 Student ID · 3 Essay ID · 4 Marker ·
  5-9 Dim1..Dim5 · 10 Total score · 11 Average · 12 Flag ·
  13 Moderated final score · 14 Final scores:` — cols 15+ are tracking/warning
  junk, ignored. The UTF-8 BOM is stripped.
- **New join column `QM Participant ID (email)`** — G12 populate the participant's
  Questionmark email here (QM has no numeric student id; the email *is* the
  participant key). Matched by **header name, not position** (it is appended at the
  end but may sit anywhere); if absent, every row is rejected — a missing join key
  is never guessed.
- **Two rows per essay** (markers M1/M2). The approved fields are populated on the
  **first** row of the pair. **Two essays per student** (`EE01.png`, `EE02.png`).

## Reconciliation policy (SIGNED OFF — `lib/data/parse-essay-masterfile.ts`)
1. **Ignore the double-marking entirely** — `Dim1–5`, per-marker `Total score`
   and `Average` are **not** read. (Fixture asserts this: `Average`/`Total` carry
   deliberately wrong values; only Moderated/Final give the oracle answer.)
2. **Approved mark per essay = `Moderated final score` if non-blank, else
   `Final scores:`.** Moderated is an override and wins when present. Each essay /20.
3. **Halve each essay to /10, then sum the two → subject essay /20.**
4. **`round_half_up(essay_1/2 + essay_2/2)`.** Kept as the single named constant
   **`ESSAY_ROUND_STAGE = 'sum'`** — inspectable and one-line-changeable, but the
   decision is **final**. The rejected alternative `'each'` (round each /10 first)
   is computed for the record (`subjectEssayEach`) but **never used**; the two
   differ for exactly **3 of 17** students.
5. **Join on the `QM Participant ID (email)` column — case-insensitive EXACT
   email.** The Alsama `Student ID` (`A-A-260506`) is **not** in the Questionmark
   export, so it is a human label only — never the join key. The email is matched
   against the roster participant's canonical key (`qm_participant_id` = the email,
   surfaced as the context's `studentId`; the provider matcher and the qm→uuid map
   both lower-case, so the whole chain is case-insensitive). A **blank email** or an
   **email not in the subject's roster** → **rejected** with a clear reason, never
   guessed. The review screen shows the matched participant (email + name) beside
   every row so a human signs off before apply. (Optional DOB-vs-`DDMMYY` warning is
   not implemented — the email is authoritative; noted as a future cheap hardening.)
6. **Anomalies are flagged, never silently dropped:** a student without exactly 2
   essays, an essay with no approved mark, a blank/off-roster email, or an already
   Clean-excluded sitting → surfaced in the review report and excluded from apply.

### Round-stage: `'sum'` vs the rejected `'each'` (for the record)
| Student | e₁ | e₂ | `'sum'` (used) | `'each'` (rejected) |
|---|---|---|---|---|
| E-H-100108 | 17 | 19 | **18** | 19 |
| L-K-051006 | 13 | 13 | **13** | 14 |
| S-O-300503 | 19 | 15 | **17** | 18 |

All 17 signed-off `'sum'` values are asserted by the oracle fixture
`tests/fixtures/essays/essay-reconciled-english.csv` — an independently
hand-computed table, not backsolved from the app.

## Double-halve check — the subject essay is halved EXACTLY ONCE
The engine (`lib/engine/scores.ts:98-109`) **sums** the per-subject `EssayMark.mark`
and adds it to the numerator **as-is** — it does **not** multiply by 0.5 and does
**not** round. The denominator reserves `essayMax = 20` (the sum of essay item max
/ 2) as-is. So the engine's "half-weighting" is entirely carried by the *values the
caller supplies*: a mark already on the half-weighted /20 scale against a reserved
max of 20.

Policy step 3 already produces exactly that value: `essay_1/2 + essay_2/2` is on the
/20 scale (max 20). The parser therefore emits **one** `EssayUploadRow` per student
carrying the reconciled /20 (`round_half_up(essay_1/2 + essay_2/2)`); the existing
`uploadEssayMarks` per-student averaging is **identity** on a single row, so the
value reaches the engine unchanged. Net subject essay contribution is halved once —
in the parser/policy — and `lib/engine/*` is not edited.

## Integration notes
- **Accept filter widened** to `.csv,text/csv,.xlsx,.xls` so the masterfile is
  selectable (it was greyed out at `.xlsx` only).
- **Email join + review sign-off:** the parser keys the reconciled row on the QM
  email; `validateEssayMasterfile` joins it to the roster, surfaces the matched
  participant (email + name) and the computed /20 in the review table, and rejects
  blank/off-roster emails. All 17 test-file rows match (join oracle +
  `essay-studentid-to-email-crosswalk.csv`).
- **Per-language merge:** `uploadEssayMarks` now merges **per subject** — an
  uploaded language fully replaces that subject's marks and leaves the other
  language intact, so English and Arabic can be uploaded separately. Re-uploading a
  language replaces that subject's marks → idempotent, never duplicated. The
  Supabase path sends the **full merged set** to the (full-cycle-replace) RPC, so
  separately-uploaded languages persist correctly — no migration needed.
- **Role-gated** behind the existing `incidents.upload` action (admin/lead tier),
  unchanged — the masterfile write goes through the same `uploadEssayMarks`.
- **Disclosure** ("N essay items pending marks") is computed per subject from
  students without a mark, so it clears for a language as soon as that language's
  marks are applied.
