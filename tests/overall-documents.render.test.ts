/**
 * P5 — Generate certificates & reports screen render test. Smoke-renders the real
 * Overall documents page with the live provider to lock the issuance gate into the
 * design: the pre-issue checklist listing every hard gate (scores, sittings
 * locked, O1/O2, real data), the draft/official mode toggle, and the default
 * (server) state where official issue is blocked while draft/preview stays
 * available. Reads provider read-models only — engine parity unaffected.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";

const locked = new InMemoryDataProvider();
// Lock the May sitting so both contributing sittings are locked (Feb is the mock).
locked.lockCycle("may-2026");

const provisional = new InMemoryDataProvider(); // nothing locked yet

let activeProvider: DataProvider = locked;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/years/year-2026/overall/documents",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function renderDocs(yearId: string): Promise<string> {
  const { default: Page } = await import("@/app/years/[yearId]/overall/documents/page");
  return renderToStaticMarkup(e(Page, { params: { yearId } }));
}

describe("Generate certificates & reports — issuance gate", () => {
  it("lists every hard gate in the pre-issue checklist", async () => {
    activeProvider = locked;
    const html = await renderDocs("year-2026");
    expect(html).toContain("Pre-issue checklist");
    expect(html).toContain("Upstream scores verified");
    expect(html).toContain("All sittings locked");
    expect(html).toContain("O1 &amp; O2 signed off");
    expect(html).toContain("Real (non-synthetic) data");
    // O1/O2 still itemised under the sign-off gate.
    expect(html).toContain(">O1<");
    expect(html).toContain(">O2<");
    // Both sittings locked + scores reconcile, but O1/O2 unsigned & Feb synthetic → 2/4.
    expect(html).toContain("2/4 ready");
  });

  it("offers cert + report selection and both export modes, defaulting to draft", async () => {
    activeProvider = locked;
    const html = await renderDocs("year-2026");
    expect(html).toContain("Certificates");
    expect(html).toContain("Performance reports");
    expect(html).toContain("Issue mode");
    expect(html).toContain("Draft proof");
    expect(html).toContain("Official issue");
    expect(html).toContain("draft proof"); // primary action label
    // The header flags the gated state.
    expect(html).toContain("Draft / preview only");
  });

  it("blocks official issue with a clear reason but keeps draft watermarking", async () => {
    activeProvider = locked;
    const html = await renderDocs("year-2026");
    expect(html).toContain("Official issue is blocked");
    expect(html).toContain("DRAFT — NOT FOR ISSUE");
  });

  it("still renders draft/preview while provisional (sittings not locked)", async () => {
    activeProvider = provisional;
    const html = await renderDocs("year-2026");
    // No hard lock-out: the generator UI renders even before sittings are locked.
    expect(html).toContain("Issue mode");
    expect(html).toContain("draft proof");
    // The locked gate is unmet and surfaced.
    expect(html).toContain("All sittings locked");
  });
});
