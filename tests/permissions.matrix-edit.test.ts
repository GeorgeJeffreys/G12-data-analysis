/**
 * Editing the role × action grid changes live enforcement (migration 0040), and the
 * four lockout guards + the member-role assignment behave (client mirror of the RPCs).
 *
 * Covers: (b) create_role → grant an action → `can()` reflects it; delete_role is
 * blocked while the role has members and allowed once empty. (c) all four lockout
 * guards reject (delete Admin; un-grant manage_roles / manage_users from Admin;
 * orphan manage_roles). (d) set_member_role assigns and enforcement follows.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { can, resolveRoleActions } from "@/lib/auth/actions";
import type { CurrentUser } from "@/lib/data/types";

const CYCLE = "may-2026";
const ADMIN: CurrentUser = { id: "a", name: "Admin", initials: "A", role: "lead_admin" };
const ANALYST: CurrentUser = { id: "n", name: "Ana", initials: "AN", role: "analyst" };

const firstAssessment = (p: InMemoryDataProvider) => p.getGrades(CYCLE)!.assessments[0]!.id;
/** Re-resolve the live grid from the provider for assertions. */
const grid = (p: InMemoryDataProvider) => resolveRoleActions(p.getRoles(), p.getRoleActions());
const roleIdByName = (p: InMemoryDataProvider, name: string) => p.getRoles().find((r) => r.name === name)!.id;

describe("editing a cell changes enforcement for that role", () => {
  it("revoking cuts.set from analyst disables cut-score editing; granting it back re-enables", () => {
    const p = new InMemoryDataProvider(); // default user is admin
    expect(grid(p).analyst!.has("cuts.set")).toBe(true);

    p.setRoleAction("analyst", "cuts.set", false);
    expect(grid(p).analyst!.has("cuts.set")).toBe(false);

    p.setCurrentUser(ANALYST);
    const aid = firstAssessment(p);
    const before = JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts);
    p.setBoundary(CYCLE, aid, { cuts: [5, 3, 1] });
    expect(JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts)).toBe(before); // unchanged

    p.setCurrentUser(ADMIN);
    p.setRoleAction("analyst", "cuts.set", true);
    p.setCurrentUser(ANALYST);
    p.setBoundary(CYCLE, aid, { cuts: [5, 3, 1] });
    expect(JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts)).not.toBe(before); // changed
  });

  it("granting general.signoff to team_member lets a team member lock", () => {
    const p = new InMemoryDataProvider();
    expect(grid(p).team_member!.has("general.signoff")).toBe(false);
    p.setRoleAction("team_member", "general.signoff", true);

    p.setCurrentUser({ id: "t", name: "Tam", initials: "T", role: "reviewer" });
    p.lockCycle(CYCLE);
    expect(p.getCycle(CYCLE)!.locked).toBe(true);
  });
});

describe("(b) create a role, grant an action, and it takes effect", () => {
  it("a new empty role gains an action once granted", () => {
    const p = new InMemoryDataProvider();
    p.createRole("Marker");
    const id = roleIdByName(p, "Marker");
    expect(p.getRoleActions()[id]).toEqual([]);
    expect(can({ roleId: id }, "cuts.set", grid(p))).toBe(false);

    p.setRoleAction(id, "cuts.set", true);
    expect(can({ roleId: id }, "cuts.set", grid(p))).toBe(true);
  });

  it("delete_role is blocked while the role has members, allowed once empty", () => {
    const p = new InMemoryDataProvider();
    p.createRole("Marker");
    const id = roleIdByName(p, "Marker");
    p.inviteMember("marker@example.com", id);
    const memberId = p.getMembers().members.find((m) => m.roleId === id)!.id;

    // Blocked: the role still has a member.
    p.deleteRole(id);
    expect(p.getRoles().some((r) => r.id === id)).toBe(true);

    // Reassign the member away, then delete succeeds.
    p.setMemberRole(memberId, "team_member");
    p.deleteRole(id);
    expect(p.getRoles().some((r) => r.id === id)).toBe(false);
  });
});

describe("(c) the four lockout guards", () => {
  const adminRoleId = (p: InMemoryDataProvider) => p.getRoles().find((r) => r.isSystem)!.id;

  it("the Admin system role is undeletable", () => {
    const p = new InMemoryDataProvider();
    const id = adminRoleId(p);
    p.deleteRole(id);
    expect(p.getRoles().some((r) => r.id === id)).toBe(true);
  });

  it("Admin's manage_roles cell cannot be turned off", () => {
    const p = new InMemoryDataProvider();
    p.setRoleAction(adminRoleId(p), "general.manage_roles", false);
    expect(grid(p).admin!.has("general.manage_roles")).toBe(true);
  });

  it("Admin's manage_users cell cannot be turned off", () => {
    const p = new InMemoryDataProvider();
    p.setRoleAction(adminRoleId(p), "general.manage_users", false);
    expect(grid(p).admin!.has("general.manage_users")).toBe(true);
  });

  it("un-granting manage_roles is refused when Admin is the only holder (no orphan)", () => {
    const p = new InMemoryDataProvider();
    // Admin is the only seeded holder of manage_roles; turning it off would orphan it.
    p.setRoleAction(adminRoleId(p), "general.manage_roles", false);
    expect(grid(p).admin!.has("general.manage_roles")).toBe(true);
    // With a second holder, the guard no longer trips for that OTHER role.
    p.createRole("Co-admin");
    const co = roleIdByName(p, "Co-admin");
    p.setRoleAction(co, "general.manage_roles", true);
    p.setRoleAction(co, "general.manage_roles", false); // allowed — Admin still holds it
    expect(grid(p)[co]!.has("general.manage_roles")).toBe(false);
    expect(grid(p).admin!.has("general.manage_roles")).toBe(true);
  });

  it("a non-admin cannot edit the grid at all", () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser(ANALYST);
    p.setRoleAction("team_member", "cuts.set", true);
    expect(grid(p).team_member!.has("cuts.set")).toBe(false);
  });
});

describe("(d) set_member_role assigns and enforcement follows", () => {
  it("assigns a member's role id and the effective grid follows", () => {
    const p = new InMemoryDataProvider();
    p.createRole("Cutter");
    const cutter = roleIdByName(p, "Cutter");
    p.setRoleAction(cutter, "cuts.set", true);

    p.inviteMember("cutter@example.com", "team_member");
    const memberId = p.getMembers().members.find((m) => m.email === "cutter@example.com")!.id;
    expect(p.getMembers().members.find((m) => m.id === memberId)!.roleId).toBe("team_member");

    p.setMemberRole(memberId, cutter);
    const member = p.getMembers().members.find((m) => m.id === memberId)!;
    expect(member.roleId).toBe(cutter);
    expect(member.roleName).toBe("Cutter");
    // Enforcement follows the assignment: the member's role now holds cuts.set.
    expect(can({ roleId: member.roleId }, "cuts.set", grid(p))).toBe(true);
    expect(can({ roleId: member.roleId }, "general.signoff", grid(p))).toBe(false);
  });
});
