/**
 * Test stand-in for the Supabase admin client used by the ingest write path.
 *
 * Since migration 0007 the persist is a SINGLE atomic call to the `ingest_persist`
 * SQL function (clear-then-insert in one transaction), so the write path no longer
 * issues per-table `.from().insert()` calls — it calls `.rpc("ingest_persist", …)`
 * exactly once. This mock records every rpc call (name + args) so tests can inspect
 * the payload, and lets a test force the rpc to fail (to prove all-or-nothing).
 */
export interface RpcCall {
  name: string;
  args: { p_cycle: string; p_payload: IngestPayload; p_actor: string };
}

export interface IngestPayload {
  assessments: Record<string, unknown>[];
  items: Record<string, unknown>[];
  participants: Record<string, unknown>[];
  responses: Record<string, unknown>[];
  result_totals: Record<string, unknown>[];
  topic_rollups: Record<string, unknown>[];
  import_batch: Record<string, unknown>;
}

export function makeRpcAdmin(calls: RpcCall[], opts?: { fail?: string }) {
  return {
    // The write path also `.from(...)` is NEVER expected post-0007; if anything
    // calls it, surface that loudly so a regression to per-table inserts fails.
    from(name: string): never {
      throw new Error(`unexpected .from(${name}) — persist must be a single rpc`);
    },
    rpc(name: string, args: RpcCall["args"]) {
      calls.push({ name, args });
      if (opts?.fail) return Promise.resolve({ data: null, error: { message: opts.fail } });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  };
}
