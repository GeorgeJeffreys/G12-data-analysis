/**
 * Overall provider tests — getOverallGrades / getOverallDocuments on the
 * in-memory provider. Verifies the year-level best-of-two rollup is wired to the
 * sittings' signed-off grades, that provenance is present, that the demo February
 * baseline kicks in (fixtures-only build), and that certificates issue from the
 * Overall result (not a single sitting). Parity is unaffected — this is
 * aggregation over already-computed awards.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

const YEAR = "year-2026";
const MAY = "may-2026";

function fresh() {
  return new InMemoryDataProvider();
}

describe("getOverallGrades — year best-of-two", () => {
  it("rolls up the year's sittings into a per-student best-of-two table", () => {
    const p = fresh();
    const overall = p.getOverallGrades(YEAR)!;
    expect(overall).toBeTruthy();
    expect(overall.yearName).toBe("2026");
    expect(overall.rows.length).toBeGreaterThan(0);
    expect(overall.assessments.length).toBe(5);
    // award distribution sums to the cohort.
    const distTotal = overall.distribution.reduce((s, d) => s + d.count, 0);
    expect(distTotal).toBe(overall.rows.length);
  });

  it("flags the synthesized February baseline (live February unavailable in this build)", () => {
    expect(fresh().getOverallGrades(YEAR)!.demo).toBe(true);
  });

  it("every cell carries Feb/May provenance and is the higher of the two sittings' levels", () => {
    const p = fresh();
    const overall = p.getOverallGrades(YEAR)!;
    const levels = overall.performanceLevels; // best → lowest
    const rank = (l: string | null) => (l ? (levels.indexOf(l) < 0 ? Infinity : levels.indexOf(l)) : Infinity);
    let feb = 0;
    let may = 0;
    for (const r of overall.rows) {
      for (const cell of Object.values(r.grades)) {
        expect(["february", "may"]).toContain(cell.source);
        // chosen level is at least as good as each sitting's recorded level
        expect(rank(cell.level)).toBeLessThanOrEqual(rank(cell.februaryLevel));
        expect(rank(cell.level)).toBeLessThanOrEqual(rank(cell.mayLevel));
        // chosen level matches its claimed source
        const src = cell.source === "february" ? cell.februaryLevel : cell.mayLevel;
        expect(cell.level).toBe(src);
        if (cell.source === "february") feb++;
        else may++;
      }
    }
    // The demo baseline produces a genuine mix of both provenances.
    expect(feb).toBeGreaterThan(0);
    expect(may).toBeGreaterThan(0);
  });

  it("is provisional until both sittings are locked, then ready", () => {
    const p = fresh();
    expect(p.getOverallGrades(YEAR)!.ready).toBe(false); // May not locked yet
    p.lockCycle(MAY);
    expect(p.getOverallGrades(YEAR)!.ready).toBe(true); // February (mock) is locked; May now locked
  });

  it("returns null for an unknown year", () => {
    expect(fresh().getOverallGrades("year-1999")).toBeNull();
  });
});

describe("getOverallDocuments — certificates issue from Overall", () => {
  it("is gated until the Overall is signed off (both sittings locked)", () => {
    const p = fresh();
    const docs = p.getOverallDocuments(YEAR)!;
    expect(docs.locked).toBe(false);
    expect(docs.students).toHaveLength(0);
  });

  it("reads the Overall best-of-two awards once signed off — not a single sitting", () => {
    const p = fresh();
    p.lockCycle(MAY);
    const overall = p.getOverallGrades(YEAR)!;
    const docs = p.getOverallDocuments(YEAR)!;
    expect(docs.locked).toBe(true);
    expect(docs.students.length).toBe(overall.rows.length);
    // Every certificate's award equals the rolled-up overall award for that student.
    const awardByStudent = new Map(overall.rows.map((r) => [r.id, r.award]));
    for (const s of docs.students) {
      expect(s.award).toBe(awardByStudent.get(s.participantId));
    }
    // The Overall documents are labelled as the year's Overall, not a sitting.
    expect(docs.settings.cycleName).toContain("Overall");
  });
});
