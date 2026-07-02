/**
 * Data flow — the within-cycle pipeline inspector (task 15). Smoke-renders the real
 * admin page with the live provider via renderToStaticMarkup to lock the ported
 * design (hfDataFlow.jsx): the hero flow strip, the read-only + state badges, the
 * per-stage detail and participant drill, driven entirely by the cycle's REAL data.
 * Confirms the three data-driven states (healthy vs collapse) and that the view is
 * strictly read-only (never bumps the provider version).
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";
import { buildDataFlow } from "@/lib/data/data-flow";

let activeProvider: DataProvider = new InMemoryDataProvider();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/cycles/x/data-flow",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function render(cycleId: string): Promise<string> {
  const { default: Page } = await import("@/app/cycles/[cycleId]/data-flow/page");
  return renderToStaticMarkup(e(Page, { params: { cycleId } }));
}

const liveId = (p: DataProvider) => p.listCycles().find((c) => c.live)!.id;

describe("Data flow — within-cycle pipeline inspector", () => {
  it("renders the healthy state for the fixed live cycle (flow strip, no loss)", async () => {
    const p = new InMemoryDataProvider();
    activeProvider = p;
    const cid = liveId(p);
    const html = await render(cid);

    expect(html).toContain("Data flow");
    expect(html).toContain("Read-only");
    expect(html).toContain("No loss detected");
    // The four stage names appear in the hero strip.
    for (const s of ["Ingested", "Cleaned cohort", "Score matrix", "Computed scores"]) expect(html).toContain(s);
    // Every subject appears in the strip.
    for (const s of buildDataFlow(p, cid)!.subjects) expect(html).toContain(s.subj);
    // Healthy layout omits the collapse-only sections.
    expect(html).not.toContain("Collapse detected");
    expect(html).not.toContain("Drill by participant");
  });

  it("renders the collapse layout (strip + stage detail + drill) when a real drop exists", async () => {
    const p = new InMemoryDataProvider();
    const cid = liveId(p);
    // Force a real drop: exclude one live sitter from the cohort.
    const victim = buildDataFlow(p, cid)!.subjects[0]!.people.find((pp) => pp.last === 3)!;
    p.excludeParticipantFromCohort(cid, victim.id, true, "render test");
    activeProvider = p;

    const html = await render(cid);
    expect(html).toContain("Collapse detected");
    expect(html).toContain("Where did data go");
    expect(html).toContain("Inside a stage");
    expect(html).toContain("Drill by participant");
    expect(html).toContain("Participants lost");
    // The default-selected Score-matrix stage names the real pivot key.
    expect(html).toContain("(student, QuestionId)");
    // The dropped participant is traceable by their real email/student id.
    expect(html).toContain(victim.email);
  });

  it("is strictly read-only — rendering never bumps the provider version", async () => {
    const p = new InMemoryDataProvider();
    activeProvider = p;
    const v0 = p.getVersion();
    await render(liveId(p));
    expect(p.getVersion()).toBe(v0);
  });
});
