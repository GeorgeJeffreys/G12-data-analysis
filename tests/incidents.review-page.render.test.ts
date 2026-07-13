/**
 * Incident Adjustments review page — render + admin gating.
 * All roles VIEW the per-student surface (base / adjustment / adjusted). Only an
 * admin sees the "Apply adjustments" commit control; a lower role sees "Admin only".
 */
import { describe, it, expect, vi } from "vitest";
import { seedIncidentRows } from "./helpers/incident-fixtures";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";
import type { CurrentUser } from "@/lib/data/types";

let activeProvider: DataProvider = new InMemoryDataProvider();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/cycles/live/adjustments/review",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function render(cycleId: string): Promise<string> {
  const { default: Page } = await import("@/app/cycles/[cycleId]/adjustments/review/page");
  return renderToStaticMarkup(e(Page, { params: { cycleId } }));
}

const VIEWER: CurrentUser = { id: "v", name: "Vic", initials: "V", role: "viewer" };

describe("Incident Adjustments review page", () => {
  it("empty state shows the import guidance and no synthetic sample affordance", async () => {
    const p = new InMemoryDataProvider();
    activeProvider = p;
    const html = await render(p.listCycles()[0]!.id);
    expect(html).toContain("Incident adjustments");
    expect(html).toContain("No incidents imported");
    expect(html).not.toContain("Load sample");
  });

  it("admin sees the per-student surface with the Apply control", async () => {
    const p = new InMemoryDataProvider();
    const id = p.listCycles()[0]!.id;
    seedIncidentRows(p, id);
    activeProvider = p;
    const html = await render(id);
    expect(html).toContain("Base");
    expect(html).toContain("Adjustment");
    expect(html).toContain("Adjusted");
    expect(html).toContain("Apply adjustments");
    expect(html).not.toContain("Admin only");
  });

  it("without the `adjust` permission the surface is read-only (Admin only)", async () => {
    const p = new InMemoryDataProvider();
    const id = p.listCycles()[0]!.id;
    seedIncidentRows(p, id); // seeded as the default admin
    // Revoke the Adjustments permission from team_member (grant-driven denial),
    // then view as one.
    p.setRoleAction("team_member", "incidents.apply", false);
    p.setCurrentUser(VIEWER);
    activeProvider = p;
    const html = await render(id);
    expect(html).toContain("Adjusted");
    expect(html).toContain("Admin only");
    expect(html).not.toContain("Apply adjustments");
  });
});
