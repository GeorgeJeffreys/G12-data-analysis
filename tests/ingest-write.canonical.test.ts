/**
 * Server ingest write path — richer 3-CSV intake (migration 0006).
 *
 * Proves that when the canonical model is supplied, the write also persists the
 * faithful extras: participant personal fields, per-item type/status/topic,
 * per-result QM totals (`result_totals`) and per-topic rollups (`topic_rollups`).
 * Uses the anonymised fixtures + a mock admin client (Supabase is unreachable
 * here), exactly like the created-by test.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ingestThreeExports, type NamedInput } from "@/lib/ingest/qm";

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

interface Captured { name: string; rows: Record<string, unknown>[] }
function makeAdmin(captured: Captured[]) {
  let counter = 0;
  return {
    from(name: string) {
      return {
        insert(rows: unknown) {
          const arr = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
          captured.push({ name, rows: arr });
          const data = arr.map((r) => ({
            id: `${name}-${++counter}`,
            qm_question_id: r.qm_question_id,
            assessment_id: r.assessment_id,
            qm_participant_id: r.qm_participant_id,
          }));
          const result = { data, error: null };
          const thenable = Promise.resolve(result) as Promise<typeof result> & {
            select: (c?: string) => Promise<typeof result>;
          };
          thenable.select = () => Promise.resolve(result);
          return thenable;
        },
        delete() {
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };
}

const { canonical, cleanedResponses } = ingestThreeExports(files());

describe("ingestCleanResponses — richer canonical persistence", () => {
  it("persists participant personal fields, item metadata, result totals and topic rollups", async () => {
    const captured: Captured[] = [];
    await ingestCleanResponses(makeAdmin(captured) as never, "cycle-1", cleanedResponses, {
      createdBy: "user-1",
      canonical,
      files: { items: "Items.csv", assessments: "Assessments.csv", topics: "Topics.csv" },
    });

    const rowsFor = (name: string) => captured.filter((c) => c.name === name).flatMap((c) => c.rows);

    // Participants carry the retained personal fields.
    const participants = rowsFor("participants");
    expect(participants.length).toBe(18);
    expect(participants.every((p) => typeof p.email === "string" && (p.email as string).includes("@"))).toBe(true);
    expect(participants.some((p) => p.dob && /^\d{4}-\d{2}-\d{2}$/.test(p.dob as string))).toBe(true);
    expect(participants.some((p) => p.first_name && p.last_name)).toBe(true);

    // Items carry QuestionType + QuestionStatus + topic metadata.
    const items = rowsFor("items");
    expect(items.some((i) => i.question_type === "Multiple Choice")).toBe(true);
    expect(items.some((i) => (i.question_status as string)?.toLowerCase() === "beta")).toBe(true);
    expect(items.some((i) => i.topic_path)).toBe(true);

    // result_totals: one per graded result, with QM's trusted totals + sitting.
    const resultTotals = rowsFor("result_totals");
    expect(resultTotals.length).toBe(canonical.results.length);
    expect(resultTotals.every((r) => typeof r.maximum_score === "number")).toBe(true);
    expect(resultTotals.some((r) => r.attempt_number === 2)).toBe(true);
    expect(resultTotals.every((r) => r.sitting === "MAY2026")).toBe(true);
    expect(resultTotals.every((r) => r.reconciled === true)).toBe(true);

    // topic_rollups: QM per-topic scores carried through.
    const topicRollups = rowsFor("topic_rollups");
    expect(topicRollups.length).toBeGreaterThan(0);
    expect(topicRollups.every((t) => typeof t.maximum_score === "number" && typeof t.topic_name === "string")).toBe(true);

    // import batch records the three filenames + reconciliation summary.
    const batch = rowsFor("import_batches")[0]!;
    expect(batch.items_file).toBe("Items.csv");
    expect(batch.results_total).toBe(canonical.integrity.resultsChecked);
    expect(batch.results_reconciled).toBe(canonical.integrity.reconciled);
  });

  it("still works (and writes no new-table rows) without a canonical model", async () => {
    const captured: Captured[] = [];
    await ingestCleanResponses(makeAdmin(captured) as never, "cycle-2", cleanedResponses, {
      createdBy: "user-1",
    });
    expect(captured.filter((c) => c.name === "result_totals").flatMap((c) => c.rows)).toHaveLength(0);
    expect(captured.filter((c) => c.name === "topic_rollups").flatMap((c) => c.rows)).toHaveLength(0);
    // The engine matrix (assessments/items/participants/responses) is still written.
    expect(captured.some((c) => c.name === "responses")).toBe(true);
  });
});
