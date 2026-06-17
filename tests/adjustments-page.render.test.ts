/**
 * Adjustments screen (step 6) — navigation regression.
 *
 * The pipeline order is Adjustments → Score (7) → Boundaries (8) → Grades, with
 * no step skippable via the continue buttons. This locks the Adjustments
 * "Continue to scoring" primary action to the Score screen (it previously jumped
 * straight to Boundaries, bypassing Score). Smoke-renders the real page with the
 * live provider via renderToStaticMarkup. Display/nav only — engine parity is
 * unaffected (covered by engine.parity.test.ts).
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
  usePathname: () => "/cycles/x/adjustments",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function renderAdjustments(cycleId: string): Promise<string> {
  const { default: AdjustmentsPage } = await import("@/app/cycles/[cycleId]/adjustments/page");
  return renderToStaticMarkup(e(AdjustmentsPage, { params: { cycleId } }));
}

describe("Adjustments page — continue navigates to Score (not Boundaries)", () => {
  it("the 'Continue to scoring' primary links to the Score screen", async () => {
    activeProvider = live;
    const html = await renderAdjustments(liveId);
    expect(html).toContain("Continue to scoring");
    // The "Continue to scoring" button must itself be wrapped in a link to Score
    // (step 7) — not Boundaries. (The pipeline stepper links to every stage, so a
    // bare href check isn't enough; assert the continue text sits inside the
    // Score anchor specifically.)
    const continueInScore = new RegExp(
      `<a href="/cycles/${liveId}/score"[^>]*>(?:(?!</a>).)*Continue to scoring`,
    );
    expect(html).toMatch(continueInScore);
  });
});
