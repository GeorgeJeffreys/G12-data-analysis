/**
 * Smoke-renders the Compare-cycles chart kit with the REAL provider model via
 * renderToStaticMarkup. This exercises every chart (grouped/score/award/slope/
 * stacked/perf/cut) with live data shapes — catching runtime errors the build
 * can't (null metrics, empty groups) — and confirms the confirmed vocabulary
 * and explicit cycle names reach the markup, while the mockup placeholders do
 * not.
 */
import { describe, it, expect } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import {
  KpiTile, GroupedBars, ScoreBars, AwardDist, SlopeChart, StackedItems, PerfLevels, CutScores,
  type CycleMeta,
} from "@/components/ui/compare";
import { awardShortLabel } from "@/components/ui/analytics";

const f2 = (v: number) => v.toFixed(2);

describe("Compare-cycles chart kit renders with live data", () => {
  const provider = new InMemoryDataProvider();
  const model = provider.getCompareCycles();
  const cycles: CycleMeta[] = model.cycles.map((c) => ({ name: c.name, mock: c.mock }));
  const subj = model.subjects[0]!;

  const subjectSeries = (pick: (m: any) => number | null) =>
    model.subjects.map((s) => ({ label: s.short, values: model.cycles.map((c) => pick(c.subjects[s.id])) }));

  it("renders the overview charts without throwing", () => {
    const html = renderToStaticMarkup(
      e("div", null,
        e(KpiTile, { label: "Total participants", cycles, values: model.cycles.map((c) => c.participantsTotal), fmt: (v: number) => String(v), good: true }),
        e(GroupedBars, { groups: subjectSeries((m) => m?.participants ?? null), cycles, max: 20, ticks: [0, 5, 10, 15, 20], fmt: (v: number) => String(v) }),
        e(ScoreBars, { groups: model.subjects.map((s) => ({ label: s.short, mean: model.cycles.map((c) => c.subjects[s.id]?.scoreMean ?? null), median: model.cycles.map((c) => c.subjects[s.id]?.scoreMedian ?? null) })), cycles, max: 100, ticks: [0, 50, 100], fmt: (v: number) => `${v}%` }),
        e(AwardDist, { levels: model.awardLevels, cycles, counts: model.awardLevels.map((lvl) => model.cycles.map((c) => c.awardDist[lvl] ?? 0)), max: 20, ticks: [0, 10, 20] }),
        e(SlopeChart, { groups: subjectSeries((m) => m?.avgPValue ?? null), cycles, min: 0.3, max: 0.7, ticks: [0.3, 0.5, 0.7], fmt: f2 }),
        e(GroupedBars, { groups: subjectSeries((m) => m?.alpha ?? null), cycles, max: 1, ticks: [0, 0.5, 1], fmt: f2, refLine: 0.7 }),
        e(StackedItems, { groups: model.subjects.map((s) => ({ label: s.short, usable: model.cycles.map((c) => c.subjects[s.id]?.itemsUsable ?? null), removed: model.cycles.map((c) => c.subjects[s.id]?.itemsRemoved ?? null) })), cycles, max: 60, ticks: [0, 30, 60] }),
      ),
    );
    // explicit cycle names + subject labels reach the markup
    for (const c of model.cycles) expect(html).toContain(c.name);
    expect(html).toContain(subj.short);
    // confirmed award vocabulary, not the placeholders
    expect(html).toContain(awardShortLabel("Distinction award"));
    for (const p of ["Emerging", "Developing"]) expect(html).not.toContain(p);
  });

  it("renders the single-subject focus charts without throwing", () => {
    const cutRows = Array.from({ length: model.performanceLevels.length - 1 }, (_, i) => ({
      name: model.cycles.map((c) => c.subjects[subj.id]?.cuts[i]?.name).find(Boolean) ?? `Cut ${i + 1}`,
      values: model.cycles.map((c) => c.subjects[subj.id]?.cuts[i]?.value ?? null),
    }));
    const html = renderToStaticMarkup(
      e("div", null,
        e(PerfLevels, { levels: model.performanceLevels, cycles, counts: model.performanceLevels.map((lvl) => model.cycles.map((c) => c.subjects[subj.id]?.perfCounts?.[lvl] ?? 0)) }),
        e(CutScores, { cuts: cutRows, cycles, scoreMax: model.cycles[model.cycles.length - 1]?.subjects[subj.id]?.scoreMax ?? 50 }),
      ),
    );
    expect(html).toContain("Outstanding performance");
    expect(html).toContain("Meets expectations");
  });
});
