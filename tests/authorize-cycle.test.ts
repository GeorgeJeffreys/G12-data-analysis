/**
 * authorizeCycleAdmin — the server-side gate for cycle data-mutations (ingest /
 * recompute). Task 20: it must honour a WORKSPACE admin (cycle_id = NULL) and
 * surface a concrete reason on denial, never a bare "forbidden".
 *
 * The gate reads the caller's OWN membership rows via the admin (service-role)
 * client, so we mock a client whose `.from("memberships").select().eq()` resolves
 * to a fixed row set.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { authorizeCycleAdmin } = await import("@/lib/auth/authorize-cycle");

type Row = { role: string; cycle_id: string | null };

/** Minimal admin-client stand-in: `.from().select().eq()` → the given rows. */
function adminWith(rows: Row[] | null, error?: { message: string }) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: rows, error: error ?? null });
            },
          };
        },
      };
    },
  } as never;
}

const CYCLE = "11111111-1111-1111-1111-111111111111";

describe("authorizeCycleAdmin", () => {
  it("permits a workspace admin (lead_admin, cycle_id = NULL) on any cycle", async () => {
    const d = await authorizeCycleAdmin(adminWith([{ role: "lead_admin", cycle_id: null }]), "u1", CYCLE);
    expect(d.allowed).toBe(true);
  });

  it("permits a per-cycle admin on THAT cycle", async () => {
    const d = await authorizeCycleAdmin(adminWith([{ role: "lead_admin", cycle_id: CYCLE }]), "u1", CYCLE);
    expect(d.allowed).toBe(true);
  });

  it("denies a per-cycle admin of a DIFFERENT cycle, with a diagnosable reason", async () => {
    const other = "22222222-2222-2222-2222-222222222222";
    const d = await authorizeCycleAdmin(adminWith([{ role: "lead_admin", cycle_id: other }]), "u1", CYCLE);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/lead_admin/i);
    expect(d.reason).not.toBe("forbidden");
  });

  it("denies a non-admin and names the roles found (never a bare 'forbidden')", async () => {
    const d = await authorizeCycleAdmin(adminWith([{ role: "reviewer", cycle_id: CYCLE }]), "u1", CYCLE);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/roles found/i);
    expect(d.reason).toMatch(/reviewer/i);
  });

  it("denies with 'none' when the account has no memberships", async () => {
    const d = await authorizeCycleAdmin(adminWith([]), "u1", CYCLE);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/none/i);
  });

  it("surfaces the read error rather than masking it as a permission denial", async () => {
    const d = await authorizeCycleAdmin(adminWith(null, { message: "boom" }), "u1", CYCLE);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/boom/);
  });
});
