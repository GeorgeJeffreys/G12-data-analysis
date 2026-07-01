/**
 * Canonical role & permission foundation — the SINGLE source of truth for
 * "who may do what" across the suite. Everything that gates on privilege (the
 * cut-score / workspace-config admin lock, the settings editors, the audit
 * override surface, the in-memory provider's action guards) reasons about roles
 * through THIS module, never by comparing role strings ad-hoc.
 *
 * The three canonical roles, lowest → highest privilege:
 *   1. team_member — view + standard reviewer work.
 *   2. analyst     — everything a team member can do, plus analyst functions.
 *   3. admin       — super-user: configure grade-bearing settings and override
 *                    decisions made by lower roles.
 *
 * Storage note: the physical `member_role` DB enum predates this hierarchy and
 * still carries `viewer` and `reviewer` as two sub-flavours of the team-member
 * tier (a `viewer` reads; a `reviewer` also decides item exclusions). Both
 * collapse onto the single canonical `team_member` tier here — the DB enum is
 * how the tier is PERSISTED, not a competing role model. `analyst` and
 * `lead_admin` map straight through to `analyst` / `admin`.
 */

import type { MemberRole } from "@/lib/types/database";

/** The canonical privilege tiers, ordered lowest → highest. */
export const ROLE_TIERS = ["team_member", "analyst", "admin"] as const;
export type RoleTier = (typeof ROLE_TIERS)[number];

/**
 * Every storage (`member_role`) value collapsed onto its canonical tier.
 * `viewer`/`reviewer` → team_member; `analyst` → analyst; `lead_admin` → admin.
 */
const STORAGE_ROLE_TIER: Record<MemberRole, RoleTier> = {
  viewer: "team_member",
  reviewer: "team_member",
  analyst: "analyst",
  lead_admin: "admin",
};

/**
 * A role expressed either as a canonical tier (`team_member` | `analyst` |
 * `admin`) or as a storage/member role (`viewer` | `reviewer` | `analyst` |
 * `lead_admin`). Callers can pass a `CurrentUser.role` straight through.
 */
export type AnyRole = RoleTier | MemberRole;

/** Resolve any role expression to its canonical tier. */
function tierOf(role: AnyRole): RoleTier {
  return Object.prototype.hasOwnProperty.call(STORAGE_ROLE_TIER, role)
    ? STORAGE_ROLE_TIER[role as MemberRole]
    : (role as RoleTier);
}

/**
 * 1-based rank of a role in the canonical hierarchy — higher = more privilege.
 * team_member → 1, analyst → 2, admin → 3.
 */
export function roleRank(role: AnyRole): number {
  return ROLE_TIERS.indexOf(tierOf(role)) + 1;
}

/**
 * Does `role` meet AT LEAST the `minTier` bar? The one primitive for
 * "admin only" (`hasRole(role, "admin")`) and "at least analyst"
 * (`hasRole(role, "analyst")`) checks.
 */
export function hasRole(role: AnyRole, minTier: RoleTier): boolean {
  return roleRank(role) >= roleRank(minTier);
}

/**
 * May `actorRole` override a decision taken by `subjectRole`? True ONLY when the
 * actor is STRICTLY higher in the hierarchy than the role that took the original
 * action — admin overrides analyst and team member; analyst overrides team
 * member; nobody overrides an equal or higher role. (Consumed by the audit
 * override surface; the UI is wired up separately.)
 */
export function canOverride(actorRole: AnyRole, subjectRole: AnyRole): boolean {
  return roleRank(actorRole) > roleRank(subjectRole);
}
