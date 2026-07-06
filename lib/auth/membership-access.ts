/**
 * The app-layer mirror of the DB authorization primitive `app.has_role(target_cycle,
 * allowed[])` — the ONE place the server/UI reasons about "can this user act on this
 * cycle", so no permission check is ever re-invented by comparing role strings ad-hoc.
 *
 * The single membership rule (identical to the DB `has_role`):
 *   a membership APPLIES to a target cycle when it is workspace-wide
 *   (`cycle_id === null`, admin over every cycle) OR scoped to that exact cycle; the
 *   caller's EFFECTIVE privilege for the cycle is the HIGHEST tier among the memberships
 *   that apply. A workspace admin therefore outranks everything on every cycle and on
 *   workspace-scoped rows (`cycleId === null`).
 *
 * Storage roles collapse onto canonical tiers via lib/auth/roles.ts — this module never
 * hard-codes a role string; it composes `roleRank` / `hasRole` from that single source.
 */
import type { MemberRole } from "@/lib/types/database";
import { hasRole, roleRank, tierOfRole, type RoleTier } from "@/lib/auth/roles";

/** A membership row as read from `memberships` (workspace-wide when cycle_id is null). */
export interface Membership {
  role: MemberRole;
  cycle_id: string | null;
}

/** Does this membership authorize action on `cycleId`? Workspace-wide, or that cycle. */
function membershipApplies(m: Membership, cycleId: string | null): boolean {
  return m.cycle_id === null || m.cycle_id === cycleId;
}

/**
 * The caller's effective canonical tier for `cycleId` — the highest tier among the
 * memberships that apply — or `null` when they hold no applicable membership (not a
 * member of this cycle). Mirrors the DB "higher of workspace and per-cycle" rule.
 */
export function effectiveTierForCycle(
  memberships: readonly Membership[],
  cycleId: string | null,
): RoleTier | null {
  let best: RoleTier | null = null;
  let bestRank = 0;
  for (const m of memberships) {
    if (!membershipApplies(m, cycleId)) continue;
    const rank = roleRank(m.role);
    if (rank > bestRank) {
      bestRank = rank;
      best = tierOfRole(m.role);
    }
  }
  return best;
}

/** May the caller READ this cycle's data? Any applicable membership suffices. */
export function canReadCycle(memberships: readonly Membership[], cycleId: string | null): boolean {
  return effectiveTierForCycle(memberships, cycleId) !== null;
}

/**
 * May the caller WRITE / DELETE this cycle's data (and manage its memberships)? The
 * admin bar — the app-layer twin of `app.has_role(cycle, ['lead_admin'])`.
 */
export function canManageCycle(memberships: readonly Membership[], cycleId: string | null): boolean {
  const tier = effectiveTierForCycle(memberships, cycleId);
  return tier !== null && hasRole(tier, "admin");
}
