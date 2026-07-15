/**
 * computeOverallAnalytics — unit tests over a hand-built multi-cell fixture.
 *
 * Verifies the locked methodology: participation counts (satFeb / satMay / both),
 * pass = award ABOVE the lowest band, best-of-two level distribution, the
 * February→May level movement (`change`), the overall award distribution, and the
 * per-centre spread. Pure aggregation — no provider, no engine re-run.
 */
import { describe, it, expect } from "vitest";
import {
  computeOverallAnalytics,
  overallAwardBands,
  overallPLevels,
  type OACell,
  type OASittingStudent,
} from "@/lib/data/overall-analytics";

const PERF = ["Out", "Exc", "Meet", "Not"]; // best → lowest
const AWARD = ["Dist", "Adv", "Sec", "RoL"]; // best → lowest
const SUBJ = ["am", "st", "esl", "afl", "ls"];

const AWARDS = overallAwardBands(AWARD);
const PLEVELS = overallPLevels(PERF);

/** A student whose five subjects all sit at one level (so the derived award is
 *  obvious), with an explicit per-sitting award. */
function stu(id: string, level: string, award: string): OASittingStudent {
  return { studentId: id, award, levels: Object.fromEntries(SUBJ.map((k) => [k, level])) };
}
function scoresUniform(list: number[]): Record<string, number[]> {
  return Object.fromEntries(SUBJ.map((k) => [k, list]));
}

function base(cells: OACell[], realYears: number[]) {
  return {
    cells,
    subjects: SUBJ.map((k) => ({ key: k, name: k, short: k })),
    awards: AWARDS,
    plevels: PLEVELS,
    performanceLevels: PERF,
    awardLevels: AWARD,
    starMap: {},
    realYears,
  };
}

const CELL_A_2026: OACell = {
  centre: "A",
  year: 2026,
  february: {
    students: [stu("p1", "Meet", "Sec"), stu("p2", "Not", "RoL"), stu("p3", "Out", "Dist")],
    scores: scoresUniform([50, 30, 90]),
  },
  may: {
    students: [stu("p1", "Out", "Dist"), stu("p2", "Meet", "Sec"), stu("p4", "Exc", "Adv")],
    scores: scoresUniform([92, 48, 70]),
  },
};

describe("computeOverallAnalytics — single cell (A, 2026)", () => {
  const out = computeOverallAnalytics(base([CELL_A_2026], [2026]));

  it("participation: satFeb / satMay / both and pass = award above lowest", () => {
    expect(out.participation[2026]).toEqual({
      centres: 1,
      satFeb: 3,
      satMay: 3,
      both: 2, // p1, p2 sat both sittings
      passFeb: 66.7, // Sec + Dist pass; RoL does not (2/3)
      passMay: 100, // Dist + Sec + Adv
      passComb: 100, // every best-of-two student clears the lowest band
    });
  });

  it("award distribution is the overall best-of-two award, as %", () => {
    // best-of-two: p1 Dist, p2 Sec, p3 Dist, p4 Adv
    expect(out.awardDist[2026]).toEqual({ dist: 50, adv: 25, sec: 25, rol: 0 });
  });

  it("per-subject single-sitting score stats + per-subject pass (≥ Meets)", () => {
    const feb = out.perf.am![2026]!.feb!;
    expect(feb.mean).toBe(56.7);
    expect(feb.median).toBe(50);
    expect(feb.high).toBe(90);
    expect(feb.low).toBe(30);
    expect(feb.sd).toBe(30.6);
    expect(feb.pass).toBe(66.7); // Meet + Out pass; Not does not (2/3)

    const may = out.perf.am![2026]!.may!;
    expect(may.mean).toBe(70);
    expect(may.median).toBe(70);
    expect(may.sd).toBe(22);
    expect(may.pass).toBe(100);
  });

  it("best-of-two level distribution per subject, as %", () => {
    // am best-of-two: p1 Out, p2 Meet, p3 Out, p4 Exc
    expect(out.perf.am![2026]!.levels).toEqual({ out: 50, exc: 25, meet: 25, not: 0 });
  });

  it("change = February→May level movement for students in both sittings", () => {
    // am, both = {p1: Meet→Out (+2), p2: Not→Meet (+1)}
    expect(out.perf.am![2026]!.change).toEqual({ gain: 1.5, up: 100 });
  });

  it("single real year → no comparison", () => {
    expect(out.hasComparison).toBe(false);
    expect(out.years).toEqual([2026]);
    expect(out.centres).toEqual(["A"]);
  });
});

describe("computeOverallAnalytics — centre spread", () => {
  const cellB2026: OACell = {
    centre: "B",
    year: 2026,
    february: { students: [stu("b1", "Not", "RoL"), stu("b2", "Not", "RoL")], scores: scoresUniform([20, 25]) },
    may: { students: [stu("b1", "Not", "RoL"), stu("b2", "Not", "RoL")], scores: scoresUniform([22, 28]) },
  };
  const out = computeOverallAnalytics(base([CELL_A_2026, cellB2026], [2026]));

  it("best/worst/mean combined pass rate across centres", () => {
    // A combined pass 100%, B combined pass 0%.
    expect(out.centreAwardSpread[2026]).toEqual({ best: 100, worst: 0, mean: 50 });
  });

  it("award distribution per centre, keyed by year", () => {
    expect(out.awardByCentre[2026]!["A"]).toEqual({ dist: 50, adv: 25, sec: 25, rol: 0 });
    expect(out.awardByCentre[2026]!["B"]).toEqual({ dist: 0, adv: 0, sec: 0, rol: 100 });
  });

  it("per-subject spread across centres carries an SD", () => {
    const spread = out.centreSubjectSpread.am![2026]!;
    expect(spread.best).toBe(100); // centre A subject pass
    expect(spread.worst).toBe(0); // centre B subject pass
    expect(spread.mean).toBe(50);
    expect(spread.sd).toBeGreaterThan(0);
  });
});

describe("computeOverallAnalytics — awardByCentre respects the selected year", () => {
  // Centre A is all Record-of-Learning in 2025 but top-heavy in 2026; the
  // per-centre distribution must differ by year (not always show the latest).
  const cellA2025: OACell = {
    centre: "A",
    year: 2025,
    february: { students: [stu("a1", "Not", "RoL"), stu("a2", "Not", "RoL")], scores: scoresUniform([20, 25]) },
    may: { students: [stu("a1", "Not", "RoL"), stu("a2", "Not", "RoL")], scores: scoresUniform([22, 28]) },
  };
  const out = computeOverallAnalytics(base([cellA2025, CELL_A_2026], [2025, 2026]));

  it("keys the per-centre award distribution by year", () => {
    expect(out.awardByCentre[2025]!["A"]).toEqual({ dist: 0, adv: 0, sec: 0, rol: 100 });
    expect(out.awardByCentre[2026]!["A"]).toEqual({ dist: 50, adv: 25, sec: 25, rol: 0 });
  });
});

describe("computeOverallAnalytics — comparison across years", () => {
  it("≥ 2 real years → hasComparison true, years ascending", () => {
    const cell2025: OACell = {
      centre: "A",
      year: 2025,
      february: { students: [stu("q1", "Meet", "Sec")], scores: scoresUniform([50]) },
      may: { students: [stu("q1", "Exc", "Adv")], scores: scoresUniform([65]) },
    };
    const out = computeOverallAnalytics(base([cell2025, CELL_A_2026], [2025, 2026]));
    expect(out.hasComparison).toBe(true);
    expect(out.years).toEqual([2025, 2026]);
  });

  it("a year with only one sitting has null change and a null missing-sitting stat", () => {
    const febOnly: OACell = {
      centre: "A",
      year: 2026,
      february: { students: [stu("p1", "Meet", "Sec")], scores: scoresUniform([50]) },
      may: null,
    };
    const out = computeOverallAnalytics(base([febOnly], [2026]));
    expect(out.perf.am![2026]!.may).toBeNull();
    expect(out.perf.am![2026]!.change).toBeNull();
    expect(out.perf.am![2026]!.feb).not.toBeNull();
  });
});
