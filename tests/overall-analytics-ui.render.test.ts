/**
 * Smoke-renders the Overall analytics UI (slicer + accordion + the four
 * sections) against the REAL provider read-model via renderToStaticMarkup. This
 * exercises every ovKit chart with live data shapes — catching runtime errors
 * the build can't (empty years, single centre, Combined-only levels) — and
 * confirms the focused questions and the four-dropdown slicer reach the markup,
 * while the design's mock constants do not.
 */
import { describe, it, expect } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { OVAccordion, OVSlicerDropdowns, OVActiveSlice, defaultFinalSlice, finalToLegacy } from "@/components/ui/overall/slicer";
import { S1Participation, S2Performance, S3Award, S4Centres } from "@/components/ui/overall/sections";
import type { LegacySlice } from "@/components/ui/overall/kit";

const provider = new InMemoryDataProvider();
const analytics = provider.getOverallAnalytics();
const legacy = (patch: Partial<Parameters<typeof finalToLegacy>[0]> = {}): LegacySlice =>
  finalToLegacy({ ...defaultFinalSlice(analytics), ...patch }, analytics);

describe("Overall analytics UI renders with live data", () => {
  it("renders the four-dropdown slicer + active-slice readout", () => {
    const slice = defaultFinalSlice(analytics);
    const html = renderToStaticMarkup(
      e("div", null,
        e(OVActiveSlice, { slice, analytics }),
        e(OVSlicerDropdowns, { slice, setSlice: () => {}, analytics, futureYears: [2027, 2028, 2029, 2030] }),
      ),
    );
    expect(html).toContain("Now viewing");
    expect(html).toContain("Time");
    expect(html).toContain("Exam type");
    expect(html).toContain("Partner centre");
    expect(html).toContain("Subject");
    expect(html).toContain("Reset");
    expect(html).toContain("2027"); // ghosted future year on the always-visible track
  });

  it("renders the accordion with all four focused questions", () => {
    const html = renderToStaticMarkup(e(OVAccordion, { analytics, slice: legacy() }));
    expect(html).toContain("Are we growing, and are more students getting through?");
    expect(html).toContain("improving between sittings?");
    expect(html).toContain("toward higher awards over time?");
    expect(html).toContain("gap between best and worst widening?");
  });

  it("§1 renders participation KPIs + funnel and no leaked '%%' double unit", () => {
    const html = renderToStaticMarkup(e(S1Participation, { analytics, slice: legacy() }));
    expect(html).toContain("Partner centres");
    expect(html).toContain("Completed both sittings");
    expect(html).toContain("Pass rate over time");
    expect(html).not.toContain("%%");
  });

  it("§2 · Combined switches to best-of-two performance levels (no score stats)", () => {
    const html = renderToStaticMarkup(e(S2Performance, { analytics, slice: legacy({ exams: ["Combined"] }) }));
    expect(html).toContain("best-of-two");
    expect(html).toContain("Meets+");
  });

  it("§2 · a single (February) sitting shows score statistics, not levels", () => {
    const slice = legacy({ exams: ["February"], subjects: [analytics.subjects[0]!.key] });
    expect(slice.exam).toBe("February");
    const html = renderToStaticMarkup(e(S2Performance, { analytics, slice }));
    expect(html).toContain("score statistics");
  });

  it("§2 · subject selection drives the section — only selected subjects render as chips", () => {
    const picked = analytics.subjects[0]!;
    const dropped = analytics.subjects[1]!;
    const slice = legacy({ subjects: [picked.key] });
    const html = renderToStaticMarkup(e(S2Performance, { analytics, slice }));
    expect(html).toContain(picked.short);
    expect(html).not.toContain(`>${dropped.short}<`); // the dropped subject has no chip
  });

  it("§3 · a single centre annotates the cohort-shape card", () => {
    const slice = legacy({ centres: [analytics.centres[0]!] });
    expect(slice.centre.mode).toBe("single");
    const html = renderToStaticMarkup(e(S3Award, { analytics, slice }));
    expect(html).toContain("single centre");
    expect(html).toContain("By centre");
  });

  it("§4 · a single centre disables the cross-centre comparison", () => {
    const html = renderToStaticMarkup(e(S4Centres, { analytics, slice: legacy({ centres: [analytics.centres[0]!] }) }));
    expect(html).toContain("needs at least two centres");
  });

  it("§4 · two-or-more centres render the by-award-level and by-subject views", () => {
    const html = renderToStaticMarkup(e(S4Centres, { analytics, slice: legacy() }));
    expect(html).toContain("View A");
    expect(html).toContain("View B");
    // View A + B both describe the per-centre pass rate (one consistent measure).
    expect(html).toContain("Secondary Achievement or above");
    expect(html).toContain("SD across centres"); // not the uppercased "Σ"
    expect(html).not.toContain("Σ across centres");
  });

  it("§1 · a single selected year shows the single-year note instead of a trend", () => {
    const slice = legacy({ years: [analytics.years[analytics.years.length - 1]!] });
    expect(slice.year).not.toBe("trend");
    const html = renderToStaticMarkup(e(S1Participation, { analytics, slice }));
    expect(html).toContain("single year");
  });
});
