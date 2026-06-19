/**
 * Pipeline reshape (G12++): the single-run step order was reshaped — Raw data is
 * folded into Clean, Diagnostics and Essay marks are now steps (Diagnostics is no
 * longer a top tab), Adjustments → Technical adjustments, Boundaries → Cut
 * scores. These tests pin the new order/labels, that Diagnostics renders as a
 * step (with Cronbach's alpha), that the Raw data view lives in Clean, that Essay
 * marks is reachable both as a step and via the Upload card, and that the
 * continue buttons follow the new order with nothing skipped.
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
  "Essay marks",
  "Technical adjustments",
  "Score",
  "Cut scores",
  "Grades",
  "Export",
];

describe("stepper order + labels", () => {
  it("PIPELINE_STAGES is the new 11-step order", () => {
    expect([...PIPELINE_STAGES]).toEqual(EXPECTED_ORDER);
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
  });
});

describe("top cycle tab bar", () => {
  it("no longer carries a standalone Diagnostics tab", () => {
    const labels = cyclesSubnav("c", "pipeline").map((t) => t.label);
    expect(labels).toEqual(["Pipeline", "Audit log", "Certificates"]);
    expect(labels).not.toContain("Diagnostics");
  });
});

describe("routing follows the new order with nothing skipped", () => {
  it("each index routes to the right screen and Raw data has no route", () => {
    expect(stageRoute("c", 1)).toBe("/cycles/c/clean");
    expect(stageRoute("c", 4)).toBe("/cycles/c/diagnostics");
    expect(stageRoute("c", 5)).toBe("/cycles/c/essays");
    expect(stageRoute("c", 6)).toBe("/cycles/c/adjustments");
    expect(stageRoute("c", 8)).toBe("/cycles/c/boundaries");
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
    // raw-data view (folded in)
    expect(out).toContain("before any cleaning");
    expect(out).toContain("Participants");
    expect(out).toContain("Items by major element");
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

  it("Cut scores → Grades", async () => {
    active = new InMemoryDataProvider();
    const { default: BoundariesPage } = await import("@/app/cycles/[cycleId]/boundaries/page");
    const out = html(e(BoundariesPage, { params: { cycleId: CYCLE } }));
    expect(out).toContain("Confirm cut scores");
    expect(out).toContain(`/cycles/${CYCLE}/grades`);
  });
});
