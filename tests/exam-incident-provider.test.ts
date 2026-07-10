/**
 * Provider round-trip for the technical-incident staging (0043), in-memory (the
 * behaviour the Supabase provider mirrors). Builds the match context from the real
 * seed, matches an incident for a REAL sitting on the email join key, upserts the
 * batch, reads it back, rebuilds the reconciliation, proves idempotency (re-upsert
 * by Reference never duplicates), and clears. No marks are ever adjusted.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { parseExamIncidentRows, EXAM_INCIDENT_HEADERS } from "@/lib/incidents/exam-incident-parse";
import { matchExamIncidents } from "@/lib/incidents/exam-incident-match";
import seedJson from "@/lib/data/seed.generated.json";

const seed = seedJson as unknown as { liveCycle: { id: string } };
const CYCLE = seed.liveCycle.id;

const HEADER = Object.values(EXAM_INCIDENT_HEADERS);
function row(patch: Partial<Record<keyof typeof EXAM_INCIDENT_HEADERS, string>>): string[] {
  const keys = Object.keys(EXAM_INCIDENT_HEADERS) as (keyof typeof EXAM_INCIDENT_HEADERS)[];
  return keys.map((k) => patch[k] ?? "");
}

/** A matched incident row for the first real sitting in the seed. */
function matchedBatch(p: InMemoryDataProvider, batchId: string, reference: string) {
  const ctx = p.getExamIncidentMatchContext(CYCLE)!;
  const sitting = ctx.sittings[0]!;
  const subject = ctx.subjects.find((s) => s.code === sitting.subjectCode)!;
  const rows = [row({
    reference,
    examCycle: ctx.activeCycleName,
    subject: subject.name,
    studentName: sitting.name,
    studentEmail: sitting.email.toUpperCase(), // upper-cased on purpose — parser lowercases
    studentId: "STU-LABEL-ONLY",
    duration: "30",
  })];
  const rep = matchExamIncidents(parseExamIncidentRows([HEADER, ...rows]), ctx, { batchId, fileName: "exam-incidents.csv" });
  return { rep, sitting };
}

describe("exam-incident provider round-trip (in-memory)", () => {
  it("matches a real sitting, stages it, and reads it back", () => {
    const p = new InMemoryDataProvider();
    const { rep, sitting } = matchedBatch(p, "batch-1", "INC-RT-1");
    expect(rep.counts.matched).toBe(1);

    p.upsertExamIncidents(CYCLE, "batch-1", "exam-incidents.csv", rep.records);
    const staged = p.getExamIncidentsForCycle(CYCLE);
    expect(staged).toHaveLength(1);
    expect(staged[0]!.reference).toBe("INC-RT-1");
    expect(staged[0]!.studentEmail).toBe(sitting.email); // lowercased join key
    expect(staged[0]!.matchStatus).toBe("matched");
    expect(staged[0]!.matchedQmResultId).toBe(sitting.qmResultId);
    // staging never adjusts
    expect(staged[0]!.adjustmentType).toBeNull();
    expect(staged[0]!.adjustmentMagnitude).toBeNull();
  });

  it("rebuilds the reconciliation report for a batch", () => {
    const p = new InMemoryDataProvider();
    const { rep } = matchedBatch(p, "batch-2", "INC-RT-2");
    p.upsertExamIncidents(CYCLE, "batch-2", "exam-incidents.csv", rep.records);

    const recon = p.getExamIncidentReconciliation(CYCLE, "batch-2")!;
    expect(recon.counts.matched).toBe(1);
    expect(recon.rows[0]!.reference).toBe("INC-RT-2");
    expect(p.getExamIncidentReconciliation(CYCLE, "no-such-batch")).toBeNull();
  });

  it("upserts by Reference — a re-upload updates, never duplicates", () => {
    const p = new InMemoryDataProvider();
    const first = matchedBatch(p, "batch-3a", "INC-RT-3");
    p.upsertExamIncidents(CYCLE, "batch-3a", "v1.csv", first.rep.records);
    expect(p.getExamIncidentsForCycle(CYCLE)).toHaveLength(1);

    // Re-upload the SAME reference (a corrected file, new batch id) → the second
    // pass sees it as a duplicate and updates the single record in place.
    const ctx = p.getExamIncidentMatchContext(CYCLE)!;
    expect(ctx.existingReferences).toContain("INC-RT-3");
    const second = matchedBatch(p, "batch-3b", "INC-RT-3");
    expect(second.rep.counts.duplicate).toBe(1);
    p.upsertExamIncidents(CYCLE, "batch-3b", "v2.csv", second.rep.records);
    const staged = p.getExamIncidentsForCycle(CYCLE);
    expect(staged).toHaveLength(1); // updated, not duplicated
    expect(staged[0]!.importBatchId).toBe("batch-3b");
  });

  it("clears a cycle's staged incidents", () => {
    const p = new InMemoryDataProvider();
    const { rep } = matchedBatch(p, "batch-4", "INC-RT-4");
    p.upsertExamIncidents(CYCLE, "batch-4", "exam-incidents.csv", rep.records);
    expect(p.getExamIncidentsForCycle(CYCLE)).toHaveLength(1);
    p.clearExamIncidents(CYCLE);
    expect(p.getExamIncidentsForCycle(CYCLE)).toHaveLength(0);
  });

  it("hydrateExamIncidents loads persisted records verbatim (Supabase replay)", () => {
    const p = new InMemoryDataProvider();
    const { rep } = matchedBatch(p, "batch-5", "INC-RT-5");
    p.hydrateExamIncidents(CYCLE, rep.records);
    const staged = p.getExamIncidentsForCycle(CYCLE);
    expect(staged).toHaveLength(1);
    expect(staged[0]!.matchStatus).toBe("matched");
  });
});
