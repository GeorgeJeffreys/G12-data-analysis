/**
 * Incident Adjustments — auto-apply engine (02b, grade-bearing).
 *
 * Verifies the three safety invariants IN THE APPLY PATH: per-code cap, per-student
 * global cap, and add-only (unclassified / errored / unmatched rows grant ZERO and
 * are surfaced, never applied, never reduce a score). Also verifies the result is
 * always decomposable — contributions sum to the uncapped total, and the applied
 * adjustment is the globally-capped figure.
 */
import { describe, it, expect } from "vitest";
import { computeStudentAdjustments, contributionFor } from "@/lib/incidents/apply";
import type { IncidentCode } from "@/lib/incidents/types";
import type { ResolvedIncidentRow } from "@/lib/incidents/import";

const CALC: IncidentCode = {
  id: "c-calc",
  code: "CALC_FAIL",
  label: "Calculator failure",
  matchTypes: ["calculator broke"],
  formula: { kind: "per_duration", marksPerUnit: 0.5, perMinutes: 5, rounding: "block" },
  perCodeCap: 3,
  active: true,
};
const ROOM: IncidentCode = {
  id: "c-room",
  code: "ROOM_DISRUPT",
  label: "Room disruption",
  matchTypes: ["fire alarm"],
  formula: { kind: "fixed", marks: 1 },
  perCodeCap: 2,
  active: true,
};
const PCT: IncidentCode = {
  id: "c-pct",
  code: "PCT",
  label: "Percent of section",
  matchTypes: ["mismarked section"],
  formula: { kind: "pct_section", percent: 10, basis: "assessment" },
  perCodeCap: 5,
  active: true,
};

let seq = 0;
function row(partial: Partial<ResolvedIncidentRow> & { incidentType: string; codeId: string | null }): ResolvedIncidentRow {
  seq += 1;
  return {
    rowNumber: partial.rowNumber ?? seq,
    rawStudentId: partial.rawStudentId ?? "stu-1",
    studentName: partial.studentName ?? "Student One",
    incidentType: partial.incidentType,
    questionNumber: partial.questionNumber ?? "Q1",
    durationMinutes: partial.durationMinutes ?? null,
    codeId: partial.codeId,
    status: partial.status ?? (partial.codeId ? "ok" : "unclassified"),
    errors: partial.errors ?? [],
    participantInternalId: partial.participantInternalId ?? "stu-1",
    matched: partial.matched ?? (partial.participantInternalId ?? "stu-1") !== null,
  };
}

/** Compute adjustments and return the single student's entry (asserts one exists). */
function firstOf(
  rows: readonly ResolvedIncidentRow[],
  codes: readonly IncidentCode[],
  perStudentCap: number | null,
) {
  const out = computeStudentAdjustments(rows, codes, perStudentCap);
  return out[0]!;
}

describe("incident apply — per-code cap", () => {
  it("clamps a per-duration incident to its per-incident ceiling and flags the hit", () => {
    // 40 min at +0.5 / 5 min (block) = 8 units = 4.0 raw → clamped to cap 3.
    const s = firstOf(
      [row({ incidentType: "calculator broke", codeId: CALC.id, durationMinutes: 40 })],
      [CALC],
      null,
    );
    expect(s.contributions[0]!.rawMarks).toBe(4);
    expect(s.contributions[0]!.marks).toBe(3);
    expect(s.contributions[0]!.perCodeCapHit).toBe(true);
    expect(s.uncappedTotal).toBe(3);
    expect(s.adjustment).toBe(3);
    expect(s.perStudentCapHit).toBe(false);
  });

  it("does not flag a cap that did not bind", () => {
    // 20 min = 4 units = 2.0 raw < cap 3.
    const s = firstOf(
      [row({ incidentType: "calculator broke", codeId: CALC.id, durationMinutes: 20 })],
      [CALC],
      null,
    );
    expect(s.contributions[0]!.marks).toBe(2);
    expect(s.contributions[0]!.perCodeCapHit).toBe(false);
  });
});

describe("incident apply — per-student global cap", () => {
  it("clamps the summed total to the global cap and flags the hit", () => {
    const rows = [
      row({ incidentType: "calculator broke", codeId: CALC.id, durationMinutes: 60 }), // 6→cap 3
      row({ incidentType: "fire alarm", codeId: ROOM.id }), // +1
      row({ incidentType: "fire alarm", codeId: ROOM.id }), // +1
    ];
    const s = firstOf(rows, [CALC, ROOM], 4);
    expect(s.uncappedTotal).toBe(5); // 3 + 1 + 1
    expect(s.adjustment).toBe(4); // global cap
    expect(s.perStudentCapHit).toBe(true);
  });

  it("null global cap means no global ceiling", () => {
    const rows = [
      row({ incidentType: "fire alarm", codeId: ROOM.id }),
      row({ incidentType: "fire alarm", codeId: ROOM.id }),
    ];
    const s = firstOf(rows, [ROOM], null);
    expect(s.adjustment).toBe(2);
    expect(s.perStudentCapHit).toBe(false);
  });
});

describe("incident apply — add-only, unclassified / errored / removed", () => {
  it("grants zero for an unclassified row and surfaces it", () => {
    const s = firstOf(
      [row({ incidentType: "spilled water", codeId: null, status: "unclassified" })],
      [CALC, ROOM],
      null,
    );
    expect(s.contributions[0]!.marks).toBe(0);
    expect(s.adjustment).toBe(0);
    expect(s.unclassifiedCount).toBe(1);
    expect(s.okCount).toBe(0);
  });

  it("grants zero for an errored row (e.g. missing duration) and surfaces it", () => {
    const s = firstOf(
      [row({ incidentType: "calculator broke", codeId: CALC.id, durationMinutes: null, status: "error", errors: ["needs a duration"] })],
      [CALC],
      null,
    );
    expect(s.contributions[0]!.marks).toBe(0);
    expect(s.contributions[0]!.errors).toContain("needs a duration");
    expect(s.errorCount).toBe(1);
    expect(s.adjustment).toBe(0);
  });

  it("treats a removed / inactive code as unclassified (zero), never negative", () => {
    const inactive: IncidentCode = { ...ROOM, active: false };
    const s = firstOf(
      [row({ incidentType: "fire alarm", codeId: ROOM.id, status: "ok" })],
      [inactive],
      null,
    );
    expect(s.contributions[0]!.marks).toBe(0);
    expect(s.adjustment).toBe(0);
    expect(s.adjustment).toBeGreaterThanOrEqual(0);
  });

  it("never produces a negative adjustment even with a mix of rows", () => {
    const rows = [
      row({ incidentType: "spilled water", codeId: null, status: "unclassified" }),
      row({ incidentType: "fire alarm", codeId: ROOM.id }),
    ];
    const s = firstOf(rows, [CALC, ROOM], null);
    expect(s.adjustment).toBe(1);
    expect(s.adjustment).toBeGreaterThanOrEqual(0);
  });
});

describe("incident apply — decomposability and grouping", () => {
  it("contributions sum to the uncapped total; adjustment is the capped figure", () => {
    const rows = [
      row({ incidentType: "calculator broke", codeId: CALC.id, durationMinutes: 15 }), // 3 units*0.5=1.5
      row({ incidentType: "fire alarm", codeId: ROOM.id }), // 1
    ];
    const s = firstOf(rows, [CALC, ROOM], 10);
    const sum = s.contributions.reduce((t, c) => t + c.marks, 0);
    expect(sum).toBeCloseTo(2.5, 6);
    expect(s.uncappedTotal).toBeCloseTo(2.5, 6);
    expect(s.adjustment).toBeCloseTo(2.5, 6);
  });

  it("groups multiple incidents per student and keeps separate students apart", () => {
    const rows = [
      row({ incidentType: "fire alarm", codeId: ROOM.id, participantInternalId: "A", rawStudentId: "A" }),
      row({ incidentType: "fire alarm", codeId: ROOM.id, participantInternalId: "A", rawStudentId: "A" }),
      row({ incidentType: "fire alarm", codeId: ROOM.id, participantInternalId: "B", rawStudentId: "B" }),
    ];
    const out = computeStudentAdjustments(rows, [ROOM], null);
    expect(out).toHaveLength(2);
    const a = out.find((x) => x.participantKey === "A")!;
    const b = out.find((x) => x.participantKey === "B")!;
    expect(a.adjustment).toBe(2);
    expect(b.adjustment).toBe(1);
  });
});

describe("incident apply — pct_section uses the engine scored denominator", () => {
  it("applies percent of the resolved section max, capped per code", () => {
    const c = contributionFor(
      row({ incidentType: "mismarked section", codeId: PCT.id }),
      new Map([[PCT.id, PCT]]),
      { sectionMaxFor: () => 40 }, // 10% of 40 = 4, < cap 5
    );
    expect(c.rawMarks).toBeCloseTo(4, 6);
    expect(c.marks).toBeCloseTo(4, 6);
    expect(c.perCodeCapHit).toBe(false);
  });

  it("grants nothing when no section max can be resolved (degrade, not guess)", () => {
    const c = contributionFor(
      row({ incidentType: "mismarked section", codeId: PCT.id }),
      new Map([[PCT.id, PCT]]),
      {}, // no resolver → sectionMax 0
    );
    expect(c.marks).toBe(0);
  });
});
