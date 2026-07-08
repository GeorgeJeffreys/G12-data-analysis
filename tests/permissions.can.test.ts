/**
 * Configurable permissions (lib/auth/permissions.ts, migration 0039) — the
 * capability catalogue + admin-editable permission bundles + role grants.
 *
 * Locks: (a) the seeded permissions + grants reproduce the P1 default EFFECTIVE
 * access per tier (resolve role → granted permissions → capabilities); (b) the
 * override split resolves correctly; (c) the Workspace-administration lockout guard
 * rejects deleting / emptying / un-granting it from admin.
 */
import { describe, it, expect } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  DEFAULT_RESOLVED_GRANTS,
  can,
  resolveGrants,
  defaultPermissions,
  defaultRoleGrants,
  guardsWorkspaceAdmin,
  type Capability,
  type RoleTier,
} from "@/lib/auth/permissions";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { CurrentUser } from "@/lib/data/types";

const TIERS: RoleTier[] = ["team_member", "analyst", "admin"];

// The EFFECTIVE capabilities each tier should resolve to (reproduces P1 access,
// plus the new audit.view for analyst/admin and the split overrides for admin).
const EXPECTED: Record<RoleTier, Capability[]> = {
  team_member: ["view", "clean", "adjust"],
  analyst: ["view", "clean", "adjust", "intake", "boundaries", "safeguard", "audit.view"],
  admin: [...CAPABILITY_KEYS],
};

describe("capability catalogue", () => {
  it("has unique keys and the split override + audit capabilities, no bare `override`", () => {
    const keys = CAPABILITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("audit.view");
    expect(keys).toContain("override.marks_exclusions");
    expect(keys).toContain("override.distinction");
    expect(keys).not.toContain("override");
  });
});

describe("seeded permissions + grants reproduce the P1 effective access", () => {
  const resolved = resolveGrants(defaultPermissions(), defaultRoleGrants());
  for (const tier of TIERS) {
    it(`${tier}: resolves to the expected capability set`, () => {
      expect([...resolved[tier]].sort()).toEqual([...EXPECTED[tier]].sort());
      // DEFAULT_RESOLVED_GRANTS (the can() fallback) agrees.
      expect([...DEFAULT_RESOLVED_GRANTS[tier]].sort()).toEqual([...EXPECTED[tier]].sort());
    });
  }

  it("can() (no hydrated map) matches the resolved defaults for every tier × capability", () => {
    const storageOf: Record<RoleTier, CurrentUser["role"]> = { team_member: "reviewer", analyst: "analyst", admin: "lead_admin" };
    for (const tier of TIERS) {
      for (const cap of CAPABILITY_KEYS) {
        expect(can(storageOf[tier], cap)).toBe(EXPECTED[tier].includes(cap));
      }
    }
  });
});

describe("the override split resolves correctly", () => {
  it("admin holds both override capabilities; analyst and team_member hold neither", () => {
    expect(can("lead_admin", "override.marks_exclusions")).toBe(true);
    expect(can("lead_admin", "override.distinction")).toBe(true);
    for (const r of ["analyst", "reviewer", "viewer"] as const) {
      expect(can(r, "override.marks_exclusions")).toBe(false);
      expect(can(r, "override.distinction")).toBe(false);
    }
  });
});

describe("Workspace-administration lockout guard", () => {
  function admin(): InMemoryDataProvider {
    const p = new InMemoryDataProvider();
    p.setCurrentUser({ id: "a", name: "A", initials: "A", role: "lead_admin" });
    return p;
  }
  const wsPermId = (p: InMemoryDataProvider) => p.getPermissions().find((x) => guardsWorkspaceAdmin(x))!.id;

  it("the Workspace-administration permission cannot be deleted", () => {
    const p = admin();
    const id = wsPermId(p);
    p.deletePermission(id);
    expect(p.getPermissions().some((x) => x.id === id)).toBe(true);
  });

  it("workspace_admin cannot be removed from the system permission", () => {
    const p = admin();
    const id = wsPermId(p);
    p.updatePermission(id, "Workspace administration", "", ["configure"]); // drop workspace_admin
    expect(p.getPermissions().find((x) => x.id === id)!.capabilities).toContain("workspace_admin");
  });

  it("the Workspace-administration permission cannot be un-granted from admin", () => {
    const p = admin();
    const id = wsPermId(p);
    p.setRoleGrant("admin", id, false);
    expect(p.getRoleGrants().admin).toContain(id);
    expect(can("lead_admin", "workspace_admin", undefined)).toBe(true);
  });

  it("a non-admin cannot mutate permissions or grants", () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser({ id: "v", name: "V", initials: "V", role: "reviewer" });
    const before = p.getPermissions().length;
    p.createPermission("Hacked", "", ["workspace_admin"]);
    expect(p.getPermissions().length).toBe(before);
  });
});
