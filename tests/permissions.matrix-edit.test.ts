/**
 * P3 — editing the matrix changes live enforcement. Toggling a permission via
 * `setRolePermission` immediately changes `can()` for that tier AND the provider
 * gates that read the map (P2). The admin-locked cell can never be ungranted from
 * the UI/provider (the RPC refuses it too, as defence in depth).
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/types";

const CYCLE = "may-2026";
const ADMIN: CurrentUser = { id: "a", name: "Admin", initials: "A", role: "lead_admin" };
const ANALYST: CurrentUser = { id: "n", name: "Ana", initials: "AN", role: "analyst" };

const firstAssessment = (p: InMemoryDataProvider) => p.getGrades(CYCLE)!.assessments[0]!.id;

describe("toggling a permission changes can() and enforcement for that tier", () => {
  it("ungranting analyst `boundaries` disables cut-score editing for an analyst", () => {
    const p = new InMemoryDataProvider(); // default user is admin

    // Baseline: analyst holds `boundaries` by default.
    expect(can("analyst", "boundaries", p.getRolePermissions())).toBe(true);

    // Admin ungrants it.
    p.setRolePermission("analyst", "boundaries", false);
    expect(can("analyst", "boundaries", p.getRolePermissions())).toBe(false);

    // Enforcement follows: as an analyst, setBoundary is now a no-op.
    p.setCurrentUser(ANALYST);
    const aid = firstAssessment(p);
    const before = JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts);
    p.setBoundary(CYCLE, aid, { cuts: [5, 3, 1] });
    expect(JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts)).toBe(before); // unchanged

    // Admin grants it back → analyst can edit again.
    p.setCurrentUser(ADMIN);
    p.setRolePermission("analyst", "boundaries", true);
    p.setCurrentUser(ANALYST);
    p.setBoundary(CYCLE, aid, { cuts: [5, 3, 1] });
    expect(JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts)).not.toBe(before); // changed
  });

  it("granting team_member `signoff` lets a team member lock the sitting", () => {
    const p = new InMemoryDataProvider();
    expect(can("team_member", "signoff", p.getRolePermissions())).toBe(false);
    p.setRolePermission("team_member", "signoff", true);

    p.setCurrentUser({ id: "t", name: "Tam", initials: "T", role: "reviewer" });
    p.lockCycle(CYCLE);
    expect(p.getCycle(CYCLE)!.locked).toBe(true);
  });
});

describe("the admin-locked cell can never be ungranted", () => {
  it("refuses ungranting admin/workspace_admin (provider no-op)", () => {
    const p = new InMemoryDataProvider();
    p.setRolePermission("admin", "workspace_admin", false);
    expect(p.getRolePermissions().admin.has("workspace_admin")).toBe(true);
    expect(can("admin", "workspace_admin", p.getRolePermissions())).toBe(true);
  });

  it("a non-admin cannot edit the matrix at all", () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser(ANALYST);
    p.setRolePermission("team_member", "boundaries", true);
    expect(p.getRolePermissions().team_member.has("boundaries")).toBe(false);
  });
});
