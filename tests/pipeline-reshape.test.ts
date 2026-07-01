/**
 * Pipeline reshape (G12++): the single-run step order was reshaped — Raw data is
 * folded into Clean, Diagnostics is now a step (no longer a top tab), Adjustments
 * → Technical adjustments, Boundaries → Cut scores. Essay marks are uploaded on
 * Upload (step 1) and fold into the scored totals automatically — NOT a standalone
 * step. These tests pin the new 10-step order/labels, that Diagnostics renders as a
 * step (with Cronbach's alpha) and continues to Technical adjustments, that the Raw
 * data view lives in Clean, that the Essay marks upload lives on Upload, and that
 * the continue buttons follow the new order with nothing skipped.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PIPELINE_STAGES } from "@/lib/ui/tokens";
import { PIPELINE } from "@/lib/data/types";
import { cyclesSubnav } from "@/lib/ui/subnav";
import { stageRoute } from "@/lib/data/pipeline-route";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { DataProvider } from "@/lib/data/provider";

const EXPECTED_ORDER = [
  "Upload",
  "Clean",
  "Raw scores",
  "Question review",
  "Diagnostics",
  "Technical adjustments",
  "Score",
  "Cut scores",
  "CGJ",
  "Grades",
];

describe("stepper order + labels", () => {
  it("PIPELINE_STAGES is the 10-step order, ending at Grades (no per-sitting Export)", () => {
    expect([...PIPELINE_STAGES]).toEqual(EXPECTED_ORDER);
    // Document/certificate generation is not a per-sitting step — it lives at the
    // cycle/overall level — so the stepper no longer carries an "Export" stage.
    expect(PIPELINE_STAGES).not.toContain("Export");
  });

  it("the provider's PIPELINE labels match the stepper", () => {
    expect([...PIPELINE]).toEqual(EXPECTED_ORDER);
  });

  it("renames applied and the old labels are gone", () => {
    expect(PIPELINE_STAGES).toContain("Technical adjustments");
    expect(PIPELINE_STAGES).toContain("Cut scores");
    expect(PIPELINE_STAGES).not.toContain("Adjustments");
    expect(PIPELINE_STAGES).not.toContain("Boundaries");
    expect(PIPELINE_STAGES).not.toContain("Raw data");
    // Essay marks is no longer a standalone stage — it's uploaded on Upload and
    // folds into the scored totals automatically.
    expect(PIPELINE_STAGES).not.toContain("Essay marks");
  });

  it("CGJ sits directly after Cut scores, before Grades", () => {
    const cut = [...PIPELINE_STAGES].indexOf("Cut scores");
    const cgj = [...PIPELINE_STAGES].indexOf("CGJ");
    const grades = [...PIPELINE_STAGES].indexOf("Grades");
    expect(cgj).toBe(cut + 1);
    expect(grades).toBe(cgj + 1);
  });
});

describe("top cycle tab bar", () => {
  it("carries Pipeline, Audit log and the Diagnostics tab (no per-sitting Certificates tab)", () => {
    const tabs = cyclesSubnav("c", "pipeline");
    const labels = tabs.map((t) => t.label);
    expect(labels).toEqual(["Pipeline", "Audit log", "Diagnostics"]);
    // The sitting-level Diagnostics tab routes to its own placeholder hub, distinct
    // from the per-subject Diagnostics pipeline step at /cycles/c/diagnostics.
    expect(tabs.find((t) => t.label === "Diagnostics")?.href).toBe("/cycles/c/diagnostics-hub");
    // Document generation moved to the cycle/overall level — no per-sitting tab.
    expect(labels).not.toContain("Certificates");
  });
});

describe("routing follows the new order with nothing skipped", () => {
  it("each index routes to the right screen; Raw data and Essay marks have no route", () => {
    expect(stageRoute("c", 1)).toBe("/cycles/c/clean");
    expect(stageRoute("c", 4)).toBe("/cycles/c/diagnostics");
    expect(stageRoute("c", 5)).toBe("/cycles/c/adjustments");
    expect(stageRoute("c", 6)).toBe("/cycles/c/score");
    expect(stageRoute("c", 7)).toBe("/cycles/c/boundaries");
    expect(stageRoute("c", 8)).toBe("/cycles/c/cgj");
    expect(stageRoute("c", 9)).toBe("/cycles/c/grades");
    for (let i = 0; i <= 10; i++) {
      expect(stageRoute("c", i)).not.toContain("/raw-data");
      expect(stageRoute("c", i)).not.toContain("/essays");
    }
  });
});

// ── page renders against the real provider read-models ───────────────────────
let active: DataProvider = new InMemoryDataProvider();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => active,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(active),
}));

const CYCLE = new InMemoryDataProvider().getCompareCycles().cycles.find((c) => !c.mock)!.id;
const FIRST_ASSESSMENT = new InMemoryDataProvider().getCycle(CYCLE)!.assessments[0]!.id;

function html(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(node);
}

describe("Clean step holds the raw-data view + cleaning controls", () => {
  it("shows the folded-in raw-data overview AND the validation/cleaning surface", async () => {
    active = new InMemoryDataProvider();
    const { default: CleanPage } = await import("@/app/cycles/[cycleId]/clean/page");
    const out = html(e(CleanPage, { params: { cycleId: CYCLE } }));
    // raw-data view (folded in) — the always-on summary band keeps the headline
    // figures visible; the per-element / per-demand breakdown is collapsed by
    // default (toggled via "Show breakdown") so the selectable table below stays
    // reachable within the viewport.
    expect(out).toContain("Participants");
    expect(out).toContain("Major elements");
    expect(out).toContain("Show breakdown");
    // cleaning controls
    expect(out).toContain("Validation report");
    expect(out).toContain("Clean &amp; continue");
  });
});

describe("Diagnostics is a pipeline step with Cronbach's alpha", () => {
  it("renders as a step (continue onward) and shows reliability/alpha", async () => {
    active = new InMemoryDataProvider();
    const { default: DiagnosticsPage } = await import("@/app/cycles/[cycleId]/diagnostics/page");
    const out = html(e(DiagnosticsPage, { params: { cycleId: CYCLE } }));
    expect(out).toContain("Diagnostics");
    expect(out).toContain("Cronbach"); // ReliabilityPanel = Cronbach's alpha
    // It is a step now: a continue button straight onto Technical adjustments
    // (essay marks are uploaded on Upload, not a step in between).
    expect(out).toContain(`/cycles/${CYCLE}/adjustments`);
    expect(out).toContain("Continue to technical adjustments");
  });
});

describe("Essay marks upload lives on Upload (no standalone step)", () => {
  it("the Upload screen carries the Essay marks card — the sole entry point", async () => {
    active = new InMemoryDataProvider();
    const { default: ImportPage } = await import("@/app/cycles/[cycleId]/import/page");
    const out = html(e(ImportPage, { params: { cycleId: CYCLE } }));
    expect(out).toContain("Upload exam data");
    // The optional "Essay marks" card sits on Upload (collapsed by default — its
    // body opens on click) via the shared EssayMarksCard; marks fold into the
    // scored totals automatically, so there is no separate essay-marks step.
    expect(out).toContain("Essay marks");
  });
});

describe("continue buttons follow the new order", () => {
  it("Question review → Diagnostics", async () => {
    active = new InMemoryDataProvider();
    const { default: ReviewPage } = await import("@/app/cycles/[cycleId]/review/[assessmentId]/page");
    const out = html(e(ReviewPage, { params: { cycleId: CYCLE, assessmentId: FIRST_ASSESSMENT } }));
    expect(out).toContain("Continue to diagnostics");
    expect(out).toContain(`/cycles/${CYCLE}/diagnostics`);
  });

  it("Technical adjustments → Score", async () => {
    active = new InMemoryDataProvider();
    const { default: AdjustmentsPage } = await import("@/app/cycles/[cycleId]/adjustments/page");
    const out = html(e(AdjustmentsPage, { params: { cycleId: CYCLE } }));
    expect(out).toContain("Technical adjustments");
    expect(out).toContain(`/cycles/${CYCLE}/score`);
  });

  it("Cut scores → CGJ", async () => {
    active = new InMemoryDataProvider();
    const { default: BoundariesPage } = await import("@/app/cycles/[cycleId]/boundaries/page");
    const out = html(e(BoundariesPage, { params: { cycleId: CYCLE } }));
    expect(out).toContain("Confirm cut scores");
    expect(out).toContain(`/cycles/${CYCLE}/cgj`);
  });

  it("CGJ → Grades", async () => {
    active = new InMemoryDataProvider();
    const { default: CgjPage } = await import("@/app/cycles/[cycleId]/cgj/page");
    const out = html(e(CgjPage, { params: { cycleId: CYCLE } }));
    expect(out).toContain("Centre grade judgement");
    expect(out).toContain(`/cycles/${CYCLE}/grades`);
  });
});
