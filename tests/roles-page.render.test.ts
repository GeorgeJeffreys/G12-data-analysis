/**
 * Settings › Roles page — the admin surface for configurable permissions (R2).
 * Three sections: A · Permissions (create/edit/delete), B · Roles × permissions
 * (grant grid), C · Capability catalogue (read-only reference). Admin sees the
 * editing controls; a lower role sees everything read-only. The Admin ×
 * Workspace-administration grant is always-on & locked.
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

describe("Roles & permissions admin page", () => {
  it("renders all three sections for an admin", async () => {
    activeProvider = new InMemoryDataProvider();
    const html = await render();
    // A · Permissions — the section, the create control, a permission summary.
    expect(html).toContain("Permissions");
    expect(html).toContain("New permission");
    expect(html).toContain("capabilities:"); // e.g. "1 capability: …" / "N capabilities: …"
    // B · Roles × permissions — the tier columns + the lockout note.
    expect(html).toContain("G12 team member");
    expect(html).toContain("Data analyst");
    expect(html).toContain("Admin");
    expect(html).toContain("must keep workspace administration");
    // C · Capability catalogue — the model explainer + a capability key.
    expect(html).toContain("Capability catalogue");
    expect(html).toContain("Capabilities are the fixed operations the app enforces");
    expect(html).toContain("override.marks_exclusions"); // a catalogue key
    // System permission is labelled; no custom-role machinery remains.
    expect(html).toContain("System");
    expect(html).not.toContain("Add role");
    expect(html).not.toContain("Data Scientist");
  });

  it("a non-admin sees everything read-only (no create/edit controls)", async () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser(VIEWER);
    activeProvider = p;
    const html = await render();
    expect(html).toContain("read-only for your role");
    expect(html).not.toContain("New permission");
    expect(html).not.toContain(">Edit<");
  });
});
