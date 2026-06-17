/**
 * Boundaries screen (Screen 05) — layout + dual-mode placement.
 *
 * Smoke-renders the real page with the live provider via renderToStaticMarkup to
 * lock the restored two-panel design: the score distribution + draggable handles
 * on the LEFT, the cut-score table + comparison + warning strip on the RIGHT, and
 * the Wave 3b backsolve interaction living ENTIRELY inside "Set distribution" mode
 * — never as an always-on panel. Handles are draggable in BOTH modes. Also covers
 * the empty-cycle placeholder (no bare backsolve scaffolding). Consumes the model
 * only; engine parity is unaffected (covered by engine.parity.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { Seed } from "@/lib/data/seed-types";
import type { DataProvider } from "@/lib/data/provider";

// A live provider over the bundled seed, plus a brand-new empty cycle.
const live = new InMemoryDataProvider();
const liveId = live.listCycles()[0]!.id;

function emptySeed(): Seed {
  const validation = {
    passed: true,
    checks: [],
    stats: { rawRows: 0, mcqRows: 0, droppedSurveyRows: 0, droppedNonMcqRows: 0, assessments: 0, participants: 0, items: 0 },
  } as unknown as Seed["liveCycle"]["validation"];
  return {
    generatedAt: new Date().toISOString(),
    engineVersion: "test",
    liveCycle: {
      id: "new-cycle",
      name: "Fresh cycle",
      region: "eu-west",
      startedAt: "today",
      lastActivity: "today",
      stageIndex: 0,
      fileName: "",
      fileSizeMB: 0,
      uploadedAgo: "",
      validation,
      preview: { headers: [], rows: [] },
      duplicates: 0,
      participants: [],
      assessments: [
        { id: "a1", name: "Applicable Mathematics", shortName: "AM", rtl: false, stageIndex: 0, items: [], responses: [] },
        { id: "a2", name: "Scientific Thinking", shortName: "ST", rtl: false, stageIndex: 0, items: [], responses: [] },
      ],
      diagnostics: [],
    },
    priorCycles: [],
  } as unknown as Seed;
}
const empty: DataProvider = new InMemoryDataProvider(emptySeed());

// The page reads provider state through the context hooks and the shell uses
// next/navigation — point both at our providers / stubs so the genuine page
// renders. `activeProvider` lets each test swap which provider the page sees.
let activeProvider: DataProvider = live;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/cycles/x/boundaries",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function renderPage(cycleId: string): Promise<string> {
  const { default: BoundariesPage } = await import("@/app/cycles/[cycleId]/boundaries/page");
  return renderToStaticMarkup(e(BoundariesPage, { params: { cycleId } }));
}

describe("Boundaries page — two-panel dual-mode layout", () => {
  it("Set cut-points (manual) is the default: draggable handles + an output % column", async () => {
    activeProvider = live;
    live.setBoundary(liveId, "overall", { mode: "cuts" });
    const html = await renderPage(liveId);
    // Dual-mode toggle present, top-right of the working area.
    expect(html).toContain("Set cut-points");
    expect(html).toContain("Set distribution");
    // LEFT: the distribution is the hero, handles drag to set the raw cut score.
    expect(html).toContain("Score distribution");
    expect(html).toContain("Drag to set cut score");
    // RIGHT: the cut-score table columns.
    expect(html).toContain("Cut-point ≥");
    expect(html).toContain("% of cohort");
    // Manual mode: % of cohort is an OUTPUT (auto), not a target input — so the
    // target-vs-achievable working ("% actual") is absent.
    expect(html).not.toContain("% actual");
  });

  it("switching to Set distribution swaps the right-panel interaction to the backsolve — handles stay draggable", async () => {
    activeProvider = live;
    live.setBoundary(liveId, "overall", { mode: "pct" });
    const html = await renderPage(liveId);
    // Handles remain draggable — now they re-target the band's share.
    expect(html).toContain("Drag to set share");
    // The % column becomes an input showing target-vs-nearest-achievable, and the
    // backsolve control row appears — only in this mode.
    expect(html).toContain("% actual");
    expect(html).toContain("BACKSOLVED");
    // restore default for other tests
    live.setBoundary(liveId, "overall", { mode: "cuts" });
  });

  it("Set distribution backsolves and moves the handles to the solved cuts", async () => {
    activeProvider = live;
    live.setBoundary(liveId, "overall", { mode: "pct", targets: [12, 24, 40] });
    const m = live.getBoundaries(liveId, "overall")!;
    // The effective cuts ARE the backsolved suggestion in pct mode.
    expect(m.cuts).toEqual(m.suggestion.cuts);
    // Each solved cut is rendered as a draggable-handle label on the curve.
    const html = await renderPage(liveId);
    for (const cut of m.cuts) expect(html).toContain(`>${cut}<`);
    live.setBoundary(liveId, "overall", { mode: "cuts" });
  });

  it("uses the confirmed band vocabulary, never A–E grade letters", async () => {
    activeProvider = live;
    const html = await renderPage(liveId);
    // Confirmed award vocabulary reaches the markup.
    expect(html).toContain("Distinction");
    // The legacy A–E reference scheme must not appear.
    expect(html).not.toContain("below D");
  });

  it("no longer renders the mock award-mix comparison or its mock vs-previous-cycle warning", async () => {
    activeProvider = live;
    live.setBoundary(liveId, "overall", { mode: "cuts" });
    const html = await renderPage(liveId);
    // The mock "Award/Grade mix vs Jan 2026" block is gone.
    expect(html).not.toContain("mix vs");
    expect(html).not.toContain("MOCK");
    expect(html).not.toContain("Jan 2026");
    // Its mock-derived comparison warning is gone too.
    expect(html).not.toContain("vs Jan 2026 (mock)");
    expect(html).not.toContain("confirm intended");
  });

  it("keeps genuine guard-rail warnings — the remainder safeguard still renders", async () => {
    activeProvider = live;
    // Removing the mock comparison must not touch the real guard-rail strip: in
    // "Set distribution" the lowest-band remainder notice is a genuine guard-rail.
    live.setBoundary(liveId, "overall", { mode: "pct" });
    const html = await renderPage(liveId);
    expect(html).toContain("takes the remainder");
    live.setBoundary(liveId, "overall", { mode: "cuts" });
  });
});

describe("Boundaries page — empty cycle", () => {
  it("shows a clean placeholder, not bare backsolve scaffolding", async () => {
    activeProvider = empty;
    const html = await renderPage("new-cycle");
    // LEFT card: a single clean placeholder where the histogram would go.
    expect(html).toContain("No scored data yet");
    // No backsolve scaffolding as the main content.
    expect(html).not.toContain("BACKSOLVED");
    expect(html).not.toContain("Re-suggest");
    expect(html).not.toContain("Use as boundaries");
    expect(html).not.toContain("Reset to suggestion");
    expect(html).not.toContain("% actual");
    // The dual-mode toggle and draggable handles are not surfaced with no data.
    expect(html).not.toContain("Set distribution");
    expect(html).not.toContain("Drag to set cut score");
    expect(html).not.toContain("Drag to set share");
  });
});
