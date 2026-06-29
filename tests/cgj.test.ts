/**
 * CGJ (Centre Grade Judgement) — the new pipeline step that lines a partner
 * centre's EXPECTED grades up against the actuals.
 *
 * Pinned here:
 *  - the pure mapping/comparison helpers (assumed PLD→award map; rank compare);
 *  - the provider round-trip (upload → compare → clear), reading actuals from the
 *    same grades the engine produces — never recomputing a grade;
 *  - the O2 assumption is surfaced (labelled, not baked in);
 *  - the page renders the comparison + the assumption banner.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { assumedPldAwardMap, compareLevels, normalizePerformanceLevel } from "@/lib/data/cgj";
import type { DataProvider } from "@/lib/data/provider";

const PERF = [
  "Outstanding performance",
  "Exceeds expectations",
  "Meets expectations",
  "Doesn't yet meet expectations",
];
const AWARD = ["Distinction award", "Advanced achievement award", "Secondary achievement award", "No Award"];

describe("assumed PLD→award mapping (O2)", () => {
  it("aligns the two vocabularies rank-for-rank (the assumed map)", () => {
    expect(assumedPldAwardMap(PERF, AWARD)).toEqual([
      { performanceLevel: "Outstanding performance", awardLevel: "Distinction award" },
      { performanceLevel: "Exceeds expectations", awardLevel: "Advanced achievement award" },
      { performanceLevel: "Meets expectations", awardLevel: "Secondary achievement award" },
      { performanceLevel: "Doesn't yet meet expectations", awardLevel: "No Award" },
    ]);
  });
});

describe("level comparison by rank", () => {
  it("classifies match / above / below / missing", () => {
    expect(compareLevels("Meets expectations", "Meets expectations", PERF)).toBe("match");
    // actual is a HIGHER level than expected → above
    expect(compareLevels("Meets expectations", "Exceeds expectations", PERF)).toBe("above");
    // actual is a LOWER level than expected → below
    expect(compareLevels("Exceeds expectations", "Meets expectations", PERF)).toBe("below");
    expect(compareLevels(null, "Meets expectations", PERF)).toBe("missing");
    expect(compareLevels("Meets expectations", null, PERF)).toBe("missing");
  });
});

describe("normalising messy centre cells", () => {
  it("accepts full labels, shorthand and stars", () => {
    expect(normalizePerformanceLevel("Outstanding performance", PERF)).toBe("Outstanding performance");
    expect(normalizePerformanceLevel("exceeds", PERF)).toBe("Exceeds expectations");
    expect(normalizePerformanceLevel("Meets", PERF)).toBe("Meets expectations");
    expect(normalizePerformanceLevel("doesn't meet", PERF)).toBe("Doesn't yet meet expectations");
    expect(normalizePerformanceLevel("***", PERF)).toBe("Outstanding performance");
    expect(normalizePerformanceLevel("", PERF)).toBeNull();
    expect(normalizePerformanceLevel("banana", PERF)).toBeNull();
  });
});

describe("provider: getCgj round-trip over the live sitting", () => {
  const provider = new InMemoryDataProvider();
  const cycleId = provider.listCycles()[0]!.id;

  it("is empty before any upload, with the assumed map already surfaced", () => {
    const m = provider.getCgj(cycleId)!;
    expect(m).not.toBeNull();
    expect(m.uploaded).toBe(false);
    expect(m.pldAwardMapAssumed).toBe(true);
    expect(m.pldAwardMap.length).toBe(m.performanceLevels.length);
    // every student row still carries the actual grades (nothing to compare yet)
    expect(m.rows.length).toBeGreaterThan(0);
    expect(m.counts.compared).toBe(0);
  });

  it("the sample upload produces real expected-vs-actual comparisons", () => {
    provider.loadSampleCgj(cycleId);
    const m = provider.getCgj(cycleId)!;
    expect(m.uploaded).toBe(true);
    expect(m.sample).toBe(true);
    expect(m.counts.studentsInFile).toBeGreaterThan(0);
    expect(m.counts.compared).toBeGreaterThan(0);
    // The deliberately-nudged sample yields at least one non-match somewhere.
    expect(m.counts.above + m.counts.below).toBeGreaterThan(0);
    // Every compared cell tallies into exactly one bucket.
    expect(m.counts.matched + m.counts.above + m.counts.below).toBe(m.counts.compared);
  });

  it("the actual levels equal the engine's grades (no recompute)", () => {
    const grades = provider.getGrades(cycleId)!;
    const cgj = provider.getCgj(cycleId)!;
    const gRow = grades.rows[0]!;
    const cRow = cgj.rows.find((r) => r.participantId === gRow.id)!;
    for (const a of cgj.assessments) {
      expect(cRow.subjects[a.id]!.actual).toBe(gRow.grades[a.id]!.level || null);
    }
  });

  it("clearing removes the file but keeps the comparison surface", () => {
    provider.clearCgj(cycleId);
    const m = provider.getCgj(cycleId)!;
    expect(m.uploaded).toBe(false);
    expect(m.counts.compared).toBe(0);
  });

  it("a non-live cycle has no CGJ", () => {
    expect(provider.getCgj("nope")).toBeNull();
  });
});

// ── page render ───────────────────────────────────────────────────────────────
let active: DataProvider = new InMemoryDataProvider();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => active,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(active),
}));

describe("CGJ page", () => {
  it("renders the empty state, the labelled O2 assumption, and continues to Grades", async () => {
    active = new InMemoryDataProvider();
    const cycleId = active.listCycles()[0]!.id;
    const { default: CgjPage } = await import("@/app/cycles/[cycleId]/cgj/page");
    const out = renderToStaticMarkup(e(CgjPage, { params: { cycleId } }));
    expect(out).toContain("Centre grade judgement");
    expect(out).toContain("No centre file added");
    // O2: the assumption is surfaced and clearly labelled as not signed off.
    expect(out).toContain("Assumed mapping");
    expect(out).toContain("OPEN FOR G12");
    // CGJ never gates Grades.
    expect(out).toContain(`/cycles/${cycleId}/grades`);
  });

  it("renders the comparison table once a centre file is present", async () => {
    const provider = new InMemoryDataProvider();
    const cycleId = provider.listCycles()[0]!.id;
    provider.loadSampleCgj(cycleId);
    active = provider;
    const { default: CgjPage } = await import("@/app/cycles/[cycleId]/cgj/page");
    const out = renderToStaticMarkup(e(CgjPage, { params: { cycleId } }));
    expect(out).toContain("sample_centre_expectations.xlsx");
    expect(out).toContain("Matches expectation");
    expect(out).toContain("Below expectation");
    // the comparison header row names the student column
    expect(out).toContain("Student");
  });
});
