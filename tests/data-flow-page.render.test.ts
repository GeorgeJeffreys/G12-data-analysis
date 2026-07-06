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
  it("renders the healthy state for the fixed live cycle (flow strip + per-stage tables, no loss)", async () => {
    const p = new InMemoryDataProvider();
    activeProvider = p;
    const cid = liveId(p);
    const html = await render(cid);

    expect(html).toContain("Data flow");
    expect(html).toContain("Read-only");
    expect(html).toContain("No unexpected loss");
    // The four stage names appear in the hero strip.
    for (const s of ["Ingested", "Cleaned cohort", "Score matrix", "Computed scores"]) expect(html).toContain(s);
    // Every subject appears in the strip.
    for (const s of buildDataFlow(p, cid)!.subjects) expect(html).toContain(s.subj);
    // A healthy cycle is NOT flagged as a collapse.
    expect(html).not.toContain("Collapse detected");
    // The full per-stage data tables + participant drill are always shown, so a user
    // can inspect the real rows at each step even when nothing was lost. The default
    // stage is the source (Ingested), whose input is the raw response matrix.
    expect(html).toContain("Inside a stage");
    expect(html).toContain("Drill by participant");
    // The raw response matrix renders real per-question columns (Q1, Q2, …).
    expect(html).toContain(">Q1<");
    // Real participant identity (email / student id) appears in the table rows.
    const someSubject = buildDataFlow(p, cid)!.subjects.find((s) => s.people.length > 0)!;
    expect(html).toContain(someSubject.people[0]!.email);
  });

  it("renders the collapse layout (strip + stage detail + drill) when a real post-Clean drop exists", async () => {
    const p = new InMemoryDataProvider();
    const cid = liveId(p);
    // Force a REAL (unexpected) drop: a cleaned sitter that never reaches the score
    // matrix (pivot drop) — distinct from the expected staff/soft-delete removal at
    // Clean, which stays healthy. Mock the pivot + engine to omit one sitter.
    const subj = buildDataFlow(p, cid)!.subjects.find((s) => s.people.some((pp) => pp.last === 3))!;
    const victim = subj.people.find((pp) => pp.last === 3)!;
    const origNaive = p.getNaiveScores.bind(p);
    const origComp = p.getComposition.bind(p);
    (p as unknown as { getNaiveScores: typeof p.getNaiveScores }).getNaiveScores = (c, aid) => {
      const m = origNaive(c, aid);
      return m ? { ...m, students: m.students.filter((s) => s.id !== victim.id) } : m;
    };
    (p as unknown as { getComposition: typeof p.getComposition }).getComposition = (c) => {
      const m = origComp(c);
      return m ? { ...m, students: m.students.filter((s) => s.participantId !== victim.id) } : m;
    };
    activeProvider = p;

    const html = await render(cid);
    expect(html).toContain("Collapse detected");
    expect(html).toContain("Where did data go");
    expect(html).toContain("Inside a stage");
    expect(html).toContain("Drill by participant");
    expect(html).toContain("Lost after Clean");
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
