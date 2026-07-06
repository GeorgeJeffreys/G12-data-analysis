/**
 * Identity layer guardrail — the Users & access roster must reflect the REAL
 * auth.users ⋈ memberships, with displayed identity = authenticated identity, and
 * the mock accounts (Rana/Sami/Karim) must be gone.
 *
 * buildMembersModel is the pure mapping the SupabaseDataProvider.getMembers() uses,
 * so this locks: (1) "(you)" is flagged from the SESSION id (not a hardcoded row);
 * (2) roles render in the ONE canonical vocabulary; (3) the scope is the real
 * membership scope; (4) tier→member_role for writes; (5) defaultMembers/seedAudit
 * carry no mock accounts.
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

const ROWS: MemberDirRow[] = [
  { user_id: GEORGE_G, email: "emailgeorgej@gmail.com", role: "lead_admin", cycle_id: null },
  { user_id: GEORGE_J, email: "george.jeffreys@alsamaproject.com", role: "analyst", cycle_id: null },
  { user_id: LAVINIA, email: "lavinia.cavalet@alsamaproject.com", role: "reviewer", cycle_id: CYCLE },
];

describe("member directory — displayed identity = authenticated identity", () => {
  it("flags '(you)' from the SESSION id, on exactly the signed-in account", () => {
    // Signed in as Lavinia → only Lavinia is current (never a hardcoded 'Rana').
    const asLavinia = buildMembersModel(ROWS, LAVINIA);
    const current = asLavinia.members.filter((m) => m.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]!.email).toBe("lavinia.cavalet@alsamaproject.com");

    // Signed in as George → the flag moves to George. Same rows, session decides.
    const asGeorge = buildMembersModel(ROWS, GEORGE_G);
    expect(asGeorge.members.filter((m) => m.isCurrent).map((m) => m.email)).toEqual(["emailgeorgej@gmail.com"]);
  });

  it("lists exactly the real accounts with their real emails — no mock users", () => {
    const model = buildMembersModel(ROWS, LAVINIA);
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

  it("renders the WORKSPACE role in the ONE canonical vocabulary (not 'G12 Lead'/'Data Scientist')", () => {
    const byEmail = Object.fromEntries(buildMembersModel(ROWS, LAVINIA).members.map((m) => [m.email, m]));
    expect(byEmail["emailgeorgej@gmail.com"]!.roleName).toBe("Admin"); // lead_admin → admin
    expect(byEmail["george.jeffreys@alsamaproject.com"]!.roleName).toBe("Data analyst"); // analyst
    // Lavinia has NO workspace membership (only a cycle grant) → headline is "—".
    expect(byEmail["lavinia.cavalet@alsamaproject.com"]!.roleName).toBe("—");
    expect(byEmail["emailgeorgej@gmail.com"]!.roleId).toBe("admin");
    // The role options are the three canonical tiers, never the mock role names.
    expect(buildMembersModel(ROWS, LAVINIA).roles.map((r) => r.name)).toEqual([
      "G12 team member",
      "Data analyst",
      "Admin",
    ]);
  });

  it("summarises the real scope (workspace-wide vs cycle-only)", () => {
    const byEmail = Object.fromEntries(buildMembersModel(ROWS, LAVINIA).members.map((m) => [m.email, m]));
    expect(byEmail["emailgeorgej@gmail.com"]!.scope).toBe("Workspace-wide");
    expect(byEmail["lavinia.cavalet@alsamaproject.com"]!.scope).toBe("1 cycle grant");
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

describe("one row per person — grouping & exceptions", () => {
  const CYCLE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const label = (id: string) => (id === CYCLE ? "May 2026" : id === CYCLE_B ? "Feb 2026" : id.slice(0, 4));

  it("collapses a person's many memberships into ONE row (no duplicate people)", () => {
    // George: workspace analyst + an Admin grant on one cycle + reviewer on another.
    const rows: MemberDirRow[] = [
      { user_id: GEORGE_G, email: "emailgeorgej@gmail.com", role: "analyst", cycle_id: null },
      { user_id: GEORGE_G, email: "emailgeorgej@gmail.com", role: "lead_admin", cycle_id: CYCLE },
      { user_id: GEORGE_G, email: "emailgeorgej@gmail.com", role: "reviewer", cycle_id: CYCLE_B },
    ];
    const model = buildMembersModel(rows, GEORGE_G, label);
    expect(model.members).toHaveLength(1); // ONE row, not three
    const p = model.members[0]!;
    expect(p.roleName).toBe("Data analyst"); // workspace headline
    // Both differing cycle grants are exceptions, sorted by label.
    expect(p.exceptions).toEqual([
      { cycleId: CYCLE_B, cycleLabel: "Feb 2026", roleId: "team_member", roleName: "G12 team member" },
      { cycleId: CYCLE, cycleLabel: "May 2026", roleId: "admin", roleName: "Admin" },
    ]);
    expect(p.scope).toBe("Workspace-wide · 2 exceptions");
  });

  it("hides a cycle grant that MATCHES the workspace tier (not a real exception)", () => {
    const rows: MemberDirRow[] = [
      { user_id: GEORGE_G, email: "emailgeorgej@gmail.com", role: "lead_admin", cycle_id: null },
      { user_id: GEORGE_G, email: "emailgeorgej@gmail.com", role: "lead_admin", cycle_id: CYCLE },
    ];
    const p = buildMembersModel(rows, GEORGE_G, label).members[0]!;
    expect(p.exceptions).toEqual([]);
    expect(p.scope).toBe("Workspace-wide");
    expect(p.isWorkspaceAdmin).toBe(true);
  });
});

describe("mock accounts removed", () => {
  it("defaultMembers() and seedAuditEntries() are empty (no Rana/Sami/Karim)", () => {
    expect(defaultMembers()).toEqual([]);
    expect(seedAuditEntries("any")).toEqual([]);
  });
});
