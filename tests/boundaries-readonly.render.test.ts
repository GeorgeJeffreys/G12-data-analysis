/**
 * P3 — Cut Scores page renders a clean READ-ONLY view for a regular (non-admin)
 * user, and the full editor for an admin.
 *
 * The client guard is UX only (the real lock is server-side — see
 * cut-scores-admin-lock.test.ts). This proves the admin's perspective: a regular
 * user sees the recommended cut scores with NO editing affordances and a clear
 * "view only" state (not a dead page); an admin keeps the interactive editor.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";

// Admin = the default demo user (isAdmin true). Regular user = a viewer with the
// global admin flag off. Both run over the same bundled (scored) seed/cycle.
const admin = new InMemoryDataProvider();
const cycleId = admin.listCycles()[0]!.id;
const viewer: DataProvider = new InMemoryDataProvider(undefined, {
  id: "u-view",
  name: "Viewer",
  initials: "V",
  role: "viewer",
  isAdmin: false,
});

let activeProvider: DataProvider = admin;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/cycles/x/boundaries",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function renderPage(): Promise<string> {
  const { default: BoundariesPage } = await import("@/app/cycles/[cycleId]/boundaries/page");
  return renderToStaticMarkup(e(BoundariesPage, { params: { cycleId } }));
}

describe("Cut Scores — regular user gets a read-only view", () => {
  it("shows the recommended cut scores with no editing affordances", async () => {
    activeProvider = viewer;
    const html = await renderPage();

    // Explicit, non-confusing view-only state — not a dead page.
    expect(html).toContain("View only");
    expect(html).toContain("view-only access");

    // Still shows the recommended cut scores read-only: the band vocabulary and
    // the distribution render.
    expect(html).toContain("Distinction");
    expect(html).toContain("Score distribution");

    // No editing affordances: no numeric cut/target inputs, no mode toggle, no
    // backsolve controls, no drag hints.
    expect(html).not.toContain("hf-input"); // CutInput (the only editable input) is gone
    expect(html).not.toContain("Set cut-points");
    expect(html).not.toContain("Set distribution");
    expect(html).not.toContain("BACKSOLVED");
    expect(html).not.toContain("Drag to set cut score");
    expect(html).not.toContain("Drag to set share");
  });
});

describe("Cut Scores — admin keeps the editor", () => {
  it("renders the interactive editor (inputs + mode toggle) and no view-only badge", async () => {
    activeProvider = admin;
    admin.setBoundary(cycleId, "overall", { mode: "cuts" });
    const html = await renderPage();

    // Editable: the cut-score number inputs and the dual-mode toggle are present.
    expect(html).toContain("hf-input");
    expect(html).toContain("Set cut-points");
    expect(html).toContain("Set distribution");

    // No read-only badge for an admin.
    expect(html).not.toContain("View only");
    expect(html).not.toContain("view-only access");
  });
});
