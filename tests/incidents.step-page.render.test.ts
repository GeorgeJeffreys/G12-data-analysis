/**
 * Critical-path Incident STEP page render — proves the step is now the
 * config-driven surface (not the old manual-triage form), with a real-file
 * importer and a retained manual-override path. Smoke-renders the real pages with
 * the live provider. Display/nav only — engine parity is unaffected.
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
  usePathname: () => "/cycles/x/adjustments",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function renderStep(cycleId: string): Promise<string> {
  const { default: Page } = await import("@/app/cycles/[cycleId]/adjustments/page");
  return renderToStaticMarkup(e(Page, { params: { cycleId } }));
}
async function renderManual(cycleId: string): Promise<string> {
  const { default: Page } = await import("@/app/cycles/[cycleId]/adjustments/manual/page");
  return renderToStaticMarkup(e(Page, { params: { cycleId } }));
}

const VIEWER: CurrentUser = { id: "v", name: "Vic", initials: "V", role: "viewer" };

describe("Incident step page — config-driven by default", () => {
  it("empty state offers the config-driven importer, not a blank manual form", async () => {
    const p = new InMemoryDataProvider();
    activeProvider = p;
    const html = await renderStep(p.listCycles()[0]!.id);
    expect(html).toContain("Incident adjustments");
    expect(html).toContain("No incidents imported");
    expect(html).toContain("Import incident log");
    // The old manual page's copy must be gone from the default step surface.
    expect(html).not.toContain("Nothing is applied automatically");
    // Retains an explicit manual-override path.
    expect(html).toContain("Manual override");
  });

  it("shows the per-student base + adjustment = adjusted decomposition once imported", async () => {
    const p = new InMemoryDataProvider();
    const id = p.listCycles()[0]!.id;
    seedIncidentRows(p, id);
    activeProvider = p;
    const html = await renderStep(id);
    expect(html).toContain("Base");
    expect(html).toContain("Adjustment");
    expect(html).toContain("Adjusted");
    expect(html).toContain("Apply adjustments"); // admin commit control
  });

  it("a team member sees the commit control under the default matrix (`adjust`)", async () => {
    const p = new InMemoryDataProvider();
    const id = p.listCycles()[0]!.id;
    seedIncidentRows(p, id);
    p.setCurrentUser(VIEWER); // team_member holds `adjust` by default
    activeProvider = p;
    const html = await renderStep(id);
    expect(html).toContain("Adjusted");
    expect(html).toContain("Apply adjustments");
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
    const html = await renderStep(id);
    expect(html).toContain("Adjusted");
    expect(html).toContain("Admin only");
    expect(html).not.toContain("Apply adjustments");
  });

  it("continue navigates to Score (not Boundaries)", async () => {
    const p = new InMemoryDataProvider();
    const id = p.listCycles()[0]!.id;
    activeProvider = p;
    const html = await renderStep(id);
    const continueInScore = new RegExp(`<a href="/cycles/${id}/score"[^>]*>(?:(?!</a>).)*Continue to scoring`);
    expect(html).toMatch(continueInScore);
  });
});

describe("Incident step — manual override retained", () => {
  it("the manual page keeps the This student / Whole subject / No action triage", async () => {
    const p = new InMemoryDataProvider();
    const id = p.listCycles()[0]!.id;
    // Populate the manual (old-world) incident log via the real upload path.
    const stu = p.getIncidentRoster(id)[0]!;
    p.uploadIncidentLog(id, "incident_log.xlsx", [
      { source: "incident_log", studentName: stu.name, exam: "AM", issueType: "Calculator tool froze", actionTaken: "Allowed 4 extra minutes", questionsAffected: "Q12", staff: "Invigilator A" },
    ]);
    activeProvider = p;
    const html = await renderManual(id);
    expect(html).toContain("Manual override");
    expect(html).toContain("This student");
    expect(html).toContain("Whole subject");
    expect(html).toContain("No action");
    const continueInScore = new RegExp(`<a href="/cycles/${id}/score"[^>]*>(?:(?!</a>).)*Continue to scoring`);
    expect(html).toMatch(continueInScore);
  });
});
