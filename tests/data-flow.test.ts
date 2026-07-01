/**
 * Developer data-flow model (task 15) — the read-only assembler behind the
 * "see the data + transformation at each stage" view.
 *
 * Proves the four real pipeline artifacts are exposed in order (Ingested →
 * Cleaned cohort → Score matrix → Computed scores), that per-subject
 * participant/item counts come straight from the provider's own reads (no
 * re-derivation), that a participant drop between stages is flagged, that a single
 * participant can be traced across every stage, and that the whole assembly is
 * strictly read-only (it never bumps the provider version).
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";
import { buildDataFlow, DATA_FLOW_STAGES } from "@/lib/data/data-flow";

const liveId = (p: DataProvider) => p.listCycles().find((c) => c.live)!.id;

describe("developer data-flow model", () => {
  it("exposes the four pipeline stages, in order, each keyed on the internal participant id", () => {
    expect(DATA_FLOW_STAGES.map((s) => s.key)).toEqual(["ingested", "cleaned", "matrix", "computed"]);
    expect(DATA_FLOW_STAGES.map((s) => s.label)).toEqual([
      "Ingested",
      "Cleaned cohort",
      "Score matrix",
      "Computed scores",
    ]);
    // Each stage names the real key it operates on (identity / cohort / pivot / score).
    for (const s of DATA_FLOW_STAGES) expect(s.operatesOn.length).toBeGreaterThan(0);
  });

  it("assembles per-subject counts and artifact tables for the live cycle", () => {
    const p = new InMemoryDataProvider();
    const cid = liveId(p);
    const m = buildDataFlow(p, cid);
    expect(m).toBeTruthy();
    expect(m!.subjects.length).toBeGreaterThan(0);

    for (const s of m!.subjects) {
      for (const k of ["ingested", "cleaned", "matrix", "computed"] as const) {
        expect(s.counts[k].participants).toBeGreaterThan(0);
        expect(s.counts[k].items).toBeGreaterThan(0);
      }
      // Ingested is the fullest cohort — never fewer participants than downstream.
      expect(s.counts.ingested.participants).toBeGreaterThanOrEqual(s.counts.cleaned.participants);
      // The score matrix reconciles 1:1 with the cleaned cohort (the pivot / fillna
      // drops nobody) — a mismatch here would be a real collapse.
      expect(s.counts.matrix.participants).toBe(s.counts.cleaned.participants);
      // Each artifact table's distinct participant rows match the strip's count.
      expect(new Set(s.tables.ingested.participantIds.filter(Boolean)).size).toBe(s.counts.ingested.participants);
      // Cleaned cohort count = shown rows minus the struck (excluded) rows.
      expect(s.tables.cleaned.participantIds.length - s.tables.cleaned.struckRows.length).toBe(
        s.counts.cleaned.participants,
      );
    }
  });

  it("is strictly read-only — buildDataFlow never bumps the provider version", () => {
    const p = new InMemoryDataProvider();
    const cid = liveId(p);
    const v0 = p.getVersion();
    buildDataFlow(p, cid);
    buildDataFlow(p, cid);
    expect(p.getVersion()).toBe(v0);
  });

  it("flags a participant drop between Ingested and Cleaned when a participant is excluded", () => {
    const p = new InMemoryDataProvider();
    const cid = liveId(p);
    const before = buildDataFlow(p, cid)!;
    const subj = before.subjects[0]!;
    // A live (non-excluded) participant from the score matrix — excluding them must
    // drop the cleaned cohort by exactly one and light up the collapse marker.
    const victim = subj.tables.matrix.participantIds.find((x): x is string => !!x)!;

    p.excludeParticipantFromCohort(cid, victim, true, "developer-view test");

    const after = buildDataFlow(p, cid)!;
    const s = after.subjects.find((x) => x.assessmentId === subj.assessmentId)!;
    expect(s.counts.cleaned.participants).toBe(subj.counts.cleaned.participants - 1);
    expect(s.counts.cleaned.participantDrop).toBe(true);
    expect(s.counts.cleaned.prevParticipants).toBe(s.counts.ingested.participants);
    expect(s.hasParticipantDrop).toBe(true);

    // The excluded participant is struck in the cleaned table and gone from the matrix.
    const idx = s.tables.cleaned.participantIds.indexOf(victim);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(s.tables.cleaned.struckRows).toContain(idx);
    expect(s.tables.matrix.participantIds).not.toContain(victim);
  });

  it("lets a single participant be traced across every stage (input → output)", () => {
    const p = new InMemoryDataProvider();
    const cid = liveId(p);
    const m = buildDataFlow(p, cid)!;
    const s = m.subjects[0]!;
    const pid = s.tables.matrix.participantIds.find((x): x is string => !!x)!;

    // Present at every stage of a subject they sat, with a computed-scores row.
    expect(s.tables.ingested.participantIds).toContain(pid);
    expect(s.tables.cleaned.participantIds).toContain(pid);
    expect(s.tables.matrix.participantIds).toContain(pid);
    expect(s.tables.computed.participantIds).toContain(pid);
    const compIdx = s.tables.computed.participantIds.indexOf(pid);
    // computed row: [name, id, mcq, essay, alterations, total, max, pct]
    expect(s.tables.computed.rows[compIdx]!.length).toBe(8);
  });

  it("returns null for an unknown cycle and carries ingest provenance for the live one", () => {
    const p = new InMemoryDataProvider();
    expect(buildDataFlow(p, "no-such-cycle")).toBeNull();
    const m = buildDataFlow(p, liveId(p))!;
    expect(m.ingest).toBeTruthy();
    expect(m.ingest!.mcqRows).toBeGreaterThan(0);
  });
});
