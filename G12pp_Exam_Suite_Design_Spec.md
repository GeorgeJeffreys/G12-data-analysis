# G12++ Exam Processing Suite — Design Specification

**Version:** 0.1 (design for MVP build)
**Purpose of this doc:** a complete enough spec to (a) generate a mockup in Claude Design, then (b) hand to Claude Code for an MVP build. The MVP covers the MCQ post-exam decision flow end to end (upload → grades out). The full suite vision is described so the architecture and data model don't have to be reworked when later modules land.

---

## 1. Scope

**North star:** a no-code exam-processing suite the G12 team operates themselves, reducing reliance on the third-party data scientist without compromising data quality.

**MVP (this build):** the MCQ flow — ingest a Questionmark export, validate it, review item quality, decide exclusions, compute scores, set grade boundaries, assign and sign off grades, export everything to Excel.

**Later modules (architected for, not built now):** certificate generation (plug in the existing tool), essay / constructed-response marking (human-in-loop), cross-cycle analytics.

**Computation engine = placeholder for now.** All psychometric and scoring maths sits behind a single defined interface (Section 8). For the MVP it is stubbed in TypeScript with mock/transparent logic; the validated Python is dropped in later with no UI rework.

### Decisions to confirm (assumptions made so design can proceed)
- **Roles:** Lead/Admin, Reviewer (SME), Viewer. *Confirm or adjust.*
- **Grade boundaries:** set by eyeballing the score distribution and placing cut-points (matches your current process), with an optional fixed-percentage mode. *Confirm.*
- **Data residency:** Supabase project pinned to a UK/EU region; PII (name, email, gender, DOB-in-ID) stays in that region. *Confirm region.*
- **Tenancy:** single workspace (Alsama) for MVP; multi-workspace deferred.

---

## 2. Users & roles

| Role | Does | Can't |
|---|---|---|
| **Lead / Admin** | Creates a cycle, uploads the export, runs validation, oversees review, sets grade boundaries, signs off and locks grades, manages exports, manages settings/thresholds/templates | — |
| **Reviewer (SME)** | Reviews flagged items, sets exclude + reason, adds notes; (later) marks essays | Set boundaries, lock grades, change settings |
| **Viewer** | Reads dashboards and final results | Make any decision or edit |

All decisions are attributed to a user and time-stamped in an audit log.

---

## 3. Core principle (drives every screen)

Split the work into a **machine layer** and **human judgement gates**.

- **Machine (automated, validated):** clean/transform, MCQ filter, the four item statistics, score roll-ups, distribution, exports.
- **Human gate 1 — item exclusion:** which items contribute to the score. Evidence-led, never automatic (small samples; a bad p-value alone is not a deletion rule).
- **Human gate 2 — grade boundaries:** where cut-points sit and final grade sign-off.

"Less manual" means automating the machine layer and the handoffs — **not** removing the two judgement gates. Data quality is enforced by validation gates in code (Section 10), not by reviewer diligence.

---

## 4. User journeys

### Journey A — Lead runs a new exam cycle (the spine of the MVP)
1. Creates cycle "May 2026", lands on the cycle overview with an empty status pipeline.
2. Uploads the Questionmark export. The app cleans/transforms, filters to MCQ, derives demand level, and runs validation. A **validation report** shows pass/warn/fail per check (row/total reconciliation, schema, encoding, no survey leakage).
3. On pass, opens **Item review & scoring** per assessment. Sees items graded Good/Review/Flag with the four stats. Excludes weak items with a reason; KPIs, distribution and breakdowns recompute live.
4. Moves to **Scoring & grade boundaries**. Sees the cohort distribution on retained items; drags cut-points (or enters percentages); live counts show how many students land in each band per assessment and overall.
5. Reviews **Grades & sign-off**: every student's section grades and overall grade. Locks the cycle.
6. **Exports** the Excel workbooks (item analysis, score summary, grades) matching the current templates; (later) generates certificates.

### Journey B — Reviewer (SME) reviews items
Opens an assigned assessment, filters to Flag/Review, reads wording + stats, sets exclude + reason + notes. Cannot set boundaries or lock. Work is saved and attributed.

### Journey C — Viewer checks results
Opens a locked cycle, reads dashboards and final grade distributions. No edit controls visible.

### Journey D — Backup / Excel-only use
A user uploads the export, runs validation, and immediately exports the generated workbooks without touching the gates — using the app purely as a faster, consistent replacement for running the script. This is a first-class path: the app must always be able to produce the spreadsheets.

---

## 5. Information architecture (Supabase data model)

Relationships top-down. Bold fields are **status/decision/computed fields that are never client-writable** — they change only through controlled server-side transitions (consistent with the question-writer app's `SECURITY DEFINER` + column REVOKE/GRANT pattern).

- **exam_cycles** — id, name, **status** (`draft → ingested → validated → in_review → scored → graded → locked`), region, created_by, timestamps
- **assessments** — id, cycle_id, name (the five major elements), item_count, **status**
- **items** — id, cycle_id, assessment_id, qm_question_id, wording, major_element, sub_element, demand_level (D1/D2/D3), max_score, **status**
- **item_stats** — item_id, p_value, p_rating, item_total, it_rating, point_biserial, pb_rating, discrimination, disc_rating, overall_review, **computed_at**, **engine_version** *(written only by the computation engine)*
- **participants** — id, cycle_id, qm_participant_id, pseudonym_id, full_name, email, dob, gender *(PII — region-bound, RLS-restricted)*
- **responses** — id, cycle_id, participant_id, item_id, answer_given, answer_score, response_time, result_status *(the long-format facts; immutable after ingest)*
- **item_reviews** — id, item_id, reviewer_id, **exclude** (bool), reason, notes, decided_at *(human gate 1; one current decision per item, full history in audit_log)*
- **score_runs** — id, cycle_id, assessment_id, excluded_item_ids[], **computed_at** *(a scoring snapshot after a given exclusion set)*
- **participant_scores** — score_run_id, participant_id, assessment_id, raw, pct, items_seen *(engine-written)*
- **grade_schemes** — id, cycle_id, scope (assessment_id | "overall"), method (`judgemental` | `fixed_pct`), bands[{label, min, max}]
- **grades** — id, cycle_id, participant_id, scope, grade_label, score, **locked** (bool), **signed_off_by**, signed_off_at
- **import_batches** — id, cycle_id, file_ref, parsed_rows, **validation_passed**, report_json
- **audit_log** — id, actor_id, action, entity, entity_id, before, after, ts *(append-only; covers every exclusion, boundary change, lock, export)*

---

## 6. Window-by-window architecture

Each window: **purpose · key contents · primary actions · empty/loading/error states · MVP?**

### W0 — Sign in / workspace
- **Purpose:** auth, land in the Alsama workspace.
- **Contents:** Supabase auth; role determined on entry.
- **MVP:** yes (minimal).

### W1 — Cycles dashboard (home)
- **Purpose:** see all exam cycles and their status at a glance.
- **Contents:** list/cards of cycles with name, date, status chip (draft…locked), participant/assessment counts, last activity. "New cycle" button.
- **Actions:** open a cycle, create a cycle, archive.
- **Empty:** "No cycles yet — create one to upload your first export."
- **MVP:** yes.

### W2 — Cycle overview (the pipeline)
- **Purpose:** the control room for one cycle; shows where the cycle is in the pipeline and what's next.
- **Contents:** horizontal status pipeline (Ingest → Validate → Review → Score → Boundaries → Grades → Export) with each step's state; per-assessment progress (items reviewed, excluded count); blockers/warnings.
- **Actions:** jump to any unlocked step; "continue" CTA on the next action.
- **MVP:** yes.

### W3 — Ingest & validate
- **Purpose:** bring the Questionmark export in and prove it's clean.
- **Contents:** drag-drop upload (xlsx/csv); after parse, a **validation report** — checks listed with pass/warn/fail and counts (e.g. "Row total reconciles to QM: PASS", "Survey rows removed: 0 leaked", "Encoding (Arabic) OK", "Every result has expected item count: 2 anomalies"); a preview of the cleaned, MCQ-filtered table.
- **Actions:** re-upload; proceed (enabled only when no hard-fail); download cleaned dataset.
- **Error:** failed checks are explained with the fix ("3 rows have no demand-level tag; tag them in Questionmark and re-export").
- **MVP:** yes. *(Cleaning/validation logic = placeholder engine for now.)*

### W4 — Item review & scoring  *(productised version of the prototype)*
- **Purpose:** human gate 1 — review item quality and decide exclusions; see scores move.
- **Contents:** assessment selector; KPI strip (items, excluded, median p, cohort mean); item-review table (Good/Review/Flag pill, wording + element/sub-element, demand, p / item-total / point-biserial / discrimination each colour-graded, Exclude toggle + reason); side dashboards (score distribution, mean by major element, mean by demand level) that recompute on every exclusion; filter chips (All/Flag/Review/Good) and sortable columns.
- **Actions:** toggle exclude + pick reason, add note, filter, sort, export this assessment to Excel.
- **States:** per-assessment "review complete" marker; reviewer attribution shown.
- **MVP:** yes — the centre of gravity.

### W5 — Scoring & grade boundaries
- **Purpose:** human gate 2 — place cut-points on the distribution.
- **Contents:** per-assessment and overall; interactive distribution (histogram of participant scores on retained items) with draggable cut-points; a band table (label, range, count, %) that updates live; method toggle (judgemental drag vs fixed percentages); a note panel for rationale.
- **Actions:** drag/enter cut-points, add bands, switch scope (per assessment / overall), save scheme.
- **MVP:** yes.

### W6 — Grades & sign-off
- **Purpose:** see and lock the result.
- **Contents:** table of participants × (section grades + overall grade + score); summary of grade distribution; flags for edge cases (e.g. on a boundary). Lock control with confirmation.
- **Actions:** review, adjust a boundary (returns to W5), lock cycle (Lead only), unlock (with reason, logged).
- **MVP:** yes.

### W7 — Exports
- **Purpose:** produce the deliverables.
- **Contents:** list of available exports (Item Analysis workbook, Overall Score Analysis workbook, Grades workbook) matching current templates; (later) certificate batch.
- **Actions:** download; choose included assessments; (later) generate certificates.
- **MVP:** yes (Excel exports). Certificates: later.

### W8 — Settings
- **Purpose:** configuration.
- **Contents:** rating thresholds (the README bands), export template mapping, roles/members, region display, engine version.
- **MVP:** thresholds + members (minimal); rest later.

### Later windows (architected, not built now)
- **W9 — Essay / constructed-response marking** (human-in-loop scoring UI; feeds the same scores tables).
- **W10 — Certificates** (the existing tool, reading participant + grade tables).
- **W11 — Cross-cycle analytics** (trends across cycles as scale grows).

---

## 7. Feature list (MVP vs later)

**MVP**
- Upload Questionmark export (xlsx/csv); clean/transform; MCQ filter; demand-level parse.
- Validation gates with a pass/warn/fail report.
- Item statistics (p-value, corrected item-total, point-biserial, upper/lower discrimination) + Good/Review/Flag ratings.
- Item-review gate: exclude + reason + notes, attributed and logged.
- Live recompute of scores, distribution, and element/demand breakdowns on exclusion.
- Grade-boundary tool (judgemental + fixed-pct), per assessment and overall.
- Grade assignment, sign-off, lock, audit log.
- Excel export matching current templates; Excel-only backup path.
- Roles (Lead/Reviewer/Viewer), Supabase auth, RLS.

**Later**
- Certificate generation (plug-in).
- Essay/constructed-response marking (human-in-loop).
- Cross-cycle analytics and trends.
- Multi-workspace.

---

## 8. Computation layer (the placeholder contract)

Everything maths-related sits behind one module so the UI never depends on how it's implemented. Build the MVP against this interface; swap the Python in later.

```
ComputationEngine (interface)
  ingestAndClean(rawExport)            -> { cleanedResponses[], validationReport }
  computeItemStats(responses)          -> itemStats[]   // p, item-total, point-biserial, discrimination + ratings
  computeScores(responses, excludedItemIds) -> participantScores[]   // raw, pct, items_seen
  rollUp(participantScores)            -> { byAssessment, byMajorElement, byDemandLevel, distribution }
```

- **MVP stub:** a transparent TypeScript implementation (the maths is simple enough to reproduce) returning real values, plus the option to load known outputs as fixtures. Tag every result with `engine_version`.
- **Swap-in later:** the validated Python runs as a service (or is ported); the interface and all callers stay identical. A **parity test** must reproduce the data scientist's outputs cell-for-cell on a known cycle before the engine is trusted in production.

---

## 9. Excel round-trip

- **Export (must match):** workbooks visually near-identical to the current `MCQ_Item_Analysis`, `MCQ_Overall_Score_Analysis`, and a grades workbook — same sheet structure, headers, and (for item analysis) the same columns plus a **single canonical** Remove/Reason pair. The app becomes the source of truth that ends the column-naming drift.
- **Import (must tolerate):** historical variants ("Remove Item?", "Remove item?", "Remove?", "Column1") are normalised on the way in.
- **Library:** SheetJS for generation in the MVP; templated server-side generation later if fidelity needs it.

---

## 10. Validation gates (data-quality, enforced in code)

Run at ingest; block progression on hard-fail:
- Row count and per-participant item counts reconcile to the Questionmark totals.
- Schema/column presence and types.
- Encoding integrity (Arabic renders correctly, not mojibake).
- No survey assessments or non-MCQ rows leak into the analysis set.
- Every retained item has a demand-level tag; every participant has a result status.
- Duplicate result/answer detection.

---

## 11. Claude Design prompt (paste into Claude Design)

> Design a clickable mockup for **G12++ Exam Processing Suite**, an internal web tool used by an education NGO's assessment team to process exam results after students sit a digital exam. The users are assessment leads and subject-matter reviewers — not developers. The tool's job is to take a raw exam export, help the team review question quality and decide which questions to exclude, then set grade boundaries and assign grades, replacing a manual spreadsheet-and-data-scientist process.
>
> **You own the visual design — take a strong, opinionated point of view.** I'm deliberately not prescribing palette, typography, layout, or motion; form the visual identity yourself from the subject. Avoid generic admin-dashboard defaults, make deliberate choices, and feel free to take one real, justified aesthetic risk. Decide for yourself how to represent things like the three question-quality ratings, the statistics, and the moment scores recompute.
>
> **Context that should inform (not dictate) your choices:** decisions here affect real students' grades and have to be auditable, so legibility and a sense of trust matter; the data is dense — many questions, each with several statistics — so it must stay readable at volume; and some content is in Arabic, so the layout should handle right-to-left text gracefully.
>
> **Functional requirements — what each screen must let the user do or see** (five assessments give realistic content: Applicable Math, English as a 2nd Language, Scientific Thinking, Arabic as a 1st Language, Life Success Skills):
> 1. **Cycles dashboard** — see all exam cycles (e.g. "May 2026") with their status and participant/assessment counts; start a new cycle.
> 2. **Cycle overview** — see where one cycle sits in its pipeline (Ingest → Validate → Review → Score → Boundaries → Grades → Export) and what to do next.
> 3. **Ingest & validate** — upload an export and read a validation report where each check passes, warns, or fails with a count; preview the cleaned data.
> 4. **Item review & scoring** (the most important screen) — pick an assessment; see headline numbers (items, excluded, median difficulty, cohort mean); work through a dense table of questions, each showing its wording, curriculum element/sub-element, demand level, one of three quality ratings, and four psychometric statistics (p-value, item-total correlation, point-biserial, discrimination); exclude a question with a reason. Alongside, see a score distribution and breakdowns by curriculum element and by demand level that update as questions are excluded. The table can be filtered and sorted.
> 5. **Scoring & grade boundaries** — see the score distribution and set grade cut-points on it (by dragging, or by entering percentages); see live counts of how many students fall in each grade band; switch between per-assessment and overall.
> 6. **Grades & sign-off** — see every student's section grades and overall grade, the grade distribution, and lock the result.
>
> Make the flow navigable. Write labels in plain, active voice from the user's side ("Exclude from scoring", "Lock grades", "Re-upload export"), and make empty and error states explain what to do next in the interface's own voice. Baseline quality: responsive, keyboard-accessible, reduced-motion respected.

---

## 12. Next steps
1. Generate and iterate the mockup in Claude Design using the Section 11 prompt.
2. Hand this spec + the mockup to Claude Code for the MVP, building against the Section 8 interface with the engine stubbed.
3. When the scripts arrive, port/validate the engine and run the parity test before trusting it in production.
