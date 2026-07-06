/**
 * The REAL member directory — maps `auth.users ⋈ memberships` rows (from the
 * `list_members` RPC) into the `MembersModel` the Users & access screen renders.
 *
 * The one rule this enforces: displayed identity = authenticated identity. Each
 * row is flagged `isCurrent` by matching the session user id, and every role is
 * expressed through the SINGLE canonical vocabulary (lib/auth/roles.ts:
 * member < analyst < admin) — never the old mock "G12 Lead / Data Scientist".
 */
import type { MemberRole } from "@/lib/types/database";
import { ROLE_TIERS, roleRank, roleTierLabel, tierOfRole } from "@/lib/auth/roles";
import type { Member, MemberException, MembersModel } from "./types";

/** One row of the real member directory (public.list_members RPC). */
export interface MemberDirRow {
  user_id: string;
  email: string;
  role: MemberRole;
  cycle_id: string | null;
}

/**
 * The UI row id for a PERSON is their auth.users id (one row per person). A
 * cycle-specific exception is addressed as `${userId}|${cycleId}`. `parseMemberKey`
 * decodes either: a bare id → workspace scope (cycleId null); a piped id → that cycle.
 */
export function memberKey(userId: string, cycleId: string | null): string {
  return cycleId === null ? userId : `${userId}|${cycleId}`;
}
export function parseMemberKey(key: string): { userId: string; cycleId: string | null } {
  const [userId, cycle = ""] = key.split("|");
  return { userId: userId ?? "", cycleId: cycle === "" ? null : cycle };
}

/** A display name from an email (local part, title-cased) — auth.users has no name. */
export function nameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? email).replace(/[._-]+/g, " ").trim();
  return local.replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}

/**
 * Build the Users & access model — ONE ROW PER PERSON. Memberships are grouped by
 * user: the workspace-wide (`cycle_id = null`) membership is the headline role, and
 * any cycle-specific grant whose tier DIFFERS from the workspace role is surfaced as
 * an "exception" under the person (never a separate top-level row).
 *
 * `sessionUserId` is the authenticated user's id — the ONLY source of the "(you)"
 * flag. `cycleLabel` resolves a cycle_id to a human label for the exceptions list.
 */
export function buildMembersModel(
  rows: readonly MemberDirRow[],
  sessionUserId: string,
  cycleLabel: (cycleId: string) => string = (id) => `Cycle ${id.slice(0, 8)}`,
): MembersModel {
  // Group every membership row by the person.
  const byUser = new Map<string, MemberDirRow[]>();
  for (const r of rows) {
    (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push(r);
  }

  const members: Member[] = [];
  for (const [userId, group] of byUser) {
    const email = group[0]!.email;
    // Highest-ranked WORKSPACE membership is the headline (there is normally one).
    const workspace = group
      .filter((r) => r.cycle_id === null)
      .sort((a, b) => roleRank(b.role) - roleRank(a.role))[0];
    const workspaceTier = workspace ? tierOfRole(workspace.role) : null;

    // Cycle grants that differ from the workspace role become exceptions.
    const exceptions: MemberException[] = group
      .filter((r): r is MemberDirRow & { cycle_id: string } => r.cycle_id !== null)
      .filter((r) => tierOfRole(r.role) !== workspaceTier)
      .map((r) => ({
        cycleId: r.cycle_id,
        cycleLabel: cycleLabel(r.cycle_id),
        roleId: tierOfRole(r.role),
        roleName: roleTierLabel(r.role),
      }))
      .sort((a, b) => a.cycleLabel.localeCompare(b.cycleLabel));

    const scope = workspace
      ? exceptions.length
        ? `Workspace-wide · ${exceptions.length} exception${exceptions.length > 1 ? "s" : ""}`
        : "Workspace-wide"
      : exceptions.length
        ? `${exceptions.length} cycle grant${exceptions.length > 1 ? "s" : ""}`
        : "No access";

    members.push({
      id: userId,
      name: nameFromEmail(email),
      email,
      roleId: workspaceTier ?? "",
      roleName: workspace ? roleTierLabel(workspace.role) : "—",
      status: "active",
      lastActive: "",
      isCurrent: userId === sessionUserId,
      scope,
      exceptions,
      isWorkspaceAdmin: workspace?.role === "lead_admin",
    });
  }
  members.sort((a, b) => a.email.localeCompare(b.email));

  const roles = ROLE_TIERS.map((tier) => ({ id: tier, name: roleTierLabel(tier) }));
  return { members, roles };
}
