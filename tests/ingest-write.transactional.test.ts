/**
 * Server ingest write path — transactional + idempotent persist (migration 0007).
 *
 * The real Questionmark upload failed because the old persist was a sequence of
 * separate REST inserts: when topic_rollups blew up, the assessments/items
 * inserted first were stranded as partial rows. 0007 makes the whole persist ONE
 * atomic `ingest_persist` rpc (clear-then-insert in a single transaction). These
 * tests prove the application side of that contract against the fixtures:
 *   * the persist is a SINGLE write call (so a failure can't leave partial rows);
 *   * re-uploading the same sitting yields identical row counts (clean replace,
 *     not duplication);
 *   * when the rpc fails the call throws and nothing else is written.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ingestThreeExports, type NamedInput } from "@/lib/ingest/qm";
import { makeRpcAdmin, type RpcCall } from "./helpers/mock-rpc-admin";

vi.mock("server-only", () => ({}));
const { ingestCleanResponses } = await import("@/lib/server/ingest-write");

const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const read = (name: string) => readFileSync(path.join(qmDir, `${name}.csv`));
function files(): NamedInput[] {
  return [
    { name: "Items.csv", data: read("Items") },
    { name: "Assessments.csv", data: read("Assessments") },
    { name: "Topics.csv", data: read("Topics") },
  ];
}

const { canonical, cleanedResponses } = ingestThreeExports(files());

function counts(p: RpcCall["args"]["p_payload"]) {
  return {
    assessments: p.assessments.length,
    items: p.items.length,
    participants: p.participants.length,
    responses: p.responses.length,
    result_totals: p.result_totals.length,
    topic_rollups: p.topic_rollups.length,
  };
}

describe("ingestCleanResponses — transactional + idempotent", () => {
  it("persists through a SINGLE atomic rpc (no per-table inserts)", async () => {
    const calls: RpcCall[] = [];
    // makeRpcAdmin throws on any `.from(...)`, so a regression to per-table
    // inserts would fail this test loudly.
    await ingestCleanResponses(makeRpcAdmin(calls) as never, "cycle-1", cleanedResponses, {
      createdBy: "user-1",
      canonical,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("ingest_persist");
    expect(calls[0]!.args.p_cycle).toBe("cycle-1");
  });

  it("re-uploading the same sitting replaces rather than duplicates (stable row counts)", async () => {
    const first: RpcCall[] = [];
    await ingestCleanResponses(makeRpcAdmin(first) as never, "cycle-1", cleanedResponses, {
      createdBy: "user-1",
      canonical,
    });
    const second: RpcCall[] = [];
    await ingestCleanResponses(makeRpcAdmin(second) as never, "cycle-1", cleanedResponses, {
      createdBy: "user-1",
      canonical,
    });

    // Each upload is a single atomic clear-then-insert, so two ingests of the
    // same data carry identical counts — re-upload replaces, never accumulates.
    expect(counts(second[0]!.args.p_payload)).toEqual(counts(first[0]!.args.p_payload));
    expect(counts(first[0]!.args.p_payload).topic_rollups).toBeGreaterThan(0);
  });

  it("rolls back whole on a mid-ingest failure — throws and writes nothing partial", async () => {
    const calls: RpcCall[] = [];
    const admin = makeRpcAdmin(calls, {
      fail: 'duplicate key value violates unique constraint "topic_rollups_…"',
    });
    await expect(
      ingestCleanResponses(admin as never, "cycle-1", cleanedResponses, {
        createdBy: "user-1",
        canonical,
      }),
    ).rejects.toThrow(/ingest_persist/);

    // Exactly one (failed) atomic call — there is no second statement that could
    // have left assessments/items behind. The SQL function's transaction rolls
    // the clear+inserts back as a unit.
    expect(calls).toHaveLength(1);
  });
});
