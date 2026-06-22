/**
 * Server ingest write path — richer 3-CSV intake (migration 0006), persisted via
 * the single atomic `ingest_persist` rpc (migration 0007).
 *
 * Proves that when the canonical model is supplied, the payload handed to the SQL
 * function carries the faithful extras: participant personal fields, per-item
 * type/status/topic, per-result QM totals (`result_totals`) and per-topic rollups
 * (`topic_rollups`). Uses the anonymised fixtures + a mock admin that captures the
 * rpc payload (Supabase is unreachable here), exactly like the created-by test.
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

describe("ingestCleanResponses — richer canonical persistence (single rpc)", () => {
  it("persists participant personal fields, item metadata, result totals and topic rollups", async () => {
    const calls: RpcCall[] = [];
    await ingestCleanResponses(makeRpcAdmin(calls) as never, "cycle-1", cleanedResponses, {
      createdBy: "user-1",
      canonical,
      files: { items: "Items.csv", assessments: "Assessments.csv", topics: "Topics.csv" },
    });

    expect(calls).toHaveLength(1);
    const p = calls[0]!.args.p_payload;

    // Participants carry the retained personal fields.
    expect(p.participants.length).toBe(18);
    expect(p.participants.every((r) => typeof r.email === "string" && (r.email as string).includes("@"))).toBe(true);
    expect(p.participants.some((r) => r.dob && /^\d{4}-\d{2}-\d{2}$/.test(r.dob as string))).toBe(true);
    expect(p.participants.some((r) => r.first_name && r.last_name)).toBe(true);

    // Items carry QuestionType + QuestionStatus + topic metadata.
    expect(p.items.some((i) => i.question_type === "Multiple Choice")).toBe(true);
    expect(p.items.some((i) => (i.question_status as string)?.toLowerCase() === "beta")).toBe(true);
    expect(p.items.some((i) => i.topic_path)).toBe(true);

    // result_totals: one per graded result, with QM's trusted totals + sitting.
    expect(p.result_totals.length).toBe(canonical.results.length);
    expect(p.result_totals.every((r) => typeof r.maximum_score === "number")).toBe(true);
    expect(p.result_totals.some((r) => r.attempt_number === 2)).toBe(true);
    expect(p.result_totals.every((r) => r.sitting === "MAY2026")).toBe(true);
    expect(p.result_totals.every((r) => r.reconciled === true)).toBe(true);

    // topic_rollups: QM per-topic scores carried through, each with its topic id.
    expect(p.topic_rollups.length).toBeGreaterThan(0);
    expect(
      p.topic_rollups.every(
        (t) => typeof t.maximum_score === "number" && typeof t.topic_name === "string" && !!t.qm_topic_id,
      ),
    ).toBe(true);

    // import batch records the three filenames + reconciliation summary.
    expect(p.import_batch.items_file).toBe("Items.csv");
    expect(p.import_batch.results_total).toBe(canonical.integrity.resultsChecked);
    expect(p.import_batch.results_reconciled).toBe(canonical.integrity.reconciled);
  });

  it("still works (and carries no new-table rows) without a canonical model", async () => {
    const calls: RpcCall[] = [];
    await ingestCleanResponses(makeRpcAdmin(calls) as never, "cycle-2", cleanedResponses, {
      createdBy: "user-1",
    });
    const p = calls[0]!.args.p_payload;
    expect(p.result_totals).toHaveLength(0);
    expect(p.topic_rollups).toHaveLength(0);
    // The engine matrix (assessments/items/participants/responses) is still written.
    expect(p.responses.length).toBeGreaterThan(0);
  });
});
