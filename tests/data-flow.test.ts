/**
 * Developer "Data flow" model (task 15) — the read-only assembler behind the
 * pipeline-inspector page (design: hfDataFlow.jsx).
 *
 * Proves the four real pipeline stages are exposed in order, that per-subject
 * per-stage participant counts and per-participant journeys come straight from the
 * provider's own reads (keyed on the internal participant id, staff/test never
 * counted), that the three page states are data-driven, that a real drop is
 * detected + traceable, and that the whole assembly is strictly read-only.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";
import { buildDataFlow, DF_STAGES } from "@/lib/data/data-flow";
import { isStaffTestEmail } from "@/lib/data/staff-exclusions";

const liveId = (p: DataProvider) => p.listCycles().find((c) => c.live)!.id;

describe("developer data-flow model", () => {
  it("exposes the four real pipeline stages in order", () => {
    expect(DF_STAGES.map((s) => s.key)).toEqual(["ingested", "cleaned", "matrix", "computed"]);
    expect(DF_STAGES.map((s) => s.name)).toEqual(["Ingested", "Cleaned cohort", "Score matrix", "Computed scores"]);
  });

  it("assembles per-subject stage counts + journeys keyed on the internal participant id", () => {
    const p = new InMemoryDataProvider();
    const m = buildDataFlow(p, liveId(p))!;
    expect(m).toBeTruthy();
    expect(m.subjects.length).toBeGreaterThan(0);

    for (const s of m.subjects) {
      expect(s.counts).toHaveLength(4);
      // Ingested holds the most participants; never fewer downstream.
      expect(s.counts[0]).toBeGreaterThanOrEqual(s.counts[3]!);
      // The count at each stage = the number of people whose journey reaches it.
      expect(s.counts[0]).toBe(s.people.length);
      expect(s.counts[3]).toBe(s.people.filter((pp) => pp.last === 3).length);
      // Every person is keyed on an internal id and carries their real cells.
      for (const person of s.people) {
        expect(person.id).toBeTruthy();
        expect(person.cells).toHaveLength(s.items);
        expect(person.staff).toBeFalsy(); // staff never counted as participants
      }
    }
  });

  it("never counts a staff/test account as a participant, and only ever surfaces staff in the struck list", () => {
    const p = new InMemoryDataProvider();
    const m = buildDataFlow(p, liveId(p))!;
    // Invariant (holds whether or not the de-identified demo carries staff rows):
    // no counted participant is a staff/test email, and every struck row is one.
    for (const s of m.subjects) {
      expect(s.people.some((pp) => isStaffTestEmail(pp.email))).toBe(false);
      for (const st of s.staff) {
        expect(st.staff).toBe(true);
        expect(isStaffTestEmail(st.email)).toBe(true);
      }
    }
  });

  it("reports the healthy state for the fixed live cycle (no collapse)", () => {
    const p = new InMemoryDataProvider();
    const m = buildDataFlow(p, liveId(p))!;
    // The identity-collapse bug is fixed, so the real live cycle holds its counts.
    expect(m.state).toBe("healthy");
    expect(m.lost).toBe(0);
    for (const s of m.subjects) expect(new Set(s.counts).size).toBe(1);
  });

  it("switches to the collapse state and traces the dropped participant when one is excluded", () => {
    const p = new InMemoryDataProvider();
    const cid = liveId(p);
    const before = buildDataFlow(p, cid)!;
    const subj = before.subjects[0]!;
    // A live sitter (present through every stage) — excluding them must drop the
    // cleaned cohort and flip the page into the collapse state.
    const victim = subj.people.find((pp) => pp.last === 3)!;

    p.excludeParticipantFromCohort(cid, victim.id, true, "data-flow test");

    const after = buildDataFlow(p, cid)!;
    expect(after.state).toBe("collapse");
    // Excluded cohort-wide, so lost = the number of subjects the victim sat (≥ 1).
    expect(after.lost).toBeGreaterThanOrEqual(1);
    expect(after.worstStage).toBeTruthy();

    const s = after.subjects.find((x) => x.key === subj.key)!;
    expect(s.counts[1]).toBe(subj.counts[1]! - 1); // dropped at Cleaned in this subject
    // The victim is still ingested (raw is untouched) but now dropped at Cleaned.
    const traced = s.people.find((pp) => pp.id === victim.id)!;
    expect(traced.last).toBe(0); // present only at Ingested now
  });

  it("is strictly read-only — buildDataFlow never bumps the provider version", () => {
    const p = new InMemoryDataProvider();
    const cid = liveId(p);
    const v0 = p.getVersion();
    buildDataFlow(p, cid);
    buildDataFlow(p, cid);
    expect(p.getVersion()).toBe(v0);
  });

  it("returns null for an unknown cycle", () => {
    const p = new InMemoryDataProvider();
    expect(buildDataFlow(p, "no-such-cycle")).toBeNull();
  });
});
