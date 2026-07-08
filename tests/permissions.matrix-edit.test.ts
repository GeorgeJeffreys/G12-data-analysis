/**
 * Editing role grants changes live enforcement (0039). Granting/revoking a
 * PERMISSION to a tier via `setRoleGrant` immediately changes the tier's resolved
 * capabilities AND the provider gates that read them. The Workspace-administration
 * grant can never be revoked from admin (the RPC refuses it too).
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { can, guardsWorkspaceAdmin, SEED_PERMISSION_IDS } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/types";

const CYCLE = "may-2026";
const ADMIN: CurrentUser = { id: "a", name: "Admin", initials: "A", role: "lead_admin" };
const ANALYST: CurrentUser = { id: "n", name: "Ana", initials: "AN", role: "analyst" };

const firstAssessment = (p: InMemoryDataProvider) => p.getGrades(CYCLE)!.assessments[0]!.id;
const resolved = (p: InMemoryDataProvider) => {
  // Re-resolve from the provider's live permissions + grants for assertions.
  const perms = new Map(p.getPermissions().map((x) => [x.id, x]));
  const capsFor = (tier: "team_member" | "analyst" | "admin") =>
    new Set(p.getRoleGrants()[tier].flatMap((id) => perms.get(id)?.capabilities ?? []));
  return { team_member: capsFor("team_member"), analyst: capsFor("analyst"), admin: capsFor("admin") };
};

describe("granting/revoking a permission changes enforcement for that tier", () => {
  it("revoking the Cut-scores permission from analyst disables cut-score editing", () => {
    const p = new InMemoryDataProvider(); // default user is admin
    expect(resolved(p).analyst.has("boundaries")).toBe(true);

    p.setRoleGrant("analyst", SEED_PERMISSION_IDS.boundaries, false);
    expect(resolved(p).analyst.has("boundaries")).toBe(false);

    // Enforcement follows: as an analyst, setBoundary is now a no-op.
    p.setCurrentUser(ANALYST);
    const aid = firstAssessment(p);
    const before = JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts);
    p.setBoundary(CYCLE, aid, { cuts: [5, 3, 1] });
    expect(JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts)).toBe(before); // unchanged

    // Admin grants it back → analyst can edit again.
    p.setCurrentUser(ADMIN);
    p.setRoleGrant("analyst", SEED_PERMISSION_IDS.boundaries, true);
    p.setCurrentUser(ANALYST);
    p.setBoundary(CYCLE, aid, { cuts: [5, 3, 1] });
    expect(JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts)).not.toBe(before); // changed
  });

  it("granting the Sign-off permission to team_member lets a team member lock", () => {
    const p = new InMemoryDataProvider();
    expect(resolved(p).team_member.has("signoff")).toBe(false);
    p.setRoleGrant("team_member", SEED_PERMISSION_IDS.signoff, true);

    p.setCurrentUser({ id: "t", name: "Tam", initials: "T", role: "reviewer" });
    p.lockCycle(CYCLE);
    expect(p.getCycle(CYCLE)!.locked).toBe(true);
  });

  it("a newly composed permission takes effect once granted", () => {
    const p = new InMemoryDataProvider();
    p.createPermission("Cut scores for team", "", ["boundaries"]);
    const perm = p.getPermissions().find((x) => x.name === "Cut scores for team")!;
    expect(resolved(p).team_member.has("boundaries")).toBe(false);
    p.setRoleGrant("team_member", perm.id, true);
    expect(resolved(p).team_member.has("boundaries")).toBe(true);
  });

  it("editing a permission's capabilities changes what its holders can do", () => {
    const p = new InMemoryDataProvider();
    p.createPermission("Marker", "", ["adjust"]);
    const perm = p.getPermissions().find((x) => x.name === "Marker")!;
    p.setRoleGrant("team_member", perm.id, true);
    expect(resolved(p).team_member.has("adjust")).toBe(true);
    expect(resolved(p).team_member.has("boundaries")).toBe(false);
    // Add Cut scores to the same permission → holders gain it.
    p.updatePermission(perm.id, "Marker", "", ["adjust", "boundaries"]);
    expect(resolved(p).team_member.has("boundaries")).toBe(true);
  });

  it("deleting a permission revokes its capabilities from every holder", () => {
    const p = new InMemoryDataProvider();
    p.createPermission("Marker", "", ["adjust", "boundaries"]);
    const perm = p.getPermissions().find((x) => x.name === "Marker")!;
    p.setRoleGrant("team_member", perm.id, true);
    expect(resolved(p).team_member.has("boundaries")).toBe(true);
    p.deletePermission(perm.id);
    // team_member keeps its seeded adjust (from the Adjustments permission) but
    // loses boundaries, which only the deleted permission granted.
    expect(p.getPermissions().some((x) => x.id === perm.id)).toBe(false);
    expect(resolved(p).team_member.has("boundaries")).toBe(false);
    expect(resolved(p).team_member.has("adjust")).toBe(true);
  });
});

describe("the Workspace-administration grant can never be revoked from admin", () => {
  it("refuses revoking it from admin (provider no-op)", () => {
    const p = new InMemoryDataProvider();
    const wsId = p.getPermissions().find((x) => guardsWorkspaceAdmin(x))!.id;
    p.setRoleGrant("admin", wsId, false);
    expect(p.getRoleGrants().admin).toContain(wsId);
    expect(can("lead_admin", "workspace_admin")).toBe(true);
  });

  it("a non-admin cannot edit grants at all", () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser(ANALYST);
    p.setRoleGrant("team_member", SEED_PERMISSION_IDS.boundaries, true);
    expect(resolved(p).team_member.has("boundaries")).toBe(false);
  });
});
