/**
 * Settings › Roles page — the editable permission matrix render.
 * Admin sees editable toggles across the three fixed tiers; a lower role sees the
 * same matrix read-only. The admin × workspace_admin cell is always-on & locked.
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

describe("Roles & permissions matrix page", () => {
  it("renders the three fixed tiers, permission groups, and the immediate-effect copy", async () => {
    activeProvider = new InMemoryDataProvider();
    const html = await render();
    // The three canonical tier labels are the columns.
    expect(html).toContain("G12 team member");
    expect(html).toContain("Data analyst");
    expect(html).toContain("Admin");
    // Rows are the admin-editable PERMISSIONS, with their capability labels.
    expect(html).toContain("Cut scores");
    expect(html).toContain("Overrides");
    expect(html).toContain("Audit access");
    expect(html).toContain("Workspace administration");
    expect(html).toContain("System"); // the system-permission badge
    expect(html).toContain("Set cut scores"); // a capability sub-label
    // The intro describes live editing.
    expect(html).toContain("Changes take effect immediately");
    // No custom-role machinery remains.
    expect(html).not.toContain("Add role");
    expect(html).not.toContain("Data Scientist");
  });

  it("shows the admin lockout note for the workspace_admin cell", async () => {
    activeProvider = new InMemoryDataProvider();
    const html = await render();
    expect(html).toContain("must retain workspace administration");
  });

  it("a non-admin sees the matrix read-only", async () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser(VIEWER);
    activeProvider = p;
    const html = await render();
    expect(html).toContain("read-only for your role");
  });
});
