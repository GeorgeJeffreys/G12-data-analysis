/**
 * Server ingest write path — topic rollups keyed on the topic ID, not the name
 * (migration 0007).
 *
 * QM's topic tree contains distinct topics (different TopicIds) that share the
 * same display TopicName within ONE result. 0006 keyed topic_rollups on
 * (cycle_id, qm_result_id, topic_name), which collided on the FIRST upload. 0007
 * re-keys onto qm_topic_id. These tests prove against the real (anonymised)
 * fixture that:
 *   * the payload preserves same-name / different-id topics within a result
 *     (the documented 24-collision case) rather than collapsing them;
 *   * the new key (qm_result_id, qm_topic_id) is collision-free, while the old
 *     key (qm_result_id, topic_name) would have collided — so the constraint is
 *     now on the right column.
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

async function topicRows(): Promise<Record<string, unknown>[]> {
  const calls: RpcCall[] = [];
  await ingestCleanResponses(makeRpcAdmin(calls) as never, "cycle-1", cleanedResponses, {
    createdBy: "user-1",
    canonical,
  });
  return calls[0]!.args.p_payload.topic_rollups;
}

describe("topic_rollups keyed on qm_topic_id (0007)", () => {
  it("preserves same-name / different-id topics within one result", async () => {
    const rows = await topicRows();
    // Group ids by (result, name); a name appearing at >1 id within a result is
    // the collision case the old name-key could not represent.
    const idsByResultName = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = `${r.qm_result_id}|${r.topic_name}`;
      const set = idsByResultName.get(k) ?? new Set<string>();
      set.add(String(r.qm_topic_id));
      idsByResultName.set(k, set);
    }
    const sameNameDiffId = [...idsByResultName.values()].filter((s) => s.size > 1);
    // The fixture mirrors the real export: same-name topics at distinct ids
    // (e.g. "Evaluating meaning" at two TopicIds) are kept, not merged.
    expect(sameNameDiffId.length).toBeGreaterThan(0);
  });

  it("is collision-free on (qm_result_id, qm_topic_id) but WOULD collide on (qm_result_id, topic_name)", async () => {
    const rows = await topicRows();

    const byId = new Set<string>();
    let idCollisions = 0;
    const byName = new Set<string>();
    let nameCollisions = 0;
    for (const r of rows) {
      const idKey = `${r.qm_result_id}|${r.qm_topic_id}`;
      if (byId.has(idKey)) idCollisions++;
      byId.add(idKey);

      const nameKey = `${r.qm_result_id}|${r.topic_name}`;
      if (byName.has(nameKey)) nameCollisions++;
      byName.add(nameKey);
    }

    // The new key is the correct natural key — no duplicates, so the first
    // upload no longer violates the unique constraint.
    expect(idCollisions).toBe(0);
    // The old name-based key would have collided (the documented case) — proving
    // the constraint was on the wrong column.
    expect(nameCollisions).toBeGreaterThan(0);

    // Every rollup row carries a topic id (the column is NOT NULL in 0007).
    expect(rows.every((r) => !!r.qm_topic_id)).toBe(true);
  });
});
