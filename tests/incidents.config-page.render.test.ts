/**
 * Incident Adjustments configuration page — admin gating render.
 * Admin sees the editor (Add code, editable caps); a lower role sees the same
 * config read-only (a "View only" banner, no Add control).
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
  usePathname: () => "/settings/incident-adjustments",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function render(): Promise<string> {
  const { default: Page } = await import("@/app/settings/incident-adjustments/page");
  return renderToStaticMarkup(e(Page, {}));
}

const VIEWER: CurrentUser = { id: "v", name: "Vic", initials: "V", role: "viewer" };

describe("Incident Adjustments config page", () => {
  it("admin sees the registry editor with an Add code control", async () => {
    activeProvider = new InMemoryDataProvider();
    const html = await render();
    expect(html).toContain("Incident adjustments");
    expect(html).toContain("Incident codes");
    expect(html).toContain("Per-student global cap");
    expect(html).toContain("Import column mapping");
    expect(html).toContain("Add code");
    expect(html).not.toContain("View only");
  });

  it("a lower role sees the config read-only (no Add control, view-only banner)", async () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser(VIEWER);
    activeProvider = p;
    const html = await render();
    expect(html).toContain("View only");
    expect(html).not.toContain("Add code");
  });
});
