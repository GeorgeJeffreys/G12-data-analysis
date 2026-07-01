/**
 * Incident-code registry — validation (add-only + caps) and classification.
 * The config layer is the place the two safety invariants are enforced, so these
 * lock them: no negative grant survives validation, every code needs a cap, and
 * an unmatched incident type is classified as null (→ the unclassified bucket).
 */
import { describe, it, expect } from "vitest";
import {
  defaultIncidentConfig,
  validateIncidentCode,
  validateFormula,
  validatePerStudentCap,
  normalizeIncidentCode,
  classifyIncidentType,
  DEFAULT_INCIDENT_CODES,
} from "@/lib/incidents/config";
import type { IncidentCodeInput } from "@/lib/incidents/types";

const good: IncidentCodeInput = {
  code: "CALC_FAIL",
  label: "Calculator failure",
  matchTypes: ["calculator broke"],
  formula: { kind: "per_duration", marksPerUnit: 0.5, perMinutes: 5 },
  perCodeCap: 3,
};

describe("validateIncidentCode — add-only + structure", () => {
  it("accepts a well-formed code", () => {
    expect(validateIncidentCode(good, [])).toEqual([]);
  });

  it("rejects a negative fixed mark (add-only)", () => {
    const errs = validateIncidentCode({ ...good, formula: { kind: "fixed", marks: -1 } }, []);
    expect(errs.join(" ")).toMatch(/add-only|≥ 0/i);
  });

  it("rejects a negative per-unit rate and a non-positive duration unit", () => {
    expect(validateFormula({ kind: "per_duration", marksPerUnit: -0.5, perMinutes: 5 }).length).toBeGreaterThan(0);
    expect(validateFormula({ kind: "per_duration", marksPerUnit: 0.5, perMinutes: 0 }).length).toBeGreaterThan(0);
  });

  it("rejects a negative or >100 percent", () => {
    expect(validateFormula({ kind: "pct_section", percent: -1, basis: "assessment" }).length).toBeGreaterThan(0);
    expect(validateFormula({ kind: "pct_section", percent: 101, basis: "assessment" }).length).toBeGreaterThan(0);
  });

  it("rejects a negative per-incident cap (every code must carry a ≥0 ceiling)", () => {
    expect(validateIncidentCode({ ...good, perCodeCap: -2 }, []).join(" ")).toMatch(/cap/i);
  });

  it("requires a code, label and at least one match type", () => {
    expect(validateIncidentCode({ ...good, code: "" }, []).join(" ")).toMatch(/code is required/i);
    expect(validateIncidentCode({ ...good, label: "" }, []).join(" ")).toMatch(/label is required/i);
    expect(validateIncidentCode({ ...good, matchTypes: [] }, []).join(" ")).toMatch(/at least one/i);
  });

  it("rejects a duplicate code (case-insensitive), ignoring itself", () => {
    const existing = [normalizeIncidentCode(good, "id-1")];
    expect(validateIncidentCode({ ...good, code: "calc_fail" }, existing).join(" ")).toMatch(/already in use/i);
    // same id → editing itself, not a duplicate
    expect(validateIncidentCode({ ...good, id: "id-1", code: "calc_fail" }, existing)).toEqual([]);
  });
});

describe("validatePerStudentCap", () => {
  it("allows null (no cap) and any ≥0 number; rejects negatives", () => {
    expect(validatePerStudentCap(null)).toEqual([]);
    expect(validatePerStudentCap(5)).toEqual([]);
    expect(validatePerStudentCap(-1).length).toBeGreaterThan(0);
  });
});

describe("normalizeIncidentCode", () => {
  it("trims + de-dupes match types (case-insensitively) and defaults active", () => {
    const c = normalizeIncidentCode(
      { ...good, matchTypes: [" calculator broke ", "Calculator Broke", "device failure"] },
      "id-x",
    );
    expect(c.matchTypes).toEqual(["calculator broke", "device failure"]);
    expect(c.active).toBe(true);
  });
});

describe("classifyIncidentType — bucketing", () => {
  const codes = defaultIncidentConfig().codes;

  it("matches an incident type case-insensitively to its code", () => {
    expect(classifyIncidentType("Calculator Broke", codes)?.code).toBe("CALC_FAIL");
    expect(classifyIncidentType("  projector flicker ", codes)?.code).toBe("ROOM_DISRUPT");
  });

  it("returns null for an unmatched type (→ unclassified bucket, never dropped)", () => {
    expect(classifyIncidentType("meteor strike", codes)).toBeNull();
    expect(classifyIncidentType("", codes)).toBeNull();
  });

  it("never matches an inactive code", () => {
    const inactive = codes.map((c) => ({ ...c, active: false }));
    expect(classifyIncidentType("calculator broke", inactive)).toBeNull();
  });
});

describe("defaults", () => {
  it("ships the canonical calculator example (+0.5 per 5 min, capped)", () => {
    const calc = DEFAULT_INCIDENT_CODES.find((c) => c.code === "CALC_FAIL")!;
    expect(calc.formula).toMatchObject({ kind: "per_duration", marksPerUnit: 0.5, perMinutes: 5 });
    expect(calc.perCodeCap).toBeGreaterThan(0);
  });
});
