/**
 * Dynamic roles × granular actions (lib/auth/actions.ts, migration 0040) — the
 * fixed action catalogue + the seeded role grid + `can()` resolution.
 *
 * Locks: (a) the action catalogue is well-formed (unique keys, grouped by pipeline
 * step, no legacy capability keys); (b) the SEEDED roles reproduce the R1 default
 * EFFECTIVE access per role (resolve each role's granted actions and compare); (c)
 * `can()` resolves a member_role / role id against the seeded grid; (d) the new
 * `awards.generate` gate is admin-only by seed.
 */
import { describe, it, expect } from "vitest";
import {
  ACTIONS,
  ACTION_KEYS,
  ACTION_GROUP_ORDER,
  ACTION_GROUPS,
  DEFAULT_ROLES,
  DEFAULT_RESOLVED_ACTIONS,
  can,
  defaultRoles,
  defaultRoleActions,
  resolveRoleActions,
  type ActionKey,
} from "@/lib/auth/actions";
import type { MemberRole } from "@/lib/types/database";

// The EFFECTIVE actions each seeded role must resolve to — hand-derived from the R1
// capability defaults (view / clean / adjust for team_member; + intake / boundaries
// / safeguard / audit for analyst; everything for admin), so this is a real check of
// the seed, not a restatement of it.
const TEAM: ActionKey[] = [
  "general.view", "clean.rows", "clean.cohort", "review.exclude",
  "incidents.upload", "incidents.triage", "incidents.apply", "grades.adjust", "cgj.upload",
];
const ANALYST: ActionKey[] = [...TEAM, "upload.ingest", "upload.manage", "cuts.set", "grades.confirm_distinction", "general.audit"];
const EXPECTED: Record<string, ActionKey[]> = {
  team_member: TEAM,
  analyst: ANALYST,
  admin: [...ACTION_KEYS],
};
// A representative member_role that resolves onto each seeded role id.
const AS: Record<string, MemberRole> = { team_member: "reviewer", analyst: "analyst", admin: "lead_admin" };

describe("action catalogue", () => {
  it("has unique keys, grouped by pipeline step (+ General), no legacy capability keys", () => {
    const keys = ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Every action's group is one of the known ordered groups.
    for (const a of ACTIONS) expect(ACTION_GROUP_ORDER).toContain(a.group);
    // The granular split exists; the old bundled capability keys are gone.
    for (const k of ["upload.ingest", "clean.cohort", "review.exclude", "awards.generate", "general.manage_roles"]) {
      expect(keys).toContain(k);
    }
    for (const legacy of ["clean", "adjust", "intake", "boundaries", "configure", "workspace_admin", "override.marks_exclusions"]) {
      expect(keys).not.toContain(legacy);
    }
  });

  it("exports the ordered group list the grid UI consumes", () => {
    expect(ACTION_GROUPS.map((g) => g.group)).toEqual([...ACTION_GROUP_ORDER].filter((g) => ACTIONS.some((a) => a.group === g)));
    // Every catalogue action appears exactly once across the groups.
    expect(ACTION_GROUPS.flatMap((g) => g.items.map((i) => i.key)).sort()).toEqual([...ACTION_KEYS].sort());
  });
});

describe("seeded roles reproduce the R1 default effective access", () => {
  const resolved = resolveRoleActions(defaultRoles(), defaultRoleActions());
  for (const role of DEFAULT_ROLES) {
    it(`${role.id}: resolves to the expected action set`, () => {
      expect([...resolved[role.id]!].sort()).toEqual([...EXPECTED[role.id]!].sort());
      // DEFAULT_RESOLVED_ACTIONS (the can() fallback) agrees.
      expect([...DEFAULT_RESOLVED_ACTIONS[role.id]!].sort()).toEqual([...EXPECTED[role.id]!].sort());
    });
  }

  it("can() (no hydrated grid) matches the seeded access for every role × action", () => {
    for (const role of DEFAULT_ROLES) {
      for (const action of ACTION_KEYS) {
        expect(can(AS[role.id]!, action)).toBe(EXPECTED[role.id]!.includes(action));
      }
    }
  });

  it("resolves a role id or a member_role identically", () => {
    expect(can({ roleId: "admin" }, "general.manage_roles")).toBe(true);
    expect(can({ role: "lead_admin" }, "general.manage_roles")).toBe(true);
    expect(can("lead_admin", "general.manage_roles")).toBe(true);
    expect(can("reviewer", "general.manage_roles")).toBe(false);
  });
});

describe("the new awards.generate gate is admin-only by seed", () => {
  it("admin holds awards.generate; analyst and team_member do not", () => {
    expect(can("lead_admin", "awards.generate")).toBe(true);
    for (const r of ["analyst", "reviewer", "viewer"] as const) {
      expect(can(r, "awards.generate")).toBe(false);
    }
  });
});
