/**
 * Formula evaluation + capping. Locks the add-only / capped semantics and the
 * canonical "+0.5 per 5 minutes" behaviour (block vs pro-rata), plus the two
 * ceilings: the per-incident cap and the per-student global cap.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateFormula,
  evaluateCapped,
  capStudentTotal,
  describeFormula,
} from "@/lib/incidents/formula";

describe("evaluateFormula", () => {
  it("fixed → the flat marks", () => {
    expect(evaluateFormula({ kind: "fixed", marks: 2 })).toBe(2);
  });

  it("per_duration block (default) grants whole completed units only", () => {
    const f = { kind: "per_duration" as const, marksPerUnit: 0.5, perMinutes: 5 };
    expect(evaluateFormula(f, { durationMinutes: 12 })).toBe(1); // floor(12/5)=2 → 1.0
    expect(evaluateFormula(f, { durationMinutes: 4 })).toBe(0); // < one block
    expect(evaluateFormula(f, { durationMinutes: 0 })).toBe(0);
  });

  it("per_duration proportional grants a continuous rate", () => {
    const f = { kind: "per_duration" as const, marksPerUnit: 0.5, perMinutes: 5, rounding: "proportional" as const };
    expect(evaluateFormula(f, { durationMinutes: 12 })).toBeCloseTo(1.2, 5); // 12/5*0.5
  });

  it("pct_section → percent of the scored section max", () => {
    expect(evaluateFormula({ kind: "pct_section", percent: 10, basis: "assessment" }, { sectionMax: 50 })).toBe(5);
    // no section max supplied → grants nothing rather than guessing
    expect(evaluateFormula({ kind: "pct_section", percent: 10, basis: "assessment" })).toBe(0);
  });

  it("never returns a negative (add-only guard even on bad config)", () => {
    expect(evaluateFormula({ kind: "fixed", marks: -3 })).toBe(0);
  });
});

describe("evaluateCapped — per-incident ceiling", () => {
  it("clamps the grant to the code's cap", () => {
    const f = { kind: "per_duration" as const, marksPerUnit: 0.5, perMinutes: 5 };
    // 40 min → floor(40/5)=8 units → 4.0 marks, capped to 3
    expect(evaluateCapped(f, 3, { durationMinutes: 40 })).toBe(3);
    // under the cap → passes through
    expect(evaluateCapped(f, 3, { durationMinutes: 10 })).toBe(1);
  });

  it("a cap of 0 grants nothing", () => {
    expect(evaluateCapped({ kind: "fixed", marks: 5 }, 0)).toBe(0);
  });
});

describe("capStudentTotal — per-student global ceiling", () => {
  it("clamps a student's summed marks to the global cap", () => {
    expect(capStudentTotal(7, 5)).toBe(5);
    expect(capStudentTotal(3, 5)).toBe(3);
  });
  it("null = no global cap", () => {
    expect(capStudentTotal(99, null)).toBe(99);
  });
  it("never returns negative", () => {
    expect(capStudentTotal(-4, 5)).toBe(0);
  });
});

describe("describeFormula", () => {
  it("renders a short human summary for each kind", () => {
    expect(describeFormula({ kind: "fixed", marks: 1 })).toMatch(/\+1 mark/);
    expect(describeFormula({ kind: "per_duration", marksPerUnit: 0.5, perMinutes: 5 })).toMatch(/\+0\.5 per 5 min/);
    expect(describeFormula({ kind: "pct_section", percent: 5, basis: "assessment" })).toMatch(/5% of subject/);
  });
});
