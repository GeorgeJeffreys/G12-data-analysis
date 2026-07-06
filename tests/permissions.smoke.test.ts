/**
 * PERMISSION SMOKE TEST — the guardrail for the rebuilt authorization model
 * (migration 0025). It asserts the ONE membership rule permits/denies exactly as
 * specified, so an auth regression fails CI instead of surfacing on the live app as
 * "forbidden" (the paired delete/replace outage this rebuild resets).
 *
 * The model under test (app-layer twin of the DB `app.has_role`, lib/auth/membership-
 * access.ts + lib/auth/authorize-cycle.ts):
 *   * a WORKSPACE admin (cycle_id = NULL, top role) can READ, WRITE/DELETE, and manage
 *     memberships on EVERY cycle and on workspace-scoped rows;
 *   * a CYCLE admin can do so for THEIR cycle only;
 *   * a MEMBER (viewer/reviewer/analyst) can READ but NOT write/delete/manage.
 *
 * The build environment has no DB, so this exercises the model through the shared JS
 * helpers every server/UI gate routes through (the DB policies are text-asserted in
 * tests/migration.authorization-rebuild.test.ts). Both layers encode the same rule.
 */
import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import {
  effectiveTierForCycle,
  canReadCycle,
  canManageCycle,
  type Membership,
} from "@/lib/auth/membership-access";

vi.mock("server-only", () => ({}));
const { authorizeCycleAdmin } = await import("@/lib/auth/authorize-cycle");

const CYCLE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

/** Admin-client stand-in: `.from().select().eq()` → the caller's membership rows. */
function adminWith(rows: Membership[]) {
  return {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: rows, error: null }) }) }),
  } as never;
}

describe("permission smoke test — the rebuilt authorization model", () => {
  describe("workspace admin (lead_admin, cycle_id = NULL)", () => {
    const ws: Membership[] = [{ role: "lead_admin", cycle_id: null }];

    it("is admin on every cycle: read + write/delete + manage memberships", () => {
      for (const c of [CYCLE, OTHER]) {
        expect(canReadCycle(ws, c)).toBe(true);
        expect(canManageCycle(ws, c)).toBe(true);
      }
    });

    it("is admin on workspace-scoped rows (cycleId = null)", () => {
      expect(canManageCycle(ws, null)).toBe(true);
      expect(canReadCycle(ws, null)).toBe(true);
    });

    it("passes the server-side ingest/delete gate on any cycle", async () => {
      expect((await authorizeCycleAdmin(adminWith(ws), "u", CYCLE)).allowed).toBe(true);
      expect((await authorizeCycleAdmin(adminWith(ws), "u", OTHER)).allowed).toBe(true);
    });
  });

  describe("cycle admin (lead_admin @ CYCLE)", () => {
    const ca: Membership[] = [{ role: "lead_admin", cycle_id: CYCLE }];

    it("can read + write/delete + manage memberships on THEIR cycle", () => {
      expect(canReadCycle(ca, CYCLE)).toBe(true);
      expect(canManageCycle(ca, CYCLE)).toBe(true);
    });

    it("cannot act on a DIFFERENT cycle, nor on workspace-scoped rows", () => {
      expect(canReadCycle(ca, OTHER)).toBe(false);
      expect(canManageCycle(ca, OTHER)).toBe(false);
      expect(canManageCycle(ca, null)).toBe(false); // a cycle membership never authorizes workspace scope
    });

    it("server gate: allowed on THEIR cycle, denied elsewhere with a diagnosable reason", async () => {
      expect((await authorizeCycleAdmin(adminWith(ca), "u", CYCLE)).allowed).toBe(true);
      const d = await authorizeCycleAdmin(adminWith(ca), "u", OTHER);
      expect(d.allowed).toBe(false);
      expect(d.reason).toMatch(/lead_admin/i);
      expect(d.reason).not.toBe("forbidden");
    });
  });

  describe("members (below admin) — read only", () => {
    it("a reviewer/viewer can READ their cycle but NOT write/delete/manage", () => {
      for (const role of ["viewer", "reviewer"] as const) {
        const m: Membership[] = [{ role, cycle_id: CYCLE }];
        expect(canReadCycle(m, CYCLE)).toBe(true);
        expect(canManageCycle(m, CYCLE)).toBe(false);
      }
    });

    it("an analyst can READ but is still NOT an admin (no write/delete/manage)", () => {
      const m: Membership[] = [{ role: "analyst", cycle_id: CYCLE }];
      expect(canReadCycle(m, CYCLE)).toBe(true);
      expect(canManageCycle(m, CYCLE)).toBe(false);
    });

    it("server gate denies a member and names the roles found (never bare 'forbidden')", async () => {
      const d = await authorizeCycleAdmin(adminWith([{ role: "reviewer", cycle_id: CYCLE }]), "u", CYCLE);
      expect(d.allowed).toBe(false);
      expect(d.reason).toMatch(/reviewer/i);
    });
  });

  describe("effective role = higher of workspace and per-cycle", () => {
    it("a workspace analyst + cycle admin resolves to admin on that cycle", () => {
      const m: Membership[] = [
        { role: "analyst", cycle_id: null },
        { role: "lead_admin", cycle_id: CYCLE },
      ];
      expect(effectiveTierForCycle(m, CYCLE)).toBe("admin");
      expect(canManageCycle(m, CYCLE)).toBe(true);
      // …but only analyst (read, no manage) on a cycle they don't admin.
      expect(effectiveTierForCycle(m, OTHER)).toBe("analyst");
      expect(canManageCycle(m, OTHER)).toBe(false);
    });

    it("a non-member gets a null effective tier (no read, no manage)", () => {
      expect(effectiveTierForCycle([], CYCLE)).toBeNull();
      expect(canReadCycle([], CYCLE)).toBe(false);
      expect(canManageCycle([], CYCLE)).toBe(false);
    });
  });
});
