# P-C — Timing & speededness: reproduced (analyst notebooks) vs app (engine)

The analyst's two notebooks are the oracle, exactly as the item-statistics notebook was for P-B:

1. **Timing / performance** — per student, score % (correct ÷ presented) and the **median item response time**, then Pearson + Spearman between median item time and score %.
2. **Speededness / omission-rate** — omission rate (blank ÷ presented), completion (1 − omission), and the **speededness index** = ( max(0, late − early omission) + max(0, early − late accuracy) ) ÷ 2, where the *late* items are the final 25% (`ceil(0.25 × n_items)`, min 1) by earliest presented order and accuracy = correct ÷ answered.

Both are ported verbatim into `lib/diagnostics/index.ts` and render on the **Analytics ("Diagnostics") tab** alongside the demand-level breakdown; the whole-assessment go/no-go figures stay on the critical-path **Assessment Health** step.

## Keying — the corrected P-A matrix (15 for Applicable Math)

Every measure runs through `cleanDiagResponses` first, so it keys on **P-A's stable internal participant id** over the same corrected matrix the item stats use: cohort-excluded (staff/test) accounts dropped, `(participant, QuestionId)` deduped keeping the **last** row. On P-B's oracle matrix (`data/parity_fixtures.json`) Applicable Math is therefore **15 students × 40 items** (600 cells) — not the collapsed 7, nor a staff-inflated count. (Gate: `tests/diagnostics.notebook.test.ts`.)

## Reproduced vs app (Applicable Math, demo sitting)

Each cell shows **reproduced** (an independent implementation of the notebook formulae — see `scripts/diagnostics-reproduce.mts`) then **app** (this engine's output). They match to 4 dp for every figure. Cohort keyed on P-A's unique id; the demo sitting has 17 students × 41 MCQ items × 697 presentations.

### Speededness / omission / completion

| Group | Items | Presentations | Omission (repro / app) | Speededness index (repro / app) | Early acc. (repro / app) | Late acc. (repro / app) |
|---|---|---|---|---|---|---|
| Whole assessment | 41 | 697 | 0.0% / 0.0% | 0.0269 / 0.0269 | 33.73% / 33.73% | 28.34% / 28.34% |
| D1 · foundational | 16 | 272 | 0.0% / 0.0% | 0.0000 / 0.0000 | 36.76% / 36.76% | 36.76% / 36.76% |
| D2 · intermediate | 16 | 272 | 0.0% / 0.0% | 0.0221 / 0.0221 | 32.35% / 32.35% | 27.94% / 27.94% |
| D3 · top-difficulty | 9 | 153 | 0.0% / 0.0% | 0.0490 / 0.0490 | 29.41% / 29.41% | 19.61% / 19.61% |

Omission is 0% across the paper (no blank answers in this sitting), so the whole-assessment speededness index is driven entirely by the late accuracy drop, which climbs with difficulty (D1 flat → D3 the steepest early→late fall). Item sets present: *Large storeroom*, *Pollution in the air*, *Solar-powered irrigation projects*.

### Timing ↔ performance (median item time ↔ score %)

| Group | Students | Pearson r (repro / app) | Spearman ρ (repro / app) | Strength |
|---|---|---|---|---|
| Whole assessment | 17 | −0.2057 / −0.2057 | −0.1432 / −0.1432 | Weak negative |
| D1 · foundational | 17 | −0.2718 / −0.2718 | −0.2288 / −0.2288 | Weak negative |
| D2 · intermediate | 17 | 0.1790 / 0.1790 | 0.1636 / 0.1636 | Weak positive |
| D3 · top-difficulty | 17 | 0.5298 / 0.5298 | 0.5849 / 0.5849 | Strong positive |

On the hardest tier (D3) students who spent longer scored **higher** (strong positive) — time on the demanding items paid off — while on the easiest tier (D1) longer times weakly tracked lower scores. Undefined correlations render **blank (—)**, never 0.

## Verification

- Reproduced tables above match the engine to 4 dp — `tests/diagnostics.notebook.test.ts` (reproduced-vs-app) and `tests/diagnostics.test.ts` (formulae).
- Keys on P-A's unique id: Applicable Math = 15 students × 40 items on the corrected matrix — `tests/diagnostics.notebook.test.ts`.
- Engine parity unchanged at **183/183** (`tests/engine.parity.test.ts`) — these are analytics on top of the corrected matrix, the scoring engine is untouched.
