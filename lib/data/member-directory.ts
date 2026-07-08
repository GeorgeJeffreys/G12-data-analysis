/**
 * The REAL member directory — maps `auth.users ⋈ memberships` rows (from the
 * `list_members` RPC) into the `MembersModel` the Users & access screen renders.
 *
 * The one rule this enforces: displayed identity = authenticated identity. Each
 * row is flagged `isCurrent` by matching the session user id, and every role is
 * the membership's REAL dynamic role (migration 0040/0042: `memberships.role_id →
 * roles`), carried straight through as `role_id` + the role `name`. It is NOT
 * derived from the legacy `member_role` enum — that derivation collapsed every
 * role onto a canonical TIER id ("admin"/"analyst"/"team_member"), which no
 * longer matches the dynamic role ids the Roles × actions grid counts by (so
 * every role read "0 members") and would drift once roles are reassigned.
 */
import type { MemberRole } from "@/lib/types/database";
import type { Member, MembersModel } from "./types";

/** One row of the real member directory (public.list_members RPC, 0042). */
export interface MemberDirRow {
  user_id: string;
  email: string;
  /** Legacy `member_role` enum — kept during the transition; not read for the role. */
  role: MemberRole;
  /** The membership's dynamic role id (memberships.role_id → roles), or null. */
  role_id: string | null;
  /** The dynamic role's display name (joined through roles), or null. */
  role_name: string | null;
  cycle_id: string | null;
}

/** Encode a membership's (user_id, cycle_id) as the UI row id, so a role-change /
 *  remove targets the exact membership scope. `cycle_id = null` → workspace. */
export function memberKey(userId: string, cycleId: string | null): string {
  return `${userId}|${cycleId ?? ""}`;
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
 * Build the Users & access model from the real directory rows. `sessionUserId` is
 * the authenticated user's id (from the Supabase session) — the ONLY source of the
 * "(you)" flag, so the screen can never disagree with the account menu.
 *
 * Each member's role is the membership's REAL dynamic role (role_id + role_name);
 * `roles` are the assignable dynamic role rows (from the provider's getRoles()) so
 * the Users dropdown lists — and each member's row value matches against — the same
 * ids the Roles × actions grid uses. A role_id-less row (shouldn't happen post-0040)
 * degrades to an empty id and an em-dash label rather than a wrong tier.
 */
export function buildMembersModel(
  rows: readonly MemberDirRow[],
  sessionUserId: string,
  roles: readonly { id: string; name: string }[] = [],
): MembersModel {
  const members: Member[] = rows.map((r) => ({
    id: memberKey(r.user_id, r.cycle_id),
    name: nameFromEmail(r.email),
    email: r.email,
    roleId: r.role_id ?? "", // the real dynamic role id (memberships.role_id)
    roleName: r.role_name ?? "—", // the dynamic role's display name
    status: "active",
    lastActive: "",
    isCurrent: r.user_id === sessionUserId,
    scope: r.cycle_id === null ? "Workspace-wide" : "Cycle-specific",
  }));
  return { members, roles: roles.map((r) => ({ id: r.id, name: r.name })) };
}
