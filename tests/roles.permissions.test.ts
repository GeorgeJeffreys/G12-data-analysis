/**
 * The canonical role foundation (lib/auth/roles.ts) — the single hierarchy and
 * the two shared primitives every privilege gate reasons through.
 *
 * Locks the ordering (team_member < analyst < admin), that storage roles
 * (viewer/reviewer/analyst/lead_admin) collapse onto the right tier, and the
 * exact semantics of hasRole ("at least") and canOverride ("strictly higher").
 */
import { describe, it, expect } from "vitest";
import { ROLE_TIERS, roleRank, hasRole, canOverride } from "@/lib/auth/roles";
import type { MemberRole } from "@/lib/types/database";

const STORAGE: MemberRole[] = ["viewer", "reviewer", "analyst", "lead_admin"];

describe("canonical hierarchy", () => {
  it("orders the three tiers lowest → highest", () => {
    expect([...ROLE_TIERS]).toEqual(["team_member", "analyst", "admin"]);
    expect(roleRank("team_member")).toBe(1);
    expect(roleRank("analyst")).toBe(2);
    expect(roleRank("admin")).toBe(3);
  });

  it("collapses each storage role onto its canonical tier", () => {
    expect(roleRank("viewer")).toBe(1); // team member
    expect(roleRank("reviewer")).toBe(1); // team member (same tier as viewer)
    expect(roleRank("analyst")).toBe(2); // data analyst
    expect(roleRank("lead_admin")).toBe(3); // admin
  });
});

describe("hasRole — 'at least' bar", () => {
  it("admin-only gate: only lead_admin passes", () => {
    expect(hasRole("lead_admin", "admin")).toBe(true);
    expect(hasRole("analyst", "admin")).toBe(false);
    expect(hasRole("reviewer", "admin")).toBe(false);
    expect(hasRole("viewer", "admin")).toBe(false);
  });

  it("'at least analyst' gate: analyst and admin pass, team members don't", () => {
    expect(hasRole("lead_admin", "analyst")).toBe(true);
    expect(hasRole("analyst", "analyst")).toBe(true);
    expect(hasRole("reviewer", "analyst")).toBe(false);
    expect(hasRole("viewer", "analyst")).toBe(false);
  });

  it("everyone meets the team-member bar", () => {
    for (const r of STORAGE) expect(hasRole(r, "team_member")).toBe(true);
  });
});

describe("canOverride — strictly higher only", () => {
  it("admin overrides analyst and team members", () => {
    expect(canOverride("lead_admin", "analyst")).toBe(true);
    expect(canOverride("lead_admin", "reviewer")).toBe(true);
    expect(canOverride("lead_admin", "viewer")).toBe(true);
  });

  it("analyst overrides team members but not admin or another analyst", () => {
    expect(canOverride("analyst", "reviewer")).toBe(true);
    expect(canOverride("analyst", "viewer")).toBe(true);
    expect(canOverride("analyst", "analyst")).toBe(false);
    expect(canOverride("analyst", "lead_admin")).toBe(false);
  });

  it("nobody overrides an equal or higher role (incl. team-member sub-flavours)", () => {
    expect(canOverride("reviewer", "viewer")).toBe(false); // same tier
    expect(canOverride("viewer", "reviewer")).toBe(false); // same tier
    expect(canOverride("reviewer", "reviewer")).toBe(false);
    expect(canOverride("lead_admin", "lead_admin")).toBe(false);
    expect(canOverride("viewer", "lead_admin")).toBe(false);
  });
});
