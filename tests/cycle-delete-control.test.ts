/**
 * Delete-cycle control is present for an admin and hidden for everyone else.
 *
 * The card-level overflow menu (CycleCardMenu) is the reachable-from-Years home of
 * "Delete cycle" (its other home is the cycle Settings → Danger zone). It is
 * admin-only. These pin: an admin sees the ⋯ trigger; a non-admin sees nothing; and
 * a started sitting card on the Year screen carries the control.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";
import type { CurrentUser } from "@/lib/data/types";

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

/** A provider whose current user has the given role (everything else demo-default). */
function providerAs(role: CurrentUser["role"]): DataProvider {
  const p = new InMemoryDataProvider();
  const original = p.getCurrentUser.bind(p);
  p.getCurrentUser = () => ({ ...original(), role });
  return p;
}

async function renderMenu(): Promise<string> {
  const { CycleCardMenu } = await import("@/components/cycle/CycleCardMenu");
  return renderToStaticMarkup(e(CycleCardMenu, { cycleId: "cyc-1", cycleName: "May 2026" }));
}

describe("CycleCardMenu — admin-gated delete control", () => {
  it("an admin sees the overflow (Delete cycle) trigger", async () => {
    activeProvider = providerAs("lead_admin");
    const html = await renderMenu();
    expect(html).toContain("Actions for May 2026");
  });

  it("a viewer sees nothing (no delete control)", async () => {
    activeProvider = providerAs("viewer");
    const html = await renderMenu();
    expect(html).toBe("");
  });
});

describe("Year screen surfaces the delete control on a started sitting card", () => {
  it("renders the ⋯ actions trigger for the live sitting", async () => {
    activeProvider = new InMemoryDataProvider(); // demo default is lead_admin
    const { default: YearPage } = await import("@/app/years/[yearId]/page");
    const html = renderToStaticMarkup(e(YearPage, { params: { yearId: "year-2026" } }));
    expect(html).toContain("Actions for");
  });
});
