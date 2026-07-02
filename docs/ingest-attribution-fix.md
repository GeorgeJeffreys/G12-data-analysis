# Ingest participant attribution — root cause & fix (task 16)

## Verdict: **Fork B (live code)** — the fix wasn't on the live write path.

The email-keyed resolver (`participant-identity.ts`, commit `2643926`; P-A stable
identity, commit `17846a8`) shipped, **but participant identity was resolved TWICE
on the 3-CSV ingest path, over two different row-sets that can disagree** — so the
roster and the response cells were built from resolutions that competed. This is
the task's Fork B signature ("two implementations competing / responses attached to
a separate per-ResultId identity → all-dots rows").

## Step 0 — inventory (which identity function runs where, before the fix)

| Pass | File / function | Row-set it resolved over | Produces |
|---|---|---|---|
| **Roster** | `canonical.ts buildCanonicalModelFromTables` → `assignParticipantIdentities` | **Assessments** export — one row per result (the complete roster, incl. results with no MCQ item rows) | `canonical.participants`, `canonical.results[].participantEmail`, `result_totals` |
| **Responses** | `normalize.ts normalizeResponses` → `assignParticipantIdentities` (again) | **Items**-joined rows (`bridge.toCombinedRows`) — only results that have item rows | `cleanedResponses[].qmParticipantId` → `participants` + `responses` (persist), the score matrix |

`git log` confirms both `2643926` and P-A (`17846a8`) are present and reconciled to
one resolver — but that resolver was **called independently in each pass**.

## The defect

`assignParticipantIdentities` has a per-subject collision safety-net: a login code
(the non-unique `ResultParticipantName` — an initials code like `A-A`, *not* a
unique email in the real cohort, per `2643926`) that is shared by **≥2 distinct
results within one subject** is downgraded to the unique `ResultId` so distinct
sitters never merge.

That fold decision depends on **how many results carry the code within the subject**
— and the two passes see different result-sets:

- A result present in **Assessments but not Items** (a real sitter whose MCQ rows
  failed to join / an abandoned or duplicate sitting) is in the **roster** pass but
  not the **response** pass.
- So a code shared by such a result flips: **folded in the roster pass** (→
  `result:<id>`), **not folded in the response pass** (→ the bare code).

The same real sitter (e.g. *Amal*, who **did** answer) then resolves to
`result:700001` in the roster and `a-a` in the responses. Result: the roster row
has no responses (**all-dots**), the responses hang off an id absent from the
roster, `result_totals` for that sitter is silently dropped (its canonical id isn't
in the response-keyed map), and cross-subject identity is inconsistent.

Reproduced (`tests/ingest.attribution.test.ts`, `tests/fixtures/qm-attribution/`):
the de-identified `student1…18` fixture masks it (unique emails, every sitter has
items); the realistic fixture (non-unique login codes + item-less code-sharing
siblings) shows **2 results resolving to different ids across the passes**, fixed to
**0**.

## The fix — resolve identity ONCE, carry it

`ingestThreeExports` now resolves identity a single time over the authoritative
Assessments roster (`resolveAssessmentIdentities`) and passes the **same map** to
both the canonical model and `normalizeResponses`. `normalizeResponses` gained an
optional `resolvedByResult` argument: when supplied (3-CSV path) it **carries** that
identity onto the responses instead of re-resolving; when absent (legacy single-file
path) it resolves internally exactly as before. The roster and the cells can no
longer disagree on a result's participant.

This matches the invariant the brief requires: *participant identity resolved once,
from the unique key, carried unchanged.*

## Guardrail (fails loudly at the ingest boundary)

`assertResponsesAttachToRoster(clean, rosterIds)` (in `split.ts`, run inside
`ingestThreeExports`) asserts every cleaned response's participant id is one the
authoritative roster resolved — a response attributed off-roster (the all-dots
signature) now throws at ingest instead of surfacing as a wrong certificate. This
sits alongside the existing per-subject `assertParticipantIdentityIntact`
(#distinct participants == #distinct sitters).

## Stale rows

The fix applies on **re-ingest**. Any rows a prior (competing) ingest already wrote
are replaced by a clean re-ingest — `reset_cycle_for_reingest` / `ingest_persist`
clear-then-insert (migration 0007/0018, already on `main`).

## Files changed

- `lib/ingest/qm/canonical.ts` — `resolveAssessmentIdentities()`; `buildCanonicalModelFromTables` accepts the pre-resolved map.
- `lib/ingest/normalize.ts` — `normalizeResponses(rows, resolvedByResult?)` carries the roster identity.
- `lib/ingest/qm/index.ts` — resolve once; pass the same map to canonical + normalize; run the alignment guard.
- `lib/ingest/split.ts` — `assertResponsesAttachToRoster()`.
- `lib/ingest/index.ts`, `lib/ingest/qm/index.ts` — barrel exports.
- `tests/ingest.attribution.test.ts`, `tests/fixtures/qm-attribution/*` — regression.

Full suite green (885); engine parity **183/183** unchanged (engine untouched).
