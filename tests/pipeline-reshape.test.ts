/**
 * Pipeline reshape (G12++): the single-run step order was reshaped — Raw data is
 * folded into Clean, Assessment Health (was "Diagnostics") and Essay marks are
 * now steps, Adjustments → Technical adjustments, Boundaries → Cut scores. The
 * top cycle tab bar is Critical Path (was "Pipeline") · Audit log · Diagnostics.
 * These tests pin the new order/labels, that Assessment
 * Health renders as a step (with Cronbach's alpha), that the Raw data view lives
 * in Clean, that Essay marks is reachable both as a step and via the Upload card,
 * and that the continue buttons follow the new order with nothing skipped.
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
  "Assessment Health",
  "Essay marks",
  "Technical adjustments",
  "Score",
  "Cut scores",
  "CGJ",
  "Grades",
];

describe("stepper order + labels", () => {
  it("PIPELINE_STAGES is the 11-step order, ending at Grades (no per-sitting Export)", () => {
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
    expect(PIPELINE_STAGES).toContain("Assessment Health");
    expect(PIPELINE_STAGES).not.toContain("Adjustments");
    expect(PIPELINE_STAGES).not.toContain("Boundaries");
    expect(PIPELINE_STAGES).not.toContain("Raw data");
    // The whole-assessment step was renamed off the ambiguous "Diagnostics".
    expect(PIPELINE_STAGES).not.toContain("Diagnostics");
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
  it("carries Critical Path, Audit log and the Diagnostics tab (no per-sitting Certificates tab)", () => {
    const tabs = cyclesSubnav("c", "pipeline");
    const labels = tabs.map((t) => t.label);
    expect(labels).toEqual(["Critical Path", "Audit log", "Diagnostics"]);
    // The sitting-level "Diagnostics" reference tab routes to its own hub, distinct
    // from the whole-assessment "Assessment Health" step at /cycles/c/diagnostics.
    // Only one user-facing "Diagnostics" (the tab) — the in-path step is
    // "Assessment Health", so there is no double-naming.
    expect(tabs.find((t) => t.label === "Diagnostics")?.href).toBe("/cycles/c/diagnostics-hub");
    // "Pipeline" was renamed to "Critical Path".
    expect(labels).not.toContain("Pipeline");
    // Document generation moved to the cycle/overall level — no per-sitting tab.
    expect(labels).not.toContain("Certificates");
  });
});

describe("routing follows the new order with nothing skipped", () => {
  it("each index routes to the right screen and Raw data has no route", () => {
    expect(stageRoute("c", 1)).toBe("/cycles/c/clean");
    expect(stageRoute("c", 4)).toBe("/cycles/c/diagnostics");
    expect(stageRoute("c", 5)).toBe("/cycles/c/essays");
    expect(stageRoute("c", 6)).toBe("/cycles/c/adjustments");
    expect(stageRoute("c", 8)).toBe("/cycles/c/boundaries");
    expect(stageRoute("c", 9)).toBe("/cycles/c/cgj");
    expect(stageRoute("c", 10)).toBe("/cycles/c/grades");
    for (let i = 0; i <= 10; i++) expect(stageRoute("c", i)).not.toContain("/raw-data");
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

describe("Assessment Health is a pipeline step with Cronbach's alpha", () => {
  it("renders as a step (continue onward) and shows reliability/alpha", async () => {
    active = new InMemoryDataProvider();
    const { default: AssessmentHealthPage } = await import("@/app/cycles/[cycleId]/diagnostics/page");
    const out = html(e(AssessmentHealthPage, { params: { cycleId: CYCLE } }));
    expect(out).toContain("Assessment Health");
    expect(out).toContain("Cronbach"); // ReliabilityPanel = Cronbach's alpha
    // It is a step now: a continue button onto Essay marks (not a dead-end tab).
    expect(out).toContain(`/cycles/${CYCLE}/essays`);
    expect(out).toContain("Continue to essay marks");
  });
});

describe("Essay marks is reachable as a step", () => {
  it("renders the essay-marks entry and continues to technical adjustments", async () => {
    active = new InMemoryDataProvider();
    const { default: EssaysPage } = await import("@/app/cycles/[cycleId]/essays/page");
    const out = html(e(EssaysPage, { params: { cycleId: CYCLE } }));
    expect(out).toContain("Essay marks");
    expect(out).toContain("Add essay-marks file"); // the shared EssayMarksCard
    expect(out).toContain(`/cycles/${CYCLE}/adjustments`);
    expect(out).toContain("Continue to technical adjustments");
  });
});

describe("Essay marks upload card still works on Upload", () => {
  it("the Upload screen still carries the Essay marks card (both entry points kept)", async () => {
    active = new InMemoryDataProvider();
    const { default: ImportPage } = await import("@/app/cycles/[cycleId]/import/page");
    const out = html(e(ImportPage, { params: { cycleId: CYCLE } }));
    expect(out).toContain("Upload exam data");
    // The optional "Essay marks" card is still present on Upload (collapsed by
    // default — its body opens on click); it shares EssayMarksCard with the step.
    expect(out).toContain("Essay marks");
  });
});

describe("continue buttons follow the new order", () => {
  it("Question review → Assessment Health", async () => {
    active = new InMemoryDataProvider();
    const { default: ReviewPage } = await import("@/app/cycles/[cycleId]/review/[assessmentId]/page");
    const out = html(e(ReviewPage, { params: { cycleId: CYCLE, assessmentId: FIRST_ASSESSMENT } }));
    expect(out).toContain("Continue to assessment health");
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
