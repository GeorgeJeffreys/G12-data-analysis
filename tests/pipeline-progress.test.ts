/**
 * Pipeline progress tracker — completed-state + step-count must stay in sync
 * with the canonical step list.
 *
 * Two regressions are pinned here (both one root cause: the progress model
 * drifting from the step list as steps were added):
 *   1. For a sitting on the current step N, every step 1..N-1 must render as
 *      complete (a checkmark), N as current. A stale per-page `done` override
 *      used to leave the steps between Clean and the active step grey.
 *   2. The Years-card "k/N steps" label must read k/total with total = the real
 *      step count and k ≤ total — never the impossible "9/8".
 *
 * Presentation/state only — engine parity is covered by engine.parity.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Pipeline } from "@/components/shell/Pipeline";
import { PIPELINE } from "@/lib/data/types";
import { PIPELINE_STAGES } from "@/lib/ui/tokens";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { Seed } from "@/lib/data/seed-types";
import type { DataProvider } from "@/lib/data/provider";

const TOTAL = PIPELINE.length; // the real, single-sourced step count (10)

// The "done" circle renders this checkmark path; counting it counts completed steps.
const CHECK = "M2.5 6.2l2.2 2.2L9.5 3.5";
const countChecks = (html: string) => html.split(CHECK).length - 1;

let activeProvider: DataProvider = new InMemoryDataProvider();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

const EMPTY_VALIDATION = {
  passed: true,
  checks: [],
  stats: { rawRows: 0, mcqRows: 0, droppedSurveyRows: 0, droppedNonMcqRows: 0, assessments: 0, participants: 0, items: 0 },
} as unknown as Seed["liveCycle"]["validation"];

/** A seed with the live May-2026 sitting at `stageIndex`, plus optional priors. */
function seedAt(stageIndex: number, priors: Seed["priorCycles"] = []): Seed {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    engineVersion: "test",
    testCentres: [{ id: "tc-a", name: "Shatila 1", code: "SHA1", slug: "shatila-1", active: true }],
    liveCycle: {
      id: "may-2026", name: "May 2026", region: "eu-west", testCentreId: "tc-a",
      startedAt: "today", lastActivity: "today", stageIndex, fileName: "", fileSizeMB: 0, uploadedAgo: "",
      validation: EMPTY_VALIDATION, preview: { headers: [], rows: [] }, duplicates: 0,
      participants: [], assessments: [], diagnostics: [],
    },
    priorCycles: priors,
  };
}

async function renderYear(seed: Seed, yearId: string): Promise<string> {
  activeProvider = new InMemoryDataProvider(seed);
  const { default: YearPage } = await import("@/app/years/[yearId]/page");
  return renderToStaticMarkup(e(YearPage, { params: { yearId } }));
}

describe("step list is single-sourced", () => {
  it("the stepper's PIPELINE_STAGES is the same list as the provider's PIPELINE", () => {
    // Re-exported, not duplicated — so the tracker, the total and the completed
    // count can never drift apart.
    expect(PIPELINE_STAGES).toBe(PIPELINE);
    expect(TOTAL).toBe(10);
  });
});

describe("in-pipeline tracker: 1..N-1 complete, N current, rest pending", () => {
  for (let n = 0; n < TOTAL; n++) {
    it(`on step ${n + 1} (${PIPELINE[n]}), exactly ${n} prior steps render complete`, () => {
      const html = renderToStaticMarkup(e(Pipeline, { active: n }));
      // Every step before the active one is checkmarked; the active step and all
      // later steps are not (they render their number instead).
      expect(countChecks(html)).toBe(n);
      // The active step's number must still be visible (it is NOT a checkmark).
      expect(html).toContain(`>${n + 1}</span>`);
    });
  }

  it("the reported case — Technical adjustments (step 7) — shows steps 3–6 as complete, not grey", () => {
    // stageIndex 6 = Technical adjustments. Upload..Essay marks (6 steps) complete.
    const html = renderToStaticMarkup(e(Pipeline, { active: 6 }));
    expect(countChecks(html)).toBe(6);
  });
});

describe("Technical adjustments page renders all prior steps complete", () => {
  it("the live sitting's adjustments page shows 6 checkmarked steps (Upload..Essay marks)", async () => {
    activeProvider = new InMemoryDataProvider();
    const liveId = activeProvider.listCycles()[0]!.id;
    const { default: AdjustmentsPage } = await import("@/app/cycles/[cycleId]/adjustments/page");
    const html = renderToStaticMarkup(e(AdjustmentsPage, { params: { cycleId: liveId } }));
    // Regression: a stale `done: 2` override used to leave only 2 checkmarks here.
    expect(countChecks(html)).toBe(6);
  });
});

describe("Years card 'k/N steps' label", () => {
  it("an advanced sitting reads k/total with total = the real step count (no '9/8')", async () => {
    // stageIndex 9 = on Grades, 9 steps complete — the exact state that read "9/8".
    const html = await renderYear(seedAt(9), "year-2026");
    expect(html).toContain(`9/${TOTAL} steps`); // i.e. "9/10 steps"
    expect(html).not.toContain("/8 steps");
    expect(html).not.toContain("9/8");
  });

  it("the completed count can never exceed the total (clamped against stale sources)", async () => {
    // A stale prior carrying the old 11-step count must still render k ≤ total.
    const prior: Seed["priorCycles"] = [
      { id: "may-2025", name: "May 2025", testCentreId: "tc-a", stageIndex: 10, stepsDone: 11, participants: 0, assessments: 0, lastActivity: "2025", locked: true, mock: true },
    ];
    const html = await renderYear(seedAt(1, prior), "year-2025");
    expect(html).toContain(`${TOTAL}/${TOTAL} steps`); // clamped to "10/10"
    expect(html).not.toContain(`11/${TOTAL}`);
    expect(html).not.toContain("11/8");
  });

  it("k ≤ total for every reachable stageIndex", async () => {
    for (const idx of [0, 1, 3, 7, 9]) {
      const html = await renderYear(seedAt(idx), "year-2026");
      const m = html.match(/(\d+)\/(\d+) steps/);
      expect(m).not.toBeNull();
      const [k, total] = [Number(m![1]), Number(m![2])];
      expect(total).toBe(TOTAL);
      expect(k).toBeLessThanOrEqual(total);
    }
  });
});
