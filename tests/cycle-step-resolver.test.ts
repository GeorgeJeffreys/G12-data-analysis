/**
 * Current-step resolver: a cycle's `doNext` must land the user on the FIRST
 * INCOMPLETE pipeline step, based on what data actually exists — never skip
 * ahead to a late screen (Review/Boundaries/…) whose prerequisites are absent.
 *
 * Regression for the live bug where a brand-new (empty) cycle clicked straight
 * through to the Cronbach/Review screen instead of starting at Upload, because
 * `doNext` was hard-coded to "Review item quality" regardless of progress.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { stageRoute, doNextForStage } from "@/lib/data/pipeline-route";
import type { Seed } from "@/lib/data/seed-types";

const EMPTY_VALIDATION = {
  passed: true,
  checks: [],
  stats: { rawRows: 0, mcqRows: 0, droppedSurveyRows: 0, droppedNonMcqRows: 0, assessments: 0, participants: 0, items: 0 },
} as unknown as Seed["liveCycle"]["validation"];

/** A brand-new cycle: assessments created (named) but no items/responses yet. */
function seedAtStage(stageIndex: number): Seed {
  return {
    generatedAt: new Date().toISOString(),
    engineVersion: "test",
    liveCycle: {
      id: "c", name: "Fresh cycle", region: "eu-west", startedAt: "today", lastActivity: "today",
      stageIndex, fileName: "", fileSizeMB: 0, uploadedAgo: "",
      validation: EMPTY_VALIDATION, preview: { headers: [], rows: [] }, duplicates: 0,
      participants: [],
      assessments: [
        { id: "a1", name: "Applicable Mathematics", shortName: "AM", rtl: false, stageIndex: 0, items: [], responses: [] },
        { id: "a2", name: "Scientific Thinking", shortName: "ST", rtl: false, stageIndex: 0, items: [], responses: [] },
      ],
      diagnostics: [],
    },
    priorCycles: [],
  };
}

describe("stageRoute / doNextForStage", () => {
  it("routes each stage index to its screen (10-stage pipeline)", () => {
    expect(stageRoute("c", 0)).toBe("/cycles/c/import"); // Upload
    expect(stageRoute("c", 1)).toBe("/cycles/c/raw-data");
    expect(stageRoute("c", 4)).toBe("/cycles/c/review");
    expect(stageRoute("c", 6)).toBe("/cycles/c/boundaries"); // Score
    expect(stageRoute("c", 7)).toBe("/cycles/c/boundaries"); // Boundaries
    expect(stageRoute("c", 9)).toBe("/cycles/c/documents"); // Export
  });

  it("doNext for an empty cycle lands on Upload, not a late screen", () => {
    expect(doNextForStage("c", 0).href).toBe("/cycles/c/import");
  });
});

describe("getCycle current-step resolution", () => {
  it("a new/empty cycle lands on Upload (step 1), never Review", () => {
    const cycle = new InMemoryDataProvider(seedAtStage(0)).getCycle("c")!;
    expect(cycle.stageIndex).toBe(0);
    expect(cycle.doNext.href).toBe("/cycles/c/import");
    expect(cycle.doNext.href).not.toContain("review");
  });

  it("a partially-progressed cycle lands on its genuine next step", () => {
    // stageIndex 1 = raw data already in, next incomplete is Raw data.
    expect(new InMemoryDataProvider(seedAtStage(1)).getCycle("c")!.doNext.href).toBe("/cycles/c/raw-data");
    // stageIndex 4 = Review.
    expect(new InMemoryDataProvider(seedAtStage(4)).getCycle("c")!.doNext.href).toBe("/cycles/c/review");
  });

  it("the seeded demo cycle still resolves to a valid pipeline screen", () => {
    const cycle = new InMemoryDataProvider().getCycle("may-2026")!;
    expect(cycle.doNext.href).toBe(stageRoute("may-2026", cycle.stageIndex));
  });
});

describe("empty-cycle provider getters never crash", () => {
  const provider = new InMemoryDataProvider(seedAtStage(0));
  it("import + late-pipeline getters tolerate a data-less cycle", () => {
    for (const get of [
      () => provider.getIngest("c"),
      () => provider.getCombinedSplit("c"),
      () => provider.getEssayMarks("c"),
      () => provider.getAdjustments("c"),
      () => provider.getReliability("c"),
      () => provider.getDiagnostics("c"),
      () => provider.getGrades("c"),
    ]) {
      expect(get).not.toThrow();
    }
  });

  it("getIngest reports not-uploaded and getCombinedSplit is null before any upload", () => {
    expect(provider.getIngest("c")!.uploaded).toBe(false);
    expect(provider.getIngest("c")!.canContinue).toBe(false);
    expect(provider.getCombinedSplit("c")).toBeNull();
  });
});
