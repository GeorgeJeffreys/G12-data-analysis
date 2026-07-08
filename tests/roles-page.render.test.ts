/**
 * Settings › Roles & actions page — the editable role × action grid (migration 0040,
 * X2). Columns are roles (add / rename / delete), rows are the granular actions
 * grouped by pipeline step, cells are checkboxes. Admin sees the edit affordances; a
 * lower role sees the grid read-only. The Admin lockout note is always shown, and no
 * bundle-era ("permission" / capability catalogue) machinery remains.
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

describe("Roles & actions grid", () => {
  it("renders roles as columns and actions grouped by pipeline step, with edit affordances for an admin", async () => {
    activeProvider = new InMemoryDataProvider();
    const html = await render();
    // Columns = roles.
    expect(html).toContain("G12 team member");
    expect(html).toContain("Data analyst");
    expect(html).toContain("Admin");
    // Rows = granular action labels, grouped by pipeline-step headings.
    expect(html).toContain("Upload");
    expect(html).toContain("Grades");
    expect(html).toContain("Awards");
    expect(html).toContain("Adjust a student mark"); // grades.adjust label
    expect(html).toContain("Generate certificates / reports"); // awards.generate label
    // Edit affordances for the admin: add + rename controls, and the lockout note.
    expect(html).toContain("Add role");
    expect(html).toContain("Rename");
    expect(html).toContain("Admin keeps role &amp; user management");
    // No bundle-era machinery.
    expect(html).not.toContain("New permission");
    expect(html).not.toContain("Capability catalogue");
  });

  it("a non-admin sees the grid read-only (no add / rename controls)", async () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser(VIEWER);
    activeProvider = p;
    const html = await render();
    expect(html).toContain("read-only for your role");
    expect(html).not.toContain("Add role");
    expect(html).not.toContain("Rename");
  });
});
