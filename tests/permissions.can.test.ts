/**
 * Permission foundation (lib/auth/permissions.ts) — P1 of the authorization
 * rebuild. Locks that:
 *   * `can()` agrees with ROLE_PERMISSION_DEFAULTS for every canonical tier (and
 *     resolves storage roles onto the right tier), both with and without a
 *     hydrated map;
 *   * the admin-locked lockout guard rejects ungranting admin/workspace_admin, in
 *     the in-memory provider's `setRolePermission` and in `isAdminLocked`.
 *
 * These are the twin of the DB `app.has_permission` / `set_role_permission`
 * (migration 0036); the SQL is text-asserted separately, this exercises the JS.
 */
import { describe, it, expect } from "vitest";
import {
  can,
  isAdminLocked,
  defaultRolePermissionMap,
  ADMIN_LOCKED_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSION_DEFAULTS,
  type Permission,
  type RoleTier,
} from "@/lib/auth/permissions";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { CurrentUser } from "@/lib/data/types";

const TIERS: RoleTier[] = ["team_member", "analyst", "admin"];

describe("can() matches ROLE_PERMISSION_DEFAULTS for every tier", () => {
  it("agrees with the defaults for all three tiers × all permissions (no hydrated map)", () => {
    for (const tier of TIERS) {
      for (const perm of PERMISSIONS) {
        expect(can(tier, perm)).toBe(ROLE_PERMISSION_DEFAULTS[tier].includes(perm));
      }
    }
  });

  it("agrees with the defaults when passed the default hydrated map", () => {
    const map = defaultRolePermissionMap();
    for (const tier of TIERS) {
      for (const perm of PERMISSIONS) {
        expect(can(tier, perm, map)).toBe(ROLE_PERMISSION_DEFAULTS[tier].includes(perm));
      }
    }
  });

  it("resolves storage roles onto their canonical tier", () => {
    // viewer/reviewer → team_member, analyst → analyst, lead_admin → admin.
    expect(can("viewer", "clean")).toBe(true);
    expect(can("reviewer", "clean")).toBe(true);
    expect(can("viewer", "boundaries")).toBe(false); // analyst-and-up
    expect(can("analyst", "boundaries")).toBe(true);
    expect(can("lead_admin", "workspace_admin")).toBe(true);
    expect(can("reviewer", "workspace_admin")).toBe(false);
  });

  it("admin holds every permission", () => {
    for (const perm of PERMISSIONS) expect(can("admin", perm)).toBe(true);
  });

  it("a hydrated map overrides the defaults", () => {
    const map = defaultRolePermissionMap();
    map.team_member.add("boundaries"); // grant beyond the default
    expect(can("team_member", "boundaries", map)).toBe(true);
    expect(can("team_member", "boundaries")).toBe(false); // default unchanged
  });
});

describe("admin-locked lockout guard", () => {
  it("workspace_admin is the admin-locked permission", () => {
    expect(ADMIN_LOCKED_PERMISSIONS).toEqual(["workspace_admin"]);
    expect(isAdminLocked("workspace_admin")).toBe(true);
    expect(isAdminLocked("view")).toBe(false);
  });

  function providerAs(role: CurrentUser["role"]): InMemoryDataProvider {
    const p = new InMemoryDataProvider();
    p.setCurrentUser({ id: "u", name: "U", initials: "U", role });
    return p;
  }

  it("refuses to ungrant admin/workspace_admin (stays granted)", () => {
    const p = providerAs("lead_admin");
    p.setRolePermission("admin", "workspace_admin", false);
    expect(p.getRolePermissions().admin.has("workspace_admin")).toBe(true);
    expect(can("admin", "workspace_admin", p.getRolePermissions())).toBe(true);
  });

  it("still allows toggling a non-locked admin permission", () => {
    const p = providerAs("lead_admin");
    p.setRolePermission("admin", "override", false);
    expect(p.getRolePermissions().admin.has("override")).toBe(false);
    p.setRolePermission("admin", "override", true);
    expect(p.getRolePermissions().admin.has("override")).toBe(true);
  });

  it("still allows ungranting workspace_admin from a non-admin tier", () => {
    const p = providerAs("lead_admin");
    // analyst doesn't have it by default; grant then ungrant to prove it's toggleable.
    p.setRolePermission("analyst", "workspace_admin", true);
    expect(p.getRolePermissions().analyst.has("workspace_admin")).toBe(true);
    p.setRolePermission("analyst", "workspace_admin", false);
    expect(p.getRolePermissions().analyst.has("workspace_admin")).toBe(false);
  });

  it("a non-admin caller cannot edit the matrix", () => {
    const p = providerAs("reviewer");
    p.setRolePermission("team_member", "boundaries", true);
    expect(p.getRolePermissions().team_member.has("boundaries")).toBe(false);
  });
});

describe("applyRolePermissions (hydration)", () => {
  it("overwrites the map from DB rows, honouring granted flags", () => {
    const p = new InMemoryDataProvider();
    p.applyRolePermissions([
      { tier: "team_member", permission: "view", granted: true },
      { tier: "team_member", permission: "clean", granted: false },
      { tier: "admin", permission: "workspace_admin", granted: true },
    ]);
    const map = p.getRolePermissions();
    expect(map.team_member.has("view")).toBe(true);
    expect(map.team_member.has("clean")).toBe(false);
    expect(map.team_member.has("adjust")).toBe(false); // absent row → not granted
    expect(map.admin.has("workspace_admin")).toBe(true);
  });

  it("empty rows (fresh DB) leave the defaults in place", () => {
    const p = new InMemoryDataProvider();
    p.applyRolePermissions([]);
    for (const tier of TIERS) {
      const map = p.getRolePermissions();
      const got = [...map[tier]].sort();
      const want = [...(ROLE_PERMISSION_DEFAULTS[tier] as Permission[])].sort();
      expect(got).toEqual(want);
    }
  });
});
