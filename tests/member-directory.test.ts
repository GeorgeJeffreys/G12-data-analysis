/**
 * Identity layer guardrail — the Users & access roster must reflect the REAL
 * auth.users ⋈ memberships, with displayed identity = authenticated identity, and
 * the mock accounts (Rana/Sami/Karim) must be gone.
 *
 * buildMembersModel is the pure mapping the SupabaseDataProvider.getMembers() uses,
 * so this locks: (1) "(you)" is flagged from the SESSION id (not a hardcoded row);
 * (2) each member's role is the REAL DYNAMIC role (role_id + role_name from 0042 —
 * NOT the legacy enum's canonical tier, which broke the Roles-grid member counts);
 * (3) the assignable roles are the dynamic role rows passed in; (4) the scope is the
 * real membership scope; (5) defaultMembers/seedAudit carry no mock accounts.
 */
import { describe, it, expect } from "vitest";
import {
  buildMembersModel,
  memberKey,
  parseMemberKey,
  nameFromEmail,
  type MemberDirRow,
} from "@/lib/data/member-directory";
import { storageRoleForTier } from "@/lib/auth/roles";
import { defaultMembers, seedAuditEntries } from "@/lib/data/mock-admin";

// The three REAL accounts (auth.users), as list_members would return them.
const GEORGE_G = "11111111-1111-1111-1111-111111111111";
const GEORGE_J = "22222222-2222-2222-2222-222222222222";
const LAVINIA = "33333333-3333-3333-3333-333333333333";
const CYCLE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// The DYNAMIC role rows (memberships.role_id → roles), with real uuids — the same
// shape list_members now joins (role_id + role_name) and getRoles() supplies.
const ADMIN_ROLE = "bbbbbbbb-0000-0000-0000-000000000001";
const ANALYST_ROLE = "bbbbbbbb-0000-0000-0000-000000000002";
const TEAM_ROLE = "bbbbbbbb-0000-0000-0000-000000000003";
const ROLES = [
  { id: TEAM_ROLE, name: "G12 team member" },
  { id: ANALYST_ROLE, name: "Data analyst" },
  { id: ADMIN_ROLE, name: "Admin" },
];

const ROWS: MemberDirRow[] = [
  { user_id: GEORGE_G, email: "emailgeorgej@gmail.com", role: "lead_admin", role_id: ADMIN_ROLE, role_name: "Admin", cycle_id: null },
  { user_id: GEORGE_J, email: "george.jeffreys@alsamaproject.com", role: "analyst", role_id: ANALYST_ROLE, role_name: "Data analyst", cycle_id: null },
  { user_id: LAVINIA, email: "lavinia.cavalet@alsamaproject.com", role: "reviewer", role_id: TEAM_ROLE, role_name: "G12 team member", cycle_id: CYCLE },
];

describe("member directory — displayed identity = authenticated identity", () => {
  it("flags '(you)' from the SESSION id, on exactly the signed-in account", () => {
    // Signed in as Lavinia → only Lavinia is current (never a hardcoded 'Rana').
    const asLavinia = buildMembersModel(ROWS, LAVINIA, ROLES);
    const current = asLavinia.members.filter((m) => m.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]!.email).toBe("lavinia.cavalet@alsamaproject.com");

    // Signed in as George → the flag moves to George. Same rows, session decides.
    const asGeorge = buildMembersModel(ROWS, GEORGE_G, ROLES);
    expect(asGeorge.members.filter((m) => m.isCurrent).map((m) => m.email)).toEqual(["emailgeorgej@gmail.com"]);
  });

  it("lists exactly the real accounts with their real emails — no mock users", () => {
    const model = buildMembersModel(ROWS, LAVINIA, ROLES);
    expect(model.members.map((m) => m.email).sort()).toEqual([
      "emailgeorgej@gmail.com",
      "george.jeffreys@alsamaproject.com",
      "lavinia.cavalet@alsamaproject.com",
    ]);
    const blob = JSON.stringify(model);
    for (const ghost of ["Rana", "Sami", "Karim", "Mansour", "Haddad", "Osman"]) {
      expect(blob).not.toContain(ghost);
    }
  });

  it("resolves each member to their REAL dynamic role (role_id + role_name), not the enum tier", () => {
    const byEmail = Object.fromEntries(buildMembersModel(ROWS, LAVINIA, ROLES).members.map((m) => [m.email, m]));
    // roleId is the membership's real dynamic role uuid — the SAME id the Roles ×
    // actions grid counts members by (so counts are non-zero), never a tier string.
    expect(byEmail["emailgeorgej@gmail.com"]!.roleId).toBe(ADMIN_ROLE);
    expect(byEmail["george.jeffreys@alsamaproject.com"]!.roleId).toBe(ANALYST_ROLE);
    expect(byEmail["lavinia.cavalet@alsamaproject.com"]!.roleId).toBe(TEAM_ROLE);
    // roleName is the joined role display name.
    expect(byEmail["emailgeorgej@gmail.com"]!.roleName).toBe("Admin");
    expect(byEmail["george.jeffreys@alsamaproject.com"]!.roleName).toBe("Data analyst");
    expect(byEmail["lavinia.cavalet@alsamaproject.com"]!.roleName).toBe("G12 team member");
  });

  it("follows a custom-role reassignment through role_id + name (no enum dependence)", () => {
    // Lavinia reassigned to a brand-new custom role — the enum is now stale/unrelated,
    // but the roster reflects the custom role because it reads role_id + role_name.
    const MARKER_ROLE = "cccccccc-0000-0000-0000-000000000009";
    const reassigned: MemberDirRow[] = [
      { user_id: LAVINIA, email: "lavinia.cavalet@alsamaproject.com", role: "reviewer", role_id: MARKER_ROLE, role_name: "Marker", cycle_id: CYCLE },
    ];
    const rolesWithCustom = [...ROLES, { id: MARKER_ROLE, name: "Marker" }];
    const m = buildMembersModel(reassigned, LAVINIA, rolesWithCustom).members[0]!;
    expect(m.roleId).toBe(MARKER_ROLE);
    expect(m.roleName).toBe("Marker");
  });

  it("lists the assignable roles as the DYNAMIC role rows passed in (matched by id)", () => {
    // The dropdown options are the dynamic roles (ids the member rows resolve to),
    // never a fixed enum-tier list.
    expect(buildMembersModel(ROWS, LAVINIA, ROLES).roles).toEqual(ROLES);
  });

  it("degrades a role_id-less row to an empty id + em-dash rather than a wrong tier", () => {
    const orphan: MemberDirRow[] = [
      { user_id: LAVINIA, email: "lavinia.cavalet@alsamaproject.com", role: "reviewer", role_id: null, role_name: null, cycle_id: CYCLE },
    ];
    const m = buildMembersModel(orphan, LAVINIA, ROLES).members[0]!;
    expect(m.roleId).toBe("");
    expect(m.roleName).toBe("—");
  });

  it("shows the real membership scope (workspace-wide vs cycle-specific)", () => {
    const byEmail = Object.fromEntries(buildMembersModel(ROWS, LAVINIA, ROLES).members.map((m) => [m.email, m]));
    expect(byEmail["emailgeorgej@gmail.com"]!.scope).toBe("Workspace-wide");
    expect(byEmail["lavinia.cavalet@alsamaproject.com"]!.scope).toBe("Cycle-specific");
  });

  it("encodes (user_id, cycle_id) in the row id so a write targets the exact scope", () => {
    expect(parseMemberKey(memberKey(LAVINIA, CYCLE))).toEqual({ userId: LAVINIA, cycleId: CYCLE });
    expect(parseMemberKey(memberKey(GEORGE_G, null))).toEqual({ userId: GEORGE_G, cycleId: null });
  });

  it("maps a canonical tier back to a concrete member_role for the write", () => {
    expect(storageRoleForTier("admin")).toBe("lead_admin");
    expect(storageRoleForTier("analyst")).toBe("analyst");
    expect(storageRoleForTier("team_member")).toBe("reviewer");
  });

  it("derives a display name from the email (auth.users has none)", () => {
    expect(nameFromEmail("lavinia.cavalet@alsamaproject.com")).toBe("Lavinia Cavalet");
  });
});

describe("mock accounts removed", () => {
  it("defaultMembers() and seedAuditEntries() are empty (no Rana/Sami/Karim)", () => {
    expect(defaultMembers()).toEqual([]);
    expect(seedAuditEntries("any")).toEqual([]);
  });
});
