import "server-only";

/**
 * Server-side authorization gate for cycle data-mutations (ingest / recompute).
 *
 * Decides "is the signed-in user an admin of this cycle" by reading the user's OWN
 * membership rows with the ADMIN (service-role) client, NOT the RLS-scoped session
 * client. Reasons:
 *   1. Correctness under RLS drift. A workspace admin's membership is `cycle_id =
 *      NULL` (admin over every cycle — see RUNBOOK §2). The `memberships_select`
 *      RLS policy routes through `app.is_member(cycle_id)`, which — if that helper
 *      drifts to the strict, cycle-scoped body — can no longer surface a workspace
 *      row to its own owner, so the RLS-scoped read returns nothing and the gate
 *      answers a bare "forbidden" to a legitimate admin. That paired-with the delete
 *      RPC's identical `app.has_role` guard was the "both mutations forbidden"
 *      regression (migration 0024 restores the helpers; this gate stops depending on
 *      them being correct to authorize a read the server already trusts).
 *   2. Diagnosability. On denial we return a concrete reason (the roles actually
 *      found for the account), never a bare permission word.
 *
 * The user identity is still established from the verified session (`getUser()`) by
 * the caller; this only looks up that user's roles.
 */
import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import { canManageCycle, type Membership } from "@/lib/auth/membership-access";

export interface CycleAdminDecision {
  allowed: boolean;
  /** A diagnosable message when `!allowed` (surface this instead of "forbidden"). */
  reason?: string;
}

/** Authorize `userId` as an admin (lead_admin) of `cycleId` or of the workspace. */
export async function authorizeCycleAdmin(
  admin: SupabaseAdminClient,
  userId: string,
  cycleId: string,
): Promise<CycleAdminDecision> {
  const { data, error } = await admin
    .from("memberships")
    .select("role,cycle_id")
    .eq("user_id", userId);

  if (error) {
    return {
      allowed: false,
      reason: `Couldn’t verify your access — reading your workspace roles failed: ${error.message}`,
    };
  }

  const memberships = (data ?? []) as unknown as Membership[];
  // The one authorization rule (mirrors the DB `app.has_role(cycle,'lead_admin')`):
  // a workspace admin (cycle_id = NULL) or a per-cycle admin may manage the cycle.
  if (canManageCycle(memberships, cycleId)) return { allowed: true };

  const seen = memberships.length
    ? memberships
        .map((m) => `${m.role}${m.cycle_id === null ? " (workspace)" : ` @cycle ${m.cycle_id.slice(0, 8)}`}`)
        .join(", ")
    : "none";
  return {
    allowed: false,
    reason:
      `Not authorized: this action needs an admin (lead_admin) membership on this cycle ` +
      `or a workspace-wide (cycle_id = NULL) admin membership. Roles found for your account: ${seen}.`,
  };
}
