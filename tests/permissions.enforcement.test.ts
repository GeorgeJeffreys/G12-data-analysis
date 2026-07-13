/**
 * Enforcement is driven by the dynamic role × action grid (migration 0040). This
 * exercises the CLIENT side through the real in-memory provider: for each seeded
 * role, the provider's gates and read-model flags permit exactly the actions the
 * seeded grid grants, and deny the rest.
 *
 * Seeded effective access (resolve role_id → granted actions):
 *   team_member : view, clean.*, review.exclude, incidents.*, grades.adjust, cgj.upload
 *   analyst     : + upload.*, cuts.set, grades.confirm_distinction, general.audit
 *   admin       : every action (incl. overrides, signoff, config, manage_*, delete)
 *
 * The server twin (app.can_do) is asserted structurally in
 * tests/migration.rpc-permission-gates.test.ts.
 */
import { describe, it, expect } from "vitest";
import { seedIncidentRows } from "./helpers/incident-fixtures";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { can, ACTION_KEYS, type ActionKey } from "@/lib/auth/actions";
import type { CurrentUser } from "@/lib/data/types";
import type { MemberRole } from "@/lib/types/database";

const CYCLE = "may-2026";
type RoleId = "team_member" | "analyst" | "admin";

const AS: Record<RoleId, MemberRole> = { team_member: "reviewer", analyst: "analyst", admin: "lead_admin" };
const TEAM: ActionKey[] = [
  "general.view", "clean.rows", "clean.cohort", "review.exclude",
  "incidents.upload", "incidents.triage", "incidents.apply", "grades.adjust", "cgj.upload",
];
const ANALYST: ActionKey[] = [...TEAM, "upload.ingest", "upload.manage", "cuts.set", "grades.confirm_distinction", "general.audit"];
const EXPECTED: Record<RoleId, ActionKey[]> = { team_member: TEAM, analyst: ANALYST, admin: [...ACTION_KEYS] };

function providerAs(role: RoleId): InMemoryDataProvider {
  const p = new InMemoryDataProvider();
  const user: CurrentUser = { id: `u-${role}`, name: role, initials: "U", role: AS[role] };
  p.setCurrentUser(user);
  return p;
}
const firstAssessment = (p: InMemoryDataProvider) => p.getGrades(CYCLE)!.assessments[0]!.id;
const firstItem = (p: InMemoryDataProvider) => {
  const aid = firstAssessment(p);
  return { aid, itemId: p.getReview(CYCLE, aid)!.items[0]!.id };
};

describe("read-model flags mirror the resolved grid, per role", () => {
  const cases: { role: RoleId; signoff: boolean; distinctionOverride: boolean; configIncidents: boolean; apply: boolean; marksOverride: boolean }[] = [
    { role: "team_member", signoff: false, distinctionOverride: false, configIncidents: false, apply: true, marksOverride: false },
    { role: "analyst",     signoff: false, distinctionOverride: false, configIncidents: false, apply: true, marksOverride: false },
    { role: "admin",       signoff: true,  distinctionOverride: true,  configIncidents: true,  apply: true, marksOverride: true },
  ];
  for (const c of cases) {
    it(`${c.role}: flags match`, () => {
      const p = providerAs(c.role);
      expect(p.getGrades(CYCLE)!.canLock).toBe(c.signoff); // general.signoff
      expect(p.getDistinctionSafeguard(CYCLE)!.canOverride).toBe(c.distinctionOverride); // general.override_distinction
      expect(p.getIncidentConfig().canEdit).toBe(c.configIncidents); // general.config_incidents
      seedIncidentRows(p, CYCLE);
      expect(p.getIncidentReview(CYCLE)!.canApply).toBe(c.apply); // incidents.apply
      expect(p.getOverrideView(CYCLE).canOverride).toBe(c.marksOverride); // general.override_marks
    });
  }
});

describe("write gates enforce the resolved grid, per role", () => {
  it("review.exclude: every role may exclude an item (all hold it)", () => {
    for (const role of ["team_member", "analyst", "admin"] as RoleId[]) {
      const p = providerAs(role);
      const { aid, itemId } = firstItem(p);
      p.setItemExcluded(CYCLE, aid, itemId, true, "reason");
      expect(p.getReview(CYCLE, aid)!.items.find((i) => i.id === itemId)!.excluded).toBe(true);
    }
  });

  it("cuts.set: analyst/admin may set a cut, team_member may not", () => {
    for (const role of ["team_member", "analyst", "admin"] as RoleId[]) {
      const p = providerAs(role);
      const aid = firstAssessment(p);
      const before = JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts);
      p.setBoundary(CYCLE, aid, { cuts: [5, 3, 1] });
      const changed = JSON.stringify(p.getBoundaries(CYCLE, aid)!.cuts) !== before;
      expect(changed).toBe(EXPECTED[role].includes("cuts.set"));
    }
  });

  it("general.signoff: only admin may lock the sitting", () => {
    for (const role of ["team_member", "analyst", "admin"] as RoleId[]) {
      const p = providerAs(role);
      p.lockCycle(CYCLE);
      expect(p.getCycle(CYCLE)!.locked).toBe(role === "admin");
    }
  });

  it("general.manage_centres: only admin may create a test centre", () => {
    for (const role of ["team_member", "analyst", "admin"] as RoleId[]) {
      const p = providerAs(role);
      const before = p.listTestCentres().length;
      p.createTestCentre({ name: "New Centre", code: "NEW" });
      expect(p.listTestCentres().length > before).toBe(role === "admin");
    }
  });

  it("general.manage_roles: only admin may create a role", () => {
    for (const role of ["team_member", "analyst", "admin"] as RoleId[]) {
      const p = providerAs(role);
      const before = p.getRoles().length;
      p.createRole("Marker");
      expect(p.getRoles().length > before).toBe(role === "admin");
    }
  });
});

describe("can() agrees with the resolved grid for every role × action", () => {
  it("matches the seeded effective access", () => {
    for (const role of ["team_member", "analyst", "admin"] as RoleId[]) {
      for (const action of ACTION_KEYS) {
        expect(can(AS[role], action)).toBe(EXPECTED[role].includes(action));
      }
    }
  });
});
