/**
 * Score screen (Screen 07) — the dedicated post-adjustment computed-scores page.
 *
 * Smoke-renders the real page with the live provider via renderToStaticMarkup to
 * lock the design: a single all-subjects participant table (one row per student),
 * a column per subject, each showing the computed score as raw/max · % with the
 * MCQ + Essay + Alterations composition — the same composition the Grades screen
 * renders, reused. There is deliberately NO per-sitting "Overall" column here (the
 * meaningful Overall is the best-of-two at the year level); instead the table ends
 * with two display-only signal columns: D3 questions attempted and technical
 * incidents. It reads already-computed
 * `participant_scores` (getComposition), so it is independent of boundaries and is
 * a DISTINCT page from Boundaries (no cut-point UI). Consumes provider read-models
 * only; engine parity is unaffected (covered by engine.parity.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";

const live = new InMemoryDataProvider();
const liveId = live.listCycles()[0]!.id;

let activeProvider: DataProvider = live;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/cycles/x/score",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => activeProvider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(activeProvider),
}));

async function renderScore(cycleId: string): Promise<string> {
  const { default: ScorePage } = await import("@/app/cycles/[cycleId]/score/page");
  return renderToStaticMarkup(e(ScorePage, { params: { cycleId } }));
}

describe("Score page — per-student post-adjustment computed scores", () => {
  it("renders a per-student table with every subject + the two signal columns, and no per-sitting Overall", async () => {
    activeProvider = live;
    const comp = live.getComposition(liveId)!;
    const html = await renderScore(liveId);

    expect(html).toContain("Computed scores");
    // The display-only per-student signal columns are present…
    expect(html).toContain("D3 answered");
    expect(html).toContain("Incidents");
    // …and there is no per-sitting "Overall" column masquerading as the final result.
    expect(html).not.toMatch(/<th[^>]*>[^<]*Overall/);
    // One row per participant — the student names reach the markup.
    expect(comp.students.length).toBeGreaterThan(0);
    for (const st of comp.students.slice(0, 5)) {
      expect(html).toContain(st.name);
    }
  });

  it("surfaces the score composition (MCQ + Essay + Alterations → total) on demand, reusing the Grades logic", async () => {
    activeProvider = live;
    const html = await renderScore(liveId);
    // The composition is no longer printed inline in every cell — it's revealed on
    // hover, so it lives in a title tooltip (title="MCQ … + Essay … + Alt … → …").
    expect(html).toMatch(/title="MCQ [\d.]+ \+ Essay [\d.]+ [+−] Alt [\d.]+ →/);
  });

  it("renders clean subject headers identical to Grades (Arabic, never the 'G12++' data prefix)", async () => {
    activeProvider = live;
    const html = await renderScore(liveId);
    // Column headers read the clean subject names, the same as the Grades screen.
    for (const h of ["Applicable Math", "English", "Scientific", "Arabic", "Life"]) {
      expect(html).toContain(`>${h}<`);
    }
    // The "G12++ " data prefix must never appear as a column header label. (The
    // product brand legitimately contains "G12++" elsewhere in the shell, so scope
    // the check to <th> cells.)
    expect(html).not.toMatch(/<th[^>]*>[^<]*G12\+\+/);
  });

  it("strips the 'G12++ ' prefix even when it leaks into a subject's shortName", async () => {
    // Guard the header derivation directly: a subject whose shortName still carries
    // the raw "G12++ " prefix must render the clean trailing label, never "G12++".
    const base = live.getComposition(liveId)!;
    const leaked = {
      ...base,
      subjects: base.subjects.map((s, i) => (i === 0 ? { ...s, shortName: "G12++ Mystery" } : s)),
    };
    // Delegate everything to the live provider (preserving prototype methods used
    // by the shell, e.g. getCurrentUser), overriding only getComposition.
    activeProvider = new Proxy(live, {
      get(target, prop, receiver) {
        if (prop === "getComposition") return () => leaked;
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as unknown as DataProvider;
    const html = await renderScore(liveId);
    expect(html).toContain(">Mystery<");
    expect(html).not.toMatch(/<th[^>]*>[^<]*G12\+\+/);
  });

  it("renders one compact figure per subject cell (raw/max · %), not a multi-line cell", async () => {
    activeProvider = live;
    const html = await renderScore(liveId);
    // Each cell is a single compact figure like "18/35 · 51%".
    expect(html).toMatch(/\d+\/\d+ · \d+%/);
  });

  it("is read-only: no cut-point / boundary controls (distinct from Boundaries)", async () => {
    activeProvider = live;
    const html = await renderScore(liveId);
    // None of the Boundaries cut-point UI appears on the Score screen.
    expect(html).not.toContain("Set cut-points");
    expect(html).not.toContain("Set distribution");
    expect(html).not.toContain("Cut-point ≥");
    expect(html).not.toContain("Score distribution");
  });
});
