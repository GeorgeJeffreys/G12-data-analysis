/**
 * Enforcement is driven by the configurable-permissions model (0039). This
 * exercises the CLIENT side through the real in-memory provider: for each tier,
 * the provider's gates and read-model flags permit exactly the capabilities the
 * seeded grants resolve to, and deny the rest.
 *
 * Seeded effective access (resolve role → granted permissions → capabilities):
 *   team_member : view, clean, adjust
 *   analyst     : + intake, boundaries, safeguard, audit.view
 *   admin       : everything (incl. both overrides, signoff, configure, workspace_admin)
 *
 * The server twin (app.has_capability) is asserted structurally in
 * tests/migration.rpc-permission-gates.test.ts.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { can, CAPABILITY_KEYS, type Capability, type RoleTier } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/types";
import type { MemberRole } from "@/lib/types/database";

const CYCLE = "may-2026";

const AS: Record<RoleTier, MemberRole> = { team_member: "reviewer", analyst: "analyst", admin: "lead_admin" };
const EXPECTED: Record<RoleTier, Capability[]> = {
  team_member: ["view", "clean", "adjust"],
  analyst: ["view", "clean", "adjust", "intake", "boundaries", "safeguard", "audit.view"],
  admin: [...CAPABILITY_KEYS],
};

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

describe("read-model flags mirror the resolved grants, per tier", () => {
  const cases: { tier: RoleTier; signoff: boolean; distinctionOverride: boolean; configure: boolean; adjust: boolean; marksOverride: boolean }[] = [
    { tier: "team_member", signoff: false, distinctionOverride: false, configure: false, adjust: true, marksOverride: false },
    // analyst can CONFIRM the distinction cap (safeguard) but no longer OVERRIDE it
    // (override.distinction is admin-only via the Overrides permission).
    { tier: "analyst",     signoff: false, distinctionOverride: false, configure: false, adjust: true, marksOverride: false },
    { tier: "admin",       signoff: true,  distinctionOverride: true,  configure: true,  adjust: true, marksOverride: true },
  ];
  for (const c of cases) {
    it(`${c.tier}: flags match`, () => {
      const p = providerAs(c.tier);
      expect(p.getGrades(CYCLE)!.canLock).toBe(c.signoff); // signoff
      expect(p.getDistinctionSafeguard(CYCLE)!.canOverride).toBe(c.distinctionOverride); // override.distinction
      expect(p.getIncidentConfig().canEdit).toBe(c.configure); // configure
      p.loadSampleIncidentRows(CYCLE);
      expect(p.getIncidentReview(CYCLE)!.canApply).toBe(c.adjust); // adjust
      expect(p.getOverrideView(CYCLE).canOverride).toBe(c.marksOverride); // override.marks_exclusions
    });
  }
});

describe("write gates enforce the resolved grants, per tier", () => {
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
      expect(changed).toBe(EXPECTED[tier].includes("boundaries"));
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

describe("can() agrees with the resolved grants for every tier × capability", () => {
  it("matches the seeded effective access", () => {
    for (const tier of ["team_member", "analyst", "admin"] as RoleTier[]) {
      for (const cap of CAPABILITY_KEYS) {
        expect(can(AS[tier], cap)).toBe(EXPECTED[tier].includes(cap));
      }
    }
  });
});
