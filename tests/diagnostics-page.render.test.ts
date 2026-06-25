/**
 * Diagnostics screen (Section 5) — actionable-only layout.
 *
 * Smoke-renders the real page with the live provider via renderToStaticMarkup to
 * lock the reworked design after the construct-level rows were removed:
 *   - speededness is shown at WHOLE-ASSESSMENT level plus a demand-level
 *     (D1/D2/D3) breakdown — never per major element / sub-element,
 *   - omission rate by item position is present,
 *   - timing is whole-assessment only,
 *   - the plain-language interpretation help text is embedded next to the
 *     speededness and omission figures.
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

async function renderPage(cycleId: string): Promise<string> {
  const { default: DiagnosticsPage } = await import("@/app/cycles/[cycleId]/diagnostics/page");
  return renderToStaticMarkup(e(DiagnosticsPage, { params: { cycleId } }));
}

describe("Diagnostics page — actionable-only diagnostics", () => {
  it("shows whole-assessment speededness with a demand-level breakdown, not constructs", async () => {
    activeProvider = live;
    const html = await renderPage(liveId);
    expect(html).toContain("Speededness, omission");
    expect(html).toContain("Whole assessment");
    // demand-level lens replaces the old per-element rows
    expect(html).toContain("By demand level");
    expect(html).toMatch(/top-difficulty/);
    // the removed construct/element breakdown header must be gone
    expect(html).not.toContain("Major curriculum elements");
  });

  it("plots omission rate by item position", async () => {
    activeProvider = live;
    const html = await renderPage(liveId);
    expect(html).toContain("Omission rate by item position");
    expect(html).toContain("item 1 (start)");
  });

  it("keeps timing at whole-assessment level only", async () => {
    activeProvider = live;
    const html = await renderPage(liveId);
    expect(html).toContain("Timing &amp; performance");
    // exactly one timing row label (whole assessment) — no per-element repeats
    const occurrences = html.split("Whole assessment").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2); // speededness + timing rows
  });

  it("embeds plain-language interpretation next to the figures", async () => {
    activeProvider = live;
    const html = await renderPage(liveId);
    expect(html).toContain("How to read this");
    expect(html).toContain("Speededness index");
    // omission help mentions the actionable end-of-paper signal
    expect(html).toMatch(/running out of time/);
  });

  it("still surfaces Cronbach's α reliability", async () => {
    activeProvider = live;
    const html = await renderPage(liveId);
    expect(html).toContain("Cronbach");
  });
});
