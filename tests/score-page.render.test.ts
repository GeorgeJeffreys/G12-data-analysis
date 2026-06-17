/**
 * Score screen (Screen 07) — the dedicated post-adjustment computed-scores page.
 *
 * Smoke-renders the real page with the live provider via renderToStaticMarkup to
 * lock the design: a single all-subjects participant table (one row per student),
 * a column per subject + an Overall column, each showing the computed score as
 * raw/max · % with the MCQ + Essay + Alterations composition — the same
 * composition the Grades screen renders, reused. It reads already-computed
 * `participant_scores` (getComposition), so it is independent of boundaries and is
 * a DISTINCT page from Boundaries (no cut-point UI). Consumes provider read-models
 * only; engine parity is unaffected (covered by engine.parity.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";

const live = new InMemoryDataProvider();
const liveId = live.listCycles()[0]!.id;

let activeProvider: DataProvider = live;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/cycles/x/score",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function renderScore(cycleId: string): Promise<string> {
  const { default: ScorePage } = await import("@/app/cycles/[cycleId]/score/page");
  return renderToStaticMarkup(e(ScorePage, { params: { cycleId } }));
}

describe("Score page — per-student post-adjustment computed scores", () => {
  it("renders a per-student table with every subject + an Overall column", async () => {
    activeProvider = live;
    const comp = live.getComposition(liveId)!;
    const html = await renderScore(liveId);

    expect(html).toContain("Computed scores");
    // Every subject is a column, plus Overall.
    expect(html).toContain("Overall");
    // One row per participant — the student names reach the markup.
    expect(comp.students.length).toBeGreaterThan(0);
    for (const st of comp.students.slice(0, 5)) {
      expect(html).toContain(st.name);
    }
  });

  it("surfaces the score composition (MCQ + Essay + Alterations → total), reusing the Grades logic", async () => {
    activeProvider = live;
    const html = await renderScore(liveId);
    expect(html).toContain("MCQ");
    expect(html).toContain("Essay");
    expect(html).toContain("Alt");
  });

  it("is read-only: no cut-point / boundary controls (distinct from Boundaries)", async () => {
    activeProvider = live;
    const html = await renderScore(liveId);
    // None of the Boundaries cut-point UI appears on the Score screen.
    expect(html).not.toContain("Set cut-points");
    expect(html).not.toContain("Set distribution");
    expect(html).not.toContain("Cut-point ≥");
    expect(html).not.toContain("Score distribution");
  });
});
