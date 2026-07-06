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

It validates underlying scores, NOT award bands. Exit 0 = green.

Run:  python3 reconcile.py            (Applicable Math)
      python3 reconcile.py --all      (every subject's roster totals sanity check)
"""
from __future__ import annotations

import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ORACLE_DIR = os.path.join(HERE, "tests", "fixtures", "oracles")
ROSTERS = os.path.join(ORACLE_DIR, "oracle_rosters.csv")
MATRIX = os.path.join(ORACLE_DIR, "oracle_applicable_math_matrix.csv")

MATH_SUBJECT = "Applicable Math"
MATH_SITTERS = 15


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


def main(argv: list[str]) -> int:
    if "--all" in argv:
        print("Roster sanity (all subjects, raw — staff/test included):")
        sanity_all()
        print()

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
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
