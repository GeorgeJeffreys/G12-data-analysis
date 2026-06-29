/**
 * P4 — Generate-certificates screen render test. Smoke-renders the real Overall
 * documents page with the live provider to lock the issuance gate into the
 * design: the pre-issue sign-off banner referencing O1 and O2, the draft/official
 * mode toggle, and the default (server) state where official issue is blocked
 * pending sign-off while draft export stays available. Reads provider read-models
 * only — engine parity unaffected.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";

const live = new InMemoryDataProvider();
// Lock the May sitting so the Overall is signed off and the generator UI renders.
live.lockCycle("may-2026");

let activeProvider: DataProvider = live;
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

describe("Generate certificates — issuance gate", () => {
  it("shows a pre-issue sign-off banner referencing both O1 and O2", async () => {
    activeProvider = live;
    const html = await renderDocs("year-2026");
    expect(html).toContain("Pre-issue sign-off required");
    expect(html).toContain(">O1<");
    expect(html).toContain(">O2<");
    expect(html).toContain("D3 cap");
    expect(html).toContain("PLD");
    // The methodology is not signed off, so the banner shows 0/2 confirmed.
    expect(html).toContain("0/2 confirmed");
  });

  it("offers both export modes and defaults to draft", async () => {
    activeProvider = live;
    const html = await renderDocs("year-2026");
    expect(html).toContain("Issue mode");
    expect(html).toContain("Draft proof");
    expect(html).toContain("Official issue");
    // Default mode is draft, so the primary action exports draft proofs.
    expect(html).toContain("draft proof");
  });

  it("explains real issuance is locked until O1 and O2 are signed off", async () => {
    activeProvider = live;
    const html = await renderDocs("year-2026");
    expect(html).toContain("DRAFT — NOT FOR ISSUE");
  });
});
