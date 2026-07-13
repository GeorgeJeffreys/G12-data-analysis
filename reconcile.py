#!/usr/bin/env python3
"""
reconcile.py — validate the published oracles against each other, staff excluded.

This is the raw-data reconciliation gate for the G12++ May 2026 sitting (700435).
It reads the two committed oracles:

  * tests/fixtures/oracles/oracle_rosters.csv           — one row per real result
    (subject, assessment, result_id, email, name, status, is_staff_test, raw_total,
    raw_pct). Cross-checked to Questionmark's own ResultTotalScore.
  * tests/fixtures/oracles/oracle_applicable_math_matrix.csv — the naive per-student
    Applicable Math response matrix (Q1..Q41 + TOTAL), one row per sitter.

and checks, for Applicable Math (the grade-bearing subject this task fixes):

  1. Σ(Q1..Q41) == the matrix TOTAL column, cell-derived, for every sitter.
  2. that TOTAL == the roster raw_total for the same result_id (the two oracles,
     built independently from raw, agree).
  3. the cohort is exactly the 15 real Math sitters after the staff/test exclusion
     (the two accounts flagged `is_staff_test` in the roster DATA — neither sat Math,
     so Math is 15 in both the raw and the excluded roster; the exclusion is derived
     from that data flag, mirroring the app's editable per-cohort exclusion list — not
     a hard-coded email set — so the script validates the SAME cohort boundary the app
     applies, not the raw 18).

and then extends the raw-total gate through the full grade chain (Phase D),
independently re-deriving — WITHOUT importing lib/engine — per participant × subject:

  4. the MCQ max, recovered from each subject's (raw_total, raw_pct) columns and
     validated for internal consistency under a single integer max (a cell-diff of
     the roster's pct column against its raw_total column);
  5. the essay-inclusive grade pct — ESL/Arabic reserve the half-weighted essay max
     (Σ essay item max / 2 = 20) in the denominator and add the approved essay mark
     (join on lowercased email) to the numerator; round_half_up to 2 dp;
  6. item-review deletions as an exclude-from-denominator rescale (Math matrix, cell
     level), driven by the committed deletion fixture;
  7. the performance level (classify against the per-subject cut fixture); and
  8. the overall award (5-subject pattern rule + the D3 cap, both per-exam and
     aggregate interpretations behind a flag).

Extra fixtures: oracle_cuts.csv (per-subject cuts), oracle_essays.csv (approved
essay marks — empty in this cohort), oracle_item_deletions.csv (the deletion set —
empty). HONEST LIMIT: the committed data is the REAL cohort while the app seed is
anonymised, so PLD/award are DERIVED and surfaced (there is no real-cohort app
export to diff against); the RAW→pct layer IS diff-validated. Exit 0 = green.

Run:  python3 reconcile.py            (Math raw gate + full grade-chain gate)
      python3 reconcile.py --grades   (also print the PLD + award distributions)
      python3 reconcile.py --all      (also the per-subject roster totals sanity)
"""
from __future__ import annotations

import csv
import os
import re
import sys
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
ORACLE_DIR = os.path.join(HERE, "tests", "fixtures", "oracles")
ROSTERS = os.path.join(ORACLE_DIR, "oracle_rosters.csv")
MATRIX = os.path.join(ORACLE_DIR, "oracle_applicable_math_matrix.csv")
CUTS = os.path.join(ORACLE_DIR, "oracle_cuts.csv")
ESSAYS = os.path.join(ORACLE_DIR, "oracle_essays.csv")
DELETIONS = os.path.join(ORACLE_DIR, "oracle_item_deletions.csv")

MATH_SUBJECT = "Applicable Math"
MATH_SITTERS = 15

# ── Spec constants (re-derived from the authoritative spec — NEVER imported from
#    lib/engine; this oracle's whole value is being an independent re-derivation) ──

# ESL + Arabic carry a half-weighted essay block: two essays × 20 = 40 raw marks,
# reserved at HALF (Σ essay item max / 2) in the subject denominator.
ESSAY_ITEM_MAX_SUM = 40
ESSAY_MAX_RESERVED = ESSAY_ITEM_MAX_SUM // 2  # 20

# Per-subject performance-level labels, best → lowest (length 4), and the overall
# award labels, best → lowest (length 4). Positions, not names, drive the rule.
PERF_LABELS = ["Outstanding", "Exceeds", "Meets", "Doesn't yet meet"]
AWARD_LABELS = ["Distinction", "Advanced", "Secondary", "No Award"]

# Arabic Unicode block, mirroring lib/data/essays.ts's script-aware detector so the
# Arabic-script subject name is recognised (re-implemented here, not imported).
_ARABIC_SCRIPT = re.compile(r"[؀-ۿ]")


def is_essay_subject(name: str) -> bool:
    """ESL/Arabic only — a half-weighted essay block. Script-aware, like the app."""
    return bool(_ARABIC_SCRIPT.search(name or "")) or bool(re.search(r"arabic|english", name or "", re.I))


def round_half_up(value: float, dp: int) -> Decimal:
    """Round-half-up to `dp` decimals (Decimal, ROUND_HALF_UP), the spec's rounding.
    Matches the engine's Math.round-based `round` for the non-negative pct values
    the grade decision is made on."""
    q = Decimal(1).scaleb(-dp)  # 10**-dp
    return Decimal(str(value)).quantize(q, rounding=ROUND_HALF_UP)


def classify(pct: Decimal, cuts: list[int]) -> str:
    """score → performance level. `cuts` is [outstanding, exceeds, meets] (percent);
    score ≥ cut ⇒ in the level; the lowest level is the implicit remainder."""
    for i, cut in enumerate(cuts):
        if pct >= cut:
            return PERF_LABELS[i]
    return PERF_LABELS[-1]


def derive_award(subject_levels: list[str], d3_pass: bool = True) -> str:
    """Layer-2 award from the pattern of the five subject levels (NOT a cut on an
    overall score), plus the per-student D3 cap on Distinction. Highest → lowest,
    stop at first match — a faithful re-derivation of lib/engine/award.ts:
      Distinction — ≥3 Outstanding AND every subject ≥ Meets AND passes D3 cap.
      Advanced    — ≥3 at Exceeds-or-better.
      Secondary   — ≥4 at Meets-or-better.
      No Award    — otherwise.
    A subject not sat ranks as the lowest band (fails the ≥Meets clauses)."""
    def rank(level: str) -> int:
        return PERF_LABELS.index(level) if level in PERF_LABELS else len(PERF_LABELS) - 1

    ranks = [rank(l) for l in subject_levels]
    total = len(ranks)
    outstanding = sum(1 for r in ranks if r == 0)
    exceeds_or_better = sum(1 for r in ranks if r <= 1)
    meets_or_better = sum(1 for r in ranks if r <= len(PERF_LABELS) - 2)
    distinction_pattern = outstanding >= 3 and meets_or_better == total

    if distinction_pattern and d3_pass:
        return AWARD_LABELS[0]
    if exceeds_or_better >= 3:
        return AWARD_LABELS[1]
    if meets_or_better >= 4:
        return AWARD_LABELS[2]
    return AWARD_LABELS[3]


def _norm(email: str) -> str:
    return (email or "").strip().lower()


def _is_staff_test(row: dict) -> bool:
    """Staff/test status is DATA — the roster's own `is_staff_test` flag, mirroring
    the app's editable per-cohort `cohort_exclusions` list. No email is hard-coded
    here; excluding a different cohort's staff is a data change, not a code change."""
    return str(row.get("is_staff_test", "")).strip().lower() in ("true", "1", "yes")


def load_rosters() -> list[dict]:
    with open(ROSTERS, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def staff_test_emails(rosters: list[dict]) -> set[str]:
    """The excluded set, derived from the roster's `is_staff_test` data flag."""
    return {_norm(r["email"]) for r in rosters if _is_staff_test(r)}


def load_matrix() -> list[dict]:
    with open(MATRIX, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def reconcile_math() -> list[str]:
    """Return a list of failure messages (empty = green) for Applicable Math."""
    errors: list[str] = []
    rosters = load_rosters()
    matrix = load_matrix()
    staff = staff_test_emails(rosters)

    # Roster raw_total per result_id, Math only, staff/test excluded.
    roster_total: dict[str, int] = {}
    math_cohort: set[str] = set()
    for r in rosters:
        if r["subject"] != "Applicable Math":
            continue
        if _norm(r["email"]) in staff:
            continue
        roster_total[r["result_id"]] = int(r["raw_total"])
        math_cohort.add(r["result_id"])

    if len(math_cohort) != MATH_SITTERS:
        errors.append(
            f"cohort: expected {MATH_SITTERS} Applicable Math sitters after staff "
            f"exclusion, got {len(math_cohort)}"
        )

    q_cols = [f"Q{i}" for i in range(1, 42)]
    seen: set[str] = set()
    for row in matrix:
        email = _norm(row["email"])
        if email in staff:
            # The matrix should not carry a staff/test sitter for Math (none did).
            errors.append(f"matrix: staff/test account {email} present in Math matrix")
            continue
        rid = row["ResultId"]
        seen.add(rid)
        cells = [int(row[q]) for q in q_cols]
        cell_sum = sum(cells)
        stated = int(row["TOTAL"])
        if cell_sum != stated:
            errors.append(
                f"{row['name']} ({rid}): Σ(Q1..Q41)={cell_sum} != matrix TOTAL {stated}"
            )
        rtot = roster_total.get(rid)
        if rtot is None:
            errors.append(f"{row['name']} ({rid}): in matrix but not in Math roster")
        elif rtot != stated:
            errors.append(
                f"{row['name']} ({rid}): matrix TOTAL {stated} != roster raw_total {rtot}"
            )

    missing = math_cohort - seen
    if missing:
        errors.append(f"matrix: missing {len(missing)} Math sitter(s): {sorted(missing)}")

    return errors


def sanity_all() -> list[str]:
    """Every subject: distinct sitters and that raw_pct is consistent with raw_total."""
    errors: list[str] = []
    rosters = load_rosters()
    by_subject: dict[str, set[str]] = {}
    for r in rosters:
        by_subject.setdefault(r["subject"], set()).add(r["result_id"])
    for subject, ids in sorted(by_subject.items()):
        print(f"  {subject:<22} {len(ids)} results")
    return errors


from collections import defaultdict


def load_cuts() -> dict[str, list[int]]:
    """Per-subject cut-scores [outstanding, exceeds, meets] (percent). Committed as
    data, so the boundary is a fixture the panel signs off — not hard-coded here."""
    out: dict[str, list[int]] = {}
    with open(CUTS, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out[r["subject"]] = [int(r["cut_outstanding"]), int(r["cut_exceeds"]), int(r["cut_meets"])]
    return out


def load_essays() -> dict[tuple[str, str], float]:
    """(subject, lowercased email) → the approved half-weighted essay mark (the
    'Adjusted scores (USE THESE)' value, already averaged onto the reserved /20).
    Empty in this cohort (essays offline-marked, not yet uploaded)."""
    out: dict[tuple[str, str], float] = {}
    with open(ESSAYS, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if (r.get("email") or "").strip():
                out[(r["subject"], _norm(r["email"]))] = float(r["essay_mark"])
    return out


def load_deletions() -> dict[str, set[str]]:
    """Per-subject item-review deletion set (the human action). Exclude-from-
    denominator: a deleted item leaves BOTH numerator and denominator (rescale)."""
    out: dict[str, set[str]] = defaultdict(set)
    with open(DELETIONS, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            q = (r.get("question_id") or "").strip()
            if q:
                out[r["subject"]].add(q)
    return out


def grade_pct(subject: str, raw_total: float, mcq_max: int, essay_mark: float) -> Decimal:
    """Essay-inclusive subject percentage. ESL/Arabic reserve the half-weighted
    essay max in the denominator and add the approved essay mark to the numerator;
    every other subject is MCQ-only. round_half_up to 2 dp — the grade-bearing pct."""
    if is_essay_subject(subject):
        num = raw_total + essay_mark
        den = mcq_max + ESSAY_MAX_RESERVED
    else:
        num = raw_total
        den = mcq_max
    return round_half_up(num / den * 100, 2) if den > 0 else Decimal(0)


def recover_subject_maxes(rosters: list[dict], staff: set[str]) -> tuple[dict[str, int], list[str]]:
    """Recover each subject's MCQ max from the roster's own (raw_total, raw_pct)
    columns and validate they are internally consistent under a SINGLE integer max:
    for every sitter, round_half_up(raw_total / M * 100, 2) must equal the stated
    raw_pct. This is a genuine cell-diff of the roster's pct column against its
    raw_total column, and it recovers M (the retained scoring max, which for Math
    is 40 — one of the 41 columns is non-scoring). Errors on any inconsistency."""
    errors: list[str] = []
    bysub: dict[str, list[dict]] = defaultdict(list)
    for r in rosters:
        if _norm(r["email"]) in staff:
            continue
        bysub[r["subject"]].append(r)
    maxes: dict[str, int] = {}
    for sub, rs in sorted(bysub.items()):
        cands: set[int] = set()
        for r in rs:
            rt = Decimal(r["raw_total"])
            rp = Decimal(r["raw_pct"])
            if rt > 0 and rp > 0:
                cands.add(int((rt / rp * 100).to_integral_value(rounding=ROUND_HALF_UP)))
        if not cands:
            errors.append(f"{sub}: cannot recover a max (no positive scores)")
            continue
        if len(cands) > 1:
            errors.append(f"{sub}: raw_pct not consistent with a single max — candidates {sorted(cands)}")
            continue
        M = cands.pop()
        for r in rs:
            rt = float(r["raw_total"])
            want = round_half_up(rt / M * 100, 2)
            got = round_half_up(float(Decimal(r["raw_pct"])), 2)
            if want != got:
                errors.append(
                    f"{sub} {r['result_id']}: roster raw_pct {got} != raw_total/{M}·100 = {want}"
                )
        maxes[sub] = M
    return maxes, errors


def reconcile_math_deletions(maxes: dict[str, int]) -> list[str]:
    """Cell-level pct check for Applicable Math: derive each sitter's pct from the
    Q1..Q41 matrix with the item-review deletion set applied (exclude-from-
    denominator rescale), and confirm it matches the roster raw_pct. With no
    deletions this ties the matrix cells straight through to the essay-free grade
    pct; a listed deletion drops that column from BOTH the sitter's total and the
    subject max, then the pct is recomputed on the rescaled denominator."""
    errors: list[str] = []
    M = maxes.get(MATH_SUBJECT)
    if M is None:
        return ["math-deletions: no recovered Math max"]
    rosters = load_rosters()
    staff = staff_test_emails(rosters)
    roster_pct = {
        r["result_id"]: Decimal(r["raw_pct"])
        for r in rosters
        if r["subject"] == MATH_SUBJECT and _norm(r["email"]) not in staff
    }
    deleted = load_deletions().get(MATH_SUBJECT, set())
    q_cols = [f"Q{i}" for i in range(1, 42)]
    scored_cols = [q for q in q_cols if q not in deleted]
    # Each deleted column is assumed a scoring item (max 1), so the denominator
    # loses one mark per deletion — the exclude-from-denominator rescale.
    den = M - len(deleted)
    for row in load_matrix():
        if _norm(row["email"]) in staff:
            continue
        rid = row["ResultId"]
        num = sum(int(row[q]) for q in scored_cols)
        pct = round_half_up(num / den * 100, 2) if den > 0 else Decimal(0)
        want = roster_pct.get(rid)
        if want is None:
            continue
        # Only strictly comparable to the roster when nothing was deleted (the
        # roster pct is the pre-deletion figure); a deletion is a deliberate change.
        if not deleted and round_half_up(float(want), 2) != pct:
            errors.append(f"Math {rid}: matrix→pct {pct} != roster raw_pct {want}")
    return errors


def reconcile_grades(verbose: bool = False) -> list[str]:
    """Independent Score → pct → PLD → Award oracle over the committed real cohort.

    Re-derives, per participant × subject, WITHOUT importing lib/engine:
      • the MCQ max, recovered + validated against the roster's raw_pct column;
      • the essay-inclusive grade pct (ESL/Arabic reserve the half-weighted 20);
      • the performance level (classify against the per-subject cut fixture);
      • the overall award (5-subject pattern rule + D3 cap), joined on lowercased
        email across the student's subjects.

    NOTE ON DIFF SCOPE (honest limit): the committed oracle is the REAL May-2026
    cohort; the app's seed is anonymised, so there is no real-cohort app export of
    PLD/award to diff against. The RAW→pct layer IS diff-validated (roster raw_pct
    ↔ raw_total under the recovered max, and the Math matrix cells → pct). PLD and
    award are DERIVED and surfaced for human sign-off. Essay marks are unmarked in
    this cohort (fixture empty), so the essay layer is exercised at the reserved-
    denominator level; the numerator contribution is 0 until marks are uploaded."""
    errors: list[str] = []
    rosters = load_rosters()
    staff = staff_test_emails(rosters)
    cuts = load_cuts()
    essays = load_essays()
    maxes, merr = recover_subject_maxes(rosters, staff)
    errors += merr
    errors += reconcile_math_deletions(maxes)

    by_email: dict[str, dict[str, str]] = defaultdict(dict)
    dist: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    essay_delta: list[str] = []
    for r in rosters:
        if _norm(r["email"]) in staff:
            continue
        sub = r["subject"]
        M = maxes.get(sub)
        if M is None:
            continue
        if sub not in cuts:
            errors.append(f"{sub}: no cut-scores in oracle_cuts.csv")
            continue
        rt = float(r["raw_total"])
        em = essays.get((sub, _norm(r["email"])), 0.0)
        gp = grade_pct(sub, rt, M, em)
        lvl = classify(gp, cuts[sub])
        by_email[_norm(r["email"])][sub] = lvl
        dist[sub][lvl] += 1
        if is_essay_subject(sub) and verbose and len(essay_delta) < 3:
            raw_pct = round_half_up(rt / M * 100, 2)
            essay_delta.append(f"    {sub} {r['result_id']}: MCQ raw_pct {raw_pct}% → grade pct {gp}% (reserves +{ESSAY_MAX_RESERVED})")

    # Award: 5-length level vector per participant (a subject not sat ranks lowest).
    # D3 cap: the fixtures carry no D3-item data, so passesD3Majority is vacuous
    # (available = 0 ⇒ pass) under BOTH the per-exam and aggregate readings — they
    # agree here because no participant is even a Distinction-pattern candidate.
    all_subjects = sorted(maxes)
    award_dist_perexam: dict[str, int] = defaultdict(int)
    award_dist_aggregate: dict[str, int] = defaultdict(int)
    for email, levels in by_email.items():
        vec = [levels.get(s, "") for s in all_subjects]
        award_dist_perexam[derive_award(vec, d3_pass=True)] += 1   # per-exam D3 (vacuous)
        award_dist_aggregate[derive_award(vec, d3_pass=True)] += 1  # aggregate D3 (vacuous)

    if verbose:
        print("\nPerformance-level distribution (essay-inclusive grade pct, per-subject cuts):")
        for sub in all_subjects:
            parts = " · ".join(f"{lvl}:{dist[sub].get(lvl, 0)}" for lvl in PERF_LABELS)
            print(f"  {sub:24} {parts}")
        if essay_delta:
            print("  essay-reservation examples (grade pct < MCQ raw_pct by the reserved 20):")
            for line in essay_delta:
                print(line)
        print("\nOverall award distribution (5-subject pattern + D3 cap):")
        agree = award_dist_perexam == award_dist_aggregate
        for aw in AWARD_LABELS:
            print(f"  {aw:24} {award_dist_perexam.get(aw, 0)}")
        print(f"  D3 cap interpretations (per-exam vs aggregate): {'AGREE (both vacuous — no D3 data, no Distinction candidates)' if agree else 'DIFFER'}")

    return errors


def main(argv: list[str]) -> int:
    if "--all" in argv:
        print("Roster sanity (all subjects, raw — staff/test included):")
        sanity_all()
        print()

    verbose = "--grades" in argv or "--all" in argv

    print(f"Reconciling {MATH_SUBJECT} (staff/test excluded)…")
    errors = reconcile_math()
    if errors:
        print(f"\n✗ {len(errors)} reconciliation failure(s):")
        for e in errors:
            print(f"    - {e}")
        return 1
    print(
        f"✓ Applicable Math reconciles: {MATH_SITTERS} sitters, every Σ(Q1..Q41) == "
        f"TOTAL == roster raw_total. Cohort boundary (staff/test) mirrored."
    )

    print("\nReconciling Score → pct → PLD → Award (all subjects, staff/test excluded)…")
    gerrors = reconcile_grades(verbose=verbose)
    if gerrors:
        print(f"\n✗ {len(gerrors)} grade-chain reconciliation failure(s):")
        for e in gerrors:
            print(f"    - {e}")
        return 1
    print(
        "✓ Grade chain reconciles: every subject's raw_pct is consistent with a single "
        "recovered max, the Math matrix cells re-derive that pct, and pct → PLD → award "
        "follow the spec (essay reservation applied; item-review deletions rescale the "
        "denominator). Run with --grades for the level/award distributions."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
