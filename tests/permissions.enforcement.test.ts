/**
 * P2 — enforcement is now driven by the permission matrix on BOTH sides of the
 * wire. This exercises the CLIENT side through the real in-memory provider: for
 * each of the three canonical tiers, the provider's gates and read-model flags
 * permit exactly the actions the P1 default matrix grants, and deny the rest.
 *
 * Default matrix (lib/auth/permissions.ts ROLE_PERMISSION_DEFAULTS):
 *   team_member : view, clean, adjust
 *   analyst     : view, clean, adjust, intake, boundaries, safeguard
 *   admin       : everything
 *
 * The server twin (app.has_permission) is asserted structurally in
 * tests/migration.rpc-permission-gates.test.ts.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { can, PERMISSIONS, ROLE_PERMISSION_DEFAULTS, type RoleTier } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/types";
import type { MemberRole } from "@/lib/types/database";

const CYCLE = "may-2026";

// One representative storage role per canonical tier (the collapse is covered in
// roles.permissions.test.ts). team_member is exercised via `reviewer`.
const AS: Record<RoleTier, MemberRole> = { team_member: "reviewer", analyst: "analyst", admin: "lead_admin" };

function providerAs(tier: RoleTier): InMemoryDataProvider {
  const p = new InMemoryDataProvider();
  const user: CurrentUser = { id: `u-${tier}`, name: tier, initials: "U", role: AS[tier] };
  p.setCurrentUser(user);
  return p;
}
const firstAssessment = (p: InMemoryDataProvider) => p.getGrades(CYCLE)!.assessments[0]!.id;
const firstItem = (p: InMemoryDataProvider) => {
  const aid = firstAssessment(p);
  return { aid, itemId: p.getReview(CYCLE, aid)!.items[0]!.id };
};

describe("read-model flags mirror the matrix, per tier", () => {
  const cases: { tier: RoleTier; signoff: boolean; safeguard: boolean; configure: boolean; adjust: boolean; override: boolean }[] = [
    { tier: "team_member", signoff: false, safeguard: false, configure: false, adjust: true, override: false },
    { tier: "analyst",     signoff: false, safeguard: true,  configure: false, adjust: true, override: false },
    { tier: "admin",       signoff: true,  safeguard: true,  configure: true,  adjust: true, override: true },
  ];
  for (const c of cases) {
    it(`${c.tier}: flags match`, () => {
      const p = providerAs(c.tier);
      expect(p.getGrades(CYCLE)!.canLock).toBe(c.signoff); // signoff
      expect(p.getDistinctionSafeguard(CYCLE)!.canOverride).toBe(c.safeguard); // safeguard
      expect(p.getIncidentConfig().canEdit).toBe(c.configure); // configure
      p.loadSampleIncidentRows(CYCLE);
      expect(p.getIncidentReview(CYCLE)!.canApply).toBe(c.adjust); // adjust
      expect(p.getOverrideView(CYCLE).canOverride).toBe(c.override); // override
    });
  }
});

describe("write gates enforce the matrix, per tier", () => {
  it("clean: every tier may exclude an item (all hold `clean`)", () => {
    for (const tier of ["team_member", "analyst", "admin"] as RoleTier[]) {
      const p = providerAs(tier);
      const { aid, itemId } = firstItem(p);
      p.setItemExcluded(CYCLE, aid, itemId, true, "reason");
      expect(p.getReview(CYCLE, aid)!.items.find((i) => i.id === itemId)!.excluded).toBe(true);
    }
  });

  it("boundaries: analyst/admin may set a cut, team_member may not", () => {
    for (const tier of ["team_member", "analyst", "admin"] as RoleTier[]) {
      const p = providerAs(tier);
      const aid = firstAssessment(p);
      const before = JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts);
      p.setBoundary(CYCLE, aid, { cuts: [5, 3, 1] });
      const changed = JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts) !== before;
      expect(changed).toBe(ROLE_PERMISSION_DEFAULTS[tier].includes("boundaries"));
    }
  });

  it("signoff: only admin may lock the sitting", () => {
    for (const tier of ["team_member", "analyst", "admin"] as RoleTier[]) {
      const p = providerAs(tier);
      p.lockCycle(CYCLE);
      expect(p.getCycle(CYCLE)!.locked).toBe(tier === "admin");
    }
  });

  it("workspace_admin: only admin may create a test centre", () => {
    for (const tier of ["team_member", "analyst", "admin"] as RoleTier[]) {
      const p = providerAs(tier);
      const before = p.listTestCentres().length;
      p.createTestCentre({ name: "New Centre", code: "NEW" });
      const added = p.listTestCentres().length > before;
      expect(added).toBe(tier === "admin");
    }
  });
});

describe("can() agrees with the provider gates for every tier × permission", () => {
  it("matches ROLE_PERMISSION_DEFAULTS", () => {
    for (const tier of ["team_member", "analyst", "admin"] as RoleTier[]) {
      for (const perm of PERMISSIONS) {
        expect(can(AS[tier], perm)).toBe(ROLE_PERMISSION_DEFAULTS[tier].includes(perm));
      }
    }
  });
});
