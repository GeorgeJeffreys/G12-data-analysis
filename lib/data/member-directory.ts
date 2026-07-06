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
import { ROLE_TIERS, roleTierLabel, tierOfRole } from "@/lib/auth/roles";
import type { Member, MembersModel } from "./types";

/** One row of the real member directory (public.list_members RPC). */
export interface MemberDirRow {
  user_id: string;
  email: string;
  role: MemberRole;
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
 */
export function buildMembersModel(rows: readonly MemberDirRow[], sessionUserId: string): MembersModel {
  const members: Member[] = rows.map((r) => ({
    id: memberKey(r.user_id, r.cycle_id),
    name: nameFromEmail(r.email),
    email: r.email,
    roleId: tierOfRole(r.role), // canonical tier
    roleName: roleTierLabel(r.role), // canonical label
    status: "active",
    lastActive: "",
    isCurrent: r.user_id === sessionUserId,
    scope: r.cycle_id === null ? "Workspace-wide" : "Cycle-specific",
  }));
  const roles = ROLE_TIERS.map((tier) => ({ id: tier, name: roleTierLabel(tier) }));
  return { members, roles };
}
