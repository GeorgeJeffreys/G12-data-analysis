/**
 * Developer data-flow view (task 15) — smoke-renders the real admin page with the
 * live provider via renderToStaticMarkup to lock the design: the always-visible
 * stage strip (Ingested → Cleaned cohort → Score matrix → Computed scores), the
 * per-subject rows, the read-only + admin status, and that it consumes provider
 * read-models only (never bumps the provider version — strictly read-only).
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";

const live = new InMemoryDataProvider();

let activeProvider: DataProvider = live;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/developer",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function renderDeveloper(): Promise<string> {
  const { default: DeveloperPage } = await import("@/app/developer/page");
  return renderToStaticMarkup(e(DeveloperPage, {}));
}

describe("Developer data-flow view", () => {
  it("renders the stage strip with all four stages and every subject", async () => {
    activeProvider = live;
    const html = await renderDeveloper();

    expect(html).toContain("Developer · data flow");
    expect(html).toContain("Read-only");
    for (const label of ["Ingested", "Cleaned cohort", "Score matrix", "Computed scores"]) {
      expect(html).toContain(label);
    }
    // Every subject on the live cycle appears in the strip.
    const cid = live.listCycles().find((c) => c.live)!.id;
    const cycle = live.getCycle(cid)!;
    for (const a of cycle.assessments) expect(html).toContain(a.shortName);
  });

  it("surfaces the transformation description (the real key each stage operates on)", async () => {
    activeProvider = live;
    const html = await renderDeveloper();
    expect(html).toContain("Transformation");
    // The first stage (Ingested) is expanded by default; its identity transform
    // names the collision-free email key it mints the stable internal id from.
    expect(html).toContain("ResultParticipantName");
    expect(html).toContain("internalParticipantId");
  });

  it("is strictly read-only — rendering never bumps the provider version", async () => {
    activeProvider = live;
    const v0 = live.getVersion();
    await renderDeveloper();
    expect(live.getVersion()).toBe(v0);
  });
});
