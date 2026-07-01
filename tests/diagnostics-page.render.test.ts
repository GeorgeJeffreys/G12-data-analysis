/**
 * Assessment Health step + Analysis tab — the split diagnostics surfaces.
 *
 * Smoke-renders the real pages with the live provider via renderToStaticMarkup to
 * lock the structural split:
 *   - the critical-path "Assessment Health" step (/cycles/[id]/diagnostics) carries
 *     ONLY whole-assessment measures — speededness/omission/completion, timing, and
 *     Cronbach's α — and no longer the demand-level / item-set / position breakdowns,
 *   - the sitting-level "Analysis" reference tab (/cycles/[id]/diagnostics-hub) hosts
 *     the relocated demand-level (D1/D2/D3) + item-set breakdowns and omission-by-
 *     position chart.
 * Consumes the read-model only; engine parity is unaffected.
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
  usePathname: () => "/cycles/x/diagnostics",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function renderHealth(cycleId: string): Promise<string> {
  const { default: AssessmentHealthPage } = await import("@/app/cycles/[cycleId]/diagnostics/page");
  return renderToStaticMarkup(e(AssessmentHealthPage, { params: { cycleId } }));
}

async function renderAnalysis(cycleId: string): Promise<string> {
  const { default: AnalysisPage } = await import("@/app/cycles/[cycleId]/diagnostics-hub/page");
  return renderToStaticMarkup(e(AnalysisPage, { params: { cycleId } }));
}

describe("Assessment Health step — whole-assessment only", () => {
  it("shows whole-assessment speededness but NOT the demand-level / item breakdowns", async () => {
    activeProvider = live;
    const html = await renderHealth(liveId);
    expect(html).toContain("Assessment Health");
    expect(html).toContain("Speededness, omission");
    expect(html).toContain("Whole assessment");
    // the SPEEDEDNESS demand-level, item-set and item-position breakdowns moved to
    // the Analysis tab (their distinctive section headers must be gone here). NB the
    // Cronbach's-α reliability panel keeps its own "By demand level" α section — that
    // is the internal-consistency gate, not the relocated speededness breakdown.
    expect(html).not.toContain("By demand level (item difficulty)");
    expect(html).not.toContain("By item set (shared stimulus");
    expect(html).not.toContain("Omission rate by item position");
    // the old construct/element breakdown header must be gone too
    expect(html).not.toContain("Major curriculum elements");
  });

  it("keeps timing at whole-assessment level only", async () => {
    activeProvider = live;
    const html = await renderHealth(liveId);
    expect(html).toContain("Timing &amp; performance");
    // whole-assessment appears for the speededness + timing rows (no per-element repeats)
    const occurrences = html.split("Whole assessment").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("embeds plain-language interpretation and still surfaces Cronbach's α", async () => {
    activeProvider = live;
    const html = await renderHealth(liveId);
    expect(html).toContain("How to read this");
    expect(html).toContain("Speededness index");
    expect(html).toContain("Cronbach");
  });
});

describe("Analysis tab — relocated demand-level / item breakdowns", () => {
  it("hosts the demand-level (D1/D2/D3) and item-set breakdowns", async () => {
    activeProvider = live;
    const html = await renderAnalysis(liveId);
    expect(html).toContain("Analysis");
    expect(html).toContain("By demand level");
    expect(html).toMatch(/top-difficulty/);
    expect(html).toContain("By item set");
  });

  it("plots omission rate by item position", async () => {
    activeProvider = live;
    const html = await renderAnalysis(liveId);
    expect(html).toContain("Omission rate by item position");
    expect(html).toContain("item 1 (start)");
  });
});
