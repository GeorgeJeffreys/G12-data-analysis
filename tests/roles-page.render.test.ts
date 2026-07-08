/**
 * Settings › Roles & actions page — the READ surface for the dynamic role × action
 * grid (migration 0040, X1). Three sections: Roles (the role rows), Roles × actions
 * (a read-only grid of which role holds which action) and the Action catalogue
 * reference. The editable grid lands in X2; here we lock the read surface and that no
 * bundle-era ("permission" / capability) machinery remains.
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
  usePathname: () => "/settings/roles",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function render(): Promise<string> {
  const { default: Page } = await import("@/app/settings/roles/page");
  return renderToStaticMarkup(e(Page, {}));
}

const VIEWER: CurrentUser = { id: "v", name: "Vic", initials: "V", role: "viewer" };

describe("Roles & actions page", () => {
  it("renders roles, the grid and the action catalogue", async () => {
    activeProvider = new InMemoryDataProvider();
    const html = await render();
    // The three seeded roles, by name.
    expect(html).toContain("G12 team member");
    expect(html).toContain("Data analyst");
    expect(html).toContain("Admin");
    expect(html).toContain("System"); // the Admin system-role badge
    // Action catalogue — the explainer + granular keys grouped by pipeline step.
    expect(html).toContain("Action catalogue");
    expect(html).toContain("Actions are the fixed operations the app enforces");
    expect(html).toContain("general.manage_roles"); // a catalogue key
    expect(html).toContain("awards.generate"); // the new action
    expect(html).toContain("Upload"); // a pipeline-step group heading
    // No bundle-era machinery survives.
    expect(html).not.toContain("New permission");
    expect(html).not.toContain("Capability catalogue");
    expect(html).not.toContain("workspace_admin");
  });

  it("a non-admin sees the read-only note", async () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser(VIEWER);
    activeProvider = p;
    const html = await render();
    expect(html).toContain("read-only for your role");
  });
});
