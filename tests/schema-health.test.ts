/**
 * Schema-drift probe — `checkSchemaHealth` must call the client's `rpc` WITH its
 * receiver, not a detached copy.
 *
 * Regression for the ingest crash "Cannot read properties of undefined (reading
 * 'rest')" (task 16). supabase-js's `SupabaseClient.rpc()` is a method that reads
 * `this.rest` (its internal PostgREST sub-client). `checkSchemaHealth` used to
 * detach it — `const rpc = admin.rpc; await rpc("schema_health")` — which invokes
 * it unbound, so `this` is undefined and `this.rest` throws. This probe is the
 * FIRST thing the ingest route runs, so the TypeError crashed every ingest before
 * any data was touched (surfacing on Upload as "Try again").
 *
 * The mocks below mirror supabase-js faithfully: `rpc` is a prototype METHOD that
 * dereferences `this.rest`, so a detached (unbound) call reproduces the exact
 * production TypeError — this test fails against the buggy code and passes once the
 * call keeps its receiver.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkSchemaHealth } = await import("@/lib/server/schema-health");

type RpcResult = { data: unknown; error: { message: string } | null };

/** A client whose `rpc` reads `this.rest`, exactly like supabase-js — so an
 *  unbound call throws "Cannot read properties of undefined (reading 'rest')". */
class FaithfulClient {
  private readonly rest: { rpc: (fn: string, args?: unknown) => Promise<RpcResult> };
  constructor(result: RpcResult) {
    this.rest = { rpc: () => Promise.resolve(result) };
  }
  rpc(fn: string, args?: unknown): Promise<RpcResult> {
    // Mirrors supabase-js: `return this.rest.rpc(fn, args)`.
    return this.rest.rpc(fn, args);
  }
}

describe("checkSchemaHealth — receiver binding (ingest 'rest' crash regression)", () => {
  it("does not throw and reports the drift when the probe returns data", async () => {
    const client = new FaithfulClient({
      data: { ok: false, migration: "0020", missing_columns: ["items.item_set"], missing_functions: [] },
      error: null,
    });
    const health = await checkSchemaHealth(client as never);
    expect(health.ok).toBe(false);
    expect(health.migration).toBe("0020");
    expect(health.missingColumns).toContain("items.item_set");
  });

  it("degrades to healthy (never throws) when the probe itself is absent", async () => {
    const client = new FaithfulClient({
      data: null,
      error: { message: "Could not find the function public.schema_health in the schema cache" },
    });
    const health = await checkSchemaHealth(client as never);
    expect(health.ok).toBe(true);
  });

  it("a DETACHED rpc reproduces the exact production TypeError (guards the mock's fidelity)", async () => {
    const client = new FaithfulClient({ data: { ok: true }, error: null });
    const detached = client.rpc; // lose the receiver, as the bug did
    // The client reads `this.rest` synchronously, so an unbound call throws on
    // invocation (not as a rejected promise) — exactly what crashed the ingest route.
    expect(() => detached("schema_health")).toThrow(/Cannot read properties of undefined \(reading 'rest'\)/);
  });
});
