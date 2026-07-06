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

  it("treats a Clean-stage exclusion as an EXPECTED reduction (removedByCleaning), not a collapse", () => {
    const p = new InMemoryDataProvider();
    const cid = liveId(p);
    const before = buildDataFlow(p, cid)!;
    const subj = before.subjects[0]!;
    // A live sitter (present through every stage) excluded at Clean. A cohort
    // exclusion is INTENDED cleaning — it drops the cleaned cohort but is not an
    // unexpected loss, so the pipeline stays healthy and the drop is counted as
    // removedByCleaning (the same treatment as the staff/test exclusion).
    const victim = subj.people.find((pp) => pp.last === 3)!;

    p.excludeParticipantFromCohort(cid, victim.id, true, "data-flow test");

    const after = buildDataFlow(p, cid)!;
    expect(after.state).toBe("healthy"); // intended cleaning, not a collapse
    expect(after.removedByCleaning).toBeGreaterThanOrEqual(1);
    expect(after.lost).toBe(0); // no loss AFTER Clean

    const s = after.subjects.find((x) => x.key === subj.key)!;
    expect(s.counts[1]).toBe(subj.counts[1]! - 1); // dropped at Cleaned in this subject
    // The victim is still ingested (raw is untouched) but now dropped at Cleaned.
    const traced = s.people.find((pp) => pp.id === victim.id)!;
    expect(traced.last).toBe(0); // present only at Ingested now
  });

  it("reads Score-matrix membership from the real pivot (getNaiveScores), so a pivot drop stays visible", () => {
    // The matrix stage must reflect the pivot's OWN output, never a re-derivation
    // from the cleaned cohort — otherwise a participant who is cleaned but produces
    // no pivot row (e.g. all-dots) would be silently retained and the drop hidden.
    const p = new InMemoryDataProvider();
    const cid = liveId(p);
    const base = buildDataFlow(p, cid)!;
    const subj = base.subjects.find((s) => s.people.some((pp) => pp.last === 3))!;
    const victim = subj.people.find((pp) => pp.last === 3)!;

    // Simulate the pivot (and the engine) emitting no row for one cleaned sitter,
    // without touching the raw or cleaned artifacts: they remain fully ingested and
    // in the cleaned cohort, but vanish at the Score matrix.
    const origNaive = p.getNaiveScores.bind(p);
    const origComp = p.getComposition.bind(p);
    (p as unknown as { getNaiveScores: typeof p.getNaiveScores }).getNaiveScores = (c, aid) => {
      const m = origNaive(c, aid);
      return m ? { ...m, students: m.students.filter((s) => s.id !== victim.id) } : m;
    };
    (p as unknown as { getComposition: typeof p.getComposition }).getComposition = (c) => {
      const m = origComp(c);
      return m ? { ...m, students: m.students.filter((s) => s.participantId !== victim.id) } : m;
    };

    const after = buildDataFlow(p, cid)!;
    const s = after.subjects.find((x) => x.key === subj.key)!;
    // Ingested + Cleaned still hold; Score matrix + Computed both drop by one.
    expect(s.counts[0]).toBe(subj.counts[0]);
    expect(s.counts[1]).toBe(subj.counts[1]);
    expect(s.counts[2]).toBe(subj.counts[2]! - 1);
    expect(s.counts[3]).toBe(subj.counts[3]! - 1);
    // The victim is traced as present through Cleaned, then dropped entering the matrix.
    const traced = s.people.find((pp) => pp.id === victim.id)!;
    expect(traced.last).toBe(1);
    expect(after.state).toBe("collapse");
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
