"use client";

/**
 * Analytics › Compare cycles — the finished design ported to live data. A
 * side-by-side comparison of two-or-more NAMED cycles across the five subjects,
 * grouped into Exam info · Question statistics · Usable items, with an
 * all-subjects overview and a single-subject focus.
 *
 * Read-only: every figure is an already-computed provider output (see
 * getCompareCycles). The live cycle is REAL; prior cycles are clearly-labelled
 * mock (no real cross-cycle history yet). The award/performance vocabulary and
 * colours are the confirmed G12++ model — never the mockup's placeholders.
 */
import { useState } from "react";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Chip, Badge } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { analyticsSubnav } from "@/lib/ui/subnav";
import { MockBanner } from "@/components/ui/analytics";
import {
  KpiTile,
  SectionHead,
  ChartCard,
  GroupedBars,
  ScoreBars,
  AwardDist,
  SlopeChart,
  StackedItems,
  PerfLevels,
  CutScores,
  cycleColor,
  type CycleMeta,
  type BarGroup,
} from "@/components/ui/compare";
import type { CompareCyclesModel, CompareCycleData } from "@/lib/data/types";

const f2 = (v: number) => v.toFixed(2);
const pct = (v: number) => `${v}%`;
const GRID2: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 };

/** Smallest multiple of `step` that is ≥ every value (with a small headroom). */
function niceMax(values: (number | null | undefined)[], step: number, floor = step): number {
  const m = Math.max(floor, ...values.map((v) => (v == null || !Number.isFinite(v) ? 0 : v)));
  return Math.ceil((m + step * 0.15) / step) * step;
}
function ticksTo(max: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => Math.round((max / n) * i * 100) / 100);
}

function subjectSeries(
  model: CompareCyclesModel,
  pick: (m: CompareCycleData["subjects"][string] | undefined) => number | null,
): BarGroup[] {
  return model.subjects.map((s) => ({
    label: s.short,
    values: model.cycles.map((c) => pick(c.subjects[s.id])),
  }));
}

export default function ComparePage() {
  const [picked, setPicked] = useState<string[] | null>(null);
  const [view, setView] = useState<string>("all"); // "all" | assessmentId
  const [addOpen, setAddOpen] = useState(false);

  const model = useProviderData(
    (p) => p.getCompareCycles(picked ?? undefined),
    [picked?.join(",") ?? ""],
  );

  const cyclesMeta: CycleMeta[] = model.cycles.map((c) => ({ name: c.name, mock: c.mock }));
  const sel = model.selectedIds;
  const unselected = model.available.filter((a) => !sel.includes(a.id));

  const removeCycle = (id: string) => {
    if (sel.length <= 2) return; // need at least two to compare
    setPicked(sel.filter((x) => x !== id));
  };
  const addCycle = (id: string) => {
    setPicked([...sel, id]);
    setAddOpen(false);
  };

  return (
    <Shell
      active="Analytics"
      crumb={[{ label: "Analytics" }, { label: "Compare sittings" }]}
      subnav={analyticsSubnav("compare")}
      actions={
        <Button variant="ghost" onClick={() => exportComparison(model)}>
          <Icon name="download" />Export comparison
        </Button>
      }
    >
      <div style={{ maxWidth: 1340, width: "100%", margin: "0 auto", padding: "24px 30px 56px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="hf-col" style={{ gap: 6 }}>
          <div className="hf-h1">Compare sittings</div>
          <div className="hf-sub">
            Side-by-side comparison of{" "}
            {model.cycles.map((c, i) => (
              <span key={c.id}>
                {i > 0 && (i === model.cycles.length - 1 ? " and " : ", ")}
                <strong style={{ color: H.ink }}>{c.name}</strong>
              </span>
            ))}
            , grouped into exam info, question statistics and usable items. Many of the same students sit consecutive sittings, so these comparisons are directly meaningful.
          </div>
        </div>

        {/* ── controls: sittings + subject view ── */}
        <div className="hf-card" style={{ padding: "13px 16px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", position: "relative" }}>
          <span className="hf-lbl" style={{ marginRight: 2 }}>Sittings</span>
          {model.cycles.map((c) => (
            <span key={c.id} className="hf-chip on" style={{ gap: 6 }}>
              {c.name}
              {c.mock && <span style={{ fontSize: 8, opacity: 0.85, letterSpacing: 0.4 }}>MOCK</span>}
              {sel.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  onClick={() => removeCycle(c.id)}
                  style={{ marginLeft: 2, opacity: 0.6, background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit", font: "inherit" }}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          <span style={{ position: "relative" }}>
            <Chip onClick={() => unselected.length > 0 && setAddOpen((v) => !v)}>
              <Icon name="plus" size={12} />Add sitting
            </Chip>
            {addOpen && unselected.length > 0 && (
              <div className="hf-card" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, padding: 6, display: "flex", flexDirection: "column", gap: 2, minWidth: 180, boxShadow: "0 10px 30px -10px rgba(31,42,49,.35)" }}>
                {unselected.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => addCycle(a.id)}
                    className="hf-hover"
                    style={{ textAlign: "left", padding: "7px 10px", borderRadius: 7, border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: 12.5, color: H.ink }}
                  >
                    {a.name}{a.mock ? <span style={{ color: H.ink3, fontSize: 9, marginLeft: 6 }}>MOCK</span> : null}
                  </button>
                ))}
              </div>
            )}
          </span>
          <span style={{ width: 1, height: 22, background: H.line2, margin: "0 6px" }} />
          <span className="hf-lbl" style={{ marginRight: 2 }}>View</span>
          <Chip on={view === "all"} onClick={() => setView("all")}>All subjects</Chip>
          {model.subjects.map((s) => (
            <Chip key={s.id} on={view === s.id} onClick={() => setView(s.id)}>{s.full}</Chip>
          ))}
        </div>

        {model.anyMock && <MockBanner text="Prior sittings are illustrative mock data — only the latest (live) sitting's figures are computed from real results. Sitting names are explicit throughout." />}

        {view === "all" ? (
          <OverviewBody model={model} cyclesMeta={cyclesMeta} />
        ) : (
          <FocusBody model={model} cyclesMeta={cyclesMeta} subjectId={view} onBack={() => setView("all")} />
        )}
      </div>
    </Shell>
  );
}

const ALPHA_INFO = (
  <span>By convention, a reliability coefficient (Cronbach&apos;s α) of <strong>0.70 or above</strong> is considered acceptable for a test of this kind — the dashed line marks 0.70. α comes from the sitting&apos;s reliability output; it is shown as unavailable where a sitting has none.</span>
);
const PVALUE_INFO = <span>The p-value is the average proportion of candidates answering correctly. <strong>Higher = easier.</strong> It is a difficulty index, not a quality judgement.</span>;
const PB_INFO = <span>Point-biserial measures how well an item separates stronger and weaker candidates. Higher is better; the dashed line marks the 0.20 convention.</span>;
const AWARD_INFO = <span>Candidates earning any award — <strong>Secondary achievement</strong>, <strong>Advanced achievement</strong> or <strong>Distinction</strong> — i.e. not the lowest &ldquo;No Award&rdquo; band. Derived from the confirmed award rule, not a score cut.</span>;

// ── ALL-SUBJECTS OVERVIEW ────────────────────────────────────────────────────
function OverviewBody({ model, cyclesMeta }: { model: CompareCyclesModel; cyclesMeta: CycleMeta[] }) {
  const cyclesCaption = model.cycles.map((c) => c.name).join(" vs ");
  const partMax = niceMax(model.subjects.flatMap((s) => model.cycles.map((c) => c.subjects[s.id]?.participants ?? null)), 5, 10);
  const awardCounts = model.awardLevels.map((lvl) => model.cycles.map((c) => c.awardDist[lvl] ?? 0));
  const awardMax = niceMax(awardCounts.flat(), 5, 5);
  const pVals = model.subjects.flatMap((s) => model.cycles.map((c) => c.subjects[s.id]?.avgPValue ?? null));
  const pMin = Math.min(1, ...pVals.filter((v): v is number => v != null)) ;
  const pMax = Math.max(0, ...pVals.filter((v): v is number => v != null));
  const slopeMin = Math.max(0, Math.floor((pMin - 0.05) * 10) / 10);
  const slopeMax = Math.min(1, Math.ceil((pMax + 0.05) * 10) / 10);
  const itemMax = niceMax(
    model.subjects.flatMap((s) => model.cycles.map((c) => (c.subjects[s.id]?.itemsUsable ?? 0) + (c.subjects[s.id]?.itemsRemoved ?? 0))),
    10, 10,
  );

  return (
    <div className="hf-col" style={{ gap: 18 }}>
      {/* ── Exam info ── */}
      <SectionHead title="Exam info" sub="Who sat each subject, how they scored, and how the cohort was awarded." />
      <div className="hf-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "stretch" }}>
        <KpiTile label="Total participants" cycles={cyclesMeta} values={model.cycles.map((c) => c.participantsTotal)} fmt={(v) => String(v)} good />
        <KpiTile label="Avg score (all subjects)" cycles={cyclesMeta} values={model.cycles.map((c) => c.avgScoreAllSubjects)} fmt={pct} good />
        <KpiTile label="Pass or above" cycles={cyclesMeta} values={model.cycles.map((c) => c.passOrAboveCount)} fmt={(v) => String(v)} good info={AWARD_INFO} />
      </div>
      <div style={GRID2}>
        <ChartCard title="Participation — candidates sitting per subject" cycles={`${cyclesCaption} · per subject`}
          note="Many of the same students sit consecutive sittings, so counts move only modestly."
          legend={cyclesMeta.map((c, i) => ({ c: cycleColor(i, cyclesMeta.length), label: c.name }))}>
          <GroupedBars groups={subjectSeries(model, (m) => m?.participants ?? null)} cycles={cyclesMeta} max={partMax} ticks={ticksTo(partMax, 4)} fmt={(v) => String(v)} />
        </ChartCard>
        <ChartCard title="Average & median score per subject" cycles={`${cyclesCaption} · % of available marks`}
          note="Bars show the cohort mean; the black line marks the median."
          legend={[...cyclesMeta.map((c, i) => ({ c: cycleColor(i, cyclesMeta.length), label: `Mean · ${c.name}` })), { c: H.ink, label: "Median (line)" }]}>
          <ScoreBars groups={model.subjects.map((s) => ({ label: s.short, mean: model.cycles.map((c) => c.subjects[s.id]?.scoreMean ?? null), median: model.cycles.map((c) => c.subjects[s.id]?.scoreMedian ?? null) }))} cycles={cyclesMeta} max={100} ticks={[0, 25, 50, 75, 100]} fmt={pct} />
        </ChartCard>
        <ChartCard title="Pass-or-above rate per subject" cycles={`${cyclesCaption} · % reaching Meets expectations or above`}
          note="Share of each subject's cohort reaching at least “Meets expectations”."
          legend={cyclesMeta.map((c, i) => ({ c: cycleColor(i, cyclesMeta.length), label: c.name }))}>
          <GroupedBars groups={subjectSeries(model, (m) => m?.passOrAbove ?? null)} cycles={cyclesMeta} max={100} ticks={[0, 25, 50, 75, 100]} fmt={pct} />
        </ChartCard>
        <ChartCard title="Overall award distribution — all subjects" cycles={`${cyclesCaption} · candidates per award level`}
          note="The standing award-distribution chart. Each award level shows the sittings side by side in its own colour; the newest is solid."
          legend={cyclesMeta.map((c, i) => ({ c: H.ink3, light: i !== cyclesMeta.length - 1, label: c.name }))}
          info={AWARD_INFO}>
          <AwardDist levels={model.awardLevels} cycles={cyclesMeta} counts={awardCounts} max={awardMax} ticks={ticksTo(awardMax, 5)} />
        </ChartCard>
      </div>

      {/* ── Question statistics ── */}
      <SectionHead title="Question statistics" sub="Psychometric behaviour of the items: difficulty, discrimination and reliability." />
      <div className="hf-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "stretch" }}>
        <KpiTile label="Avg difficulty (p-value)" cycles={cyclesMeta} values={model.cycles.map((c) => c.avgPValue)} fmt={f2} good={null} info={PVALUE_INFO} />
        <KpiTile label="Avg reliability (α)" cycles={cyclesMeta} values={model.cycles.map((c) => c.avgAlpha)} fmt={f2} good info={ALPHA_INFO} />
      </div>
      <div style={GRID2}>
        <ChartCard style={{ gridColumn: "1 / -1" }} title="Exam difficulty — average p-value per subject" cycles={`${cyclesCaption} · all subjects`}
          note="p-value = average proportion correct. Higher = easier. Each line shows how a subject's difficulty moved between sittings."
          legend={cyclesMeta.map((c, i) => ({ c: cycleColor(i, cyclesMeta.length), label: c.name, ring: i !== cyclesMeta.length - 1 }))}
          info={PVALUE_INFO}>
          <SlopeChart groups={subjectSeries(model, (m) => m?.avgPValue ?? null)} cycles={cyclesMeta} min={slopeMin} max={slopeMax} ticks={ticksTo(slopeMax, 4).filter((t) => t >= slopeMin)} fmt={f2} />
        </ChartCard>
        <ChartCard title="Item quality — average discrimination (point-biserial)" cycles={`${cyclesCaption} · per subject`}
          note="Point-biserial shows how well items separate stronger and weaker candidates. Higher is better; the dashed line marks 0.20."
          legend={cyclesMeta.map((c, i) => ({ c: cycleColor(i, cyclesMeta.length), label: c.name }))}
          info={PB_INFO}>
          <GroupedBars groups={subjectSeries(model, (m) => m?.avgPointBiserial ?? null)} cycles={cyclesMeta} max={0.4} ticks={[0, 0.1, 0.2, 0.3, 0.4]} fmt={f2} refLine={0.2} />
        </ChartCard>
        <ChartCard title="Reliability — Cronbach's α per subject" cycles={`${cyclesCaption} · per subject`}
          note="Internal consistency of each test. Convention: α ≥ 0.70 is acceptable (dashed line). Unavailable sittings show no bar."
          legend={cyclesMeta.map((c, i) => ({ c: cycleColor(i, cyclesMeta.length), label: c.name }))}
          info={ALPHA_INFO}>
          <GroupedBars groups={subjectSeries(model, (m) => m?.alpha ?? null)} cycles={cyclesMeta} max={1.0} ticks={[0, 0.25, 0.5, 0.75, 1.0]} fmt={f2} refLine={0.7} />
        </ChartCard>
      </div>

      {/* ── Usable items ── */}
      <SectionHead title="Usable items" sub="How many items survived quality and speededness review in each subject." />
      <ChartCard title="Usable items — items scored vs items removed" cycles={`${cyclesCaption} · per subject`}
        note="Items removed for quality or speededness sit below the usable pool; the number above each bar is the total item pool."
        legend={[...cyclesMeta.map((c, i) => ({ c: cycleColor(i, cyclesMeta.length), label: `Usable · ${c.name}` })), { c: H.warn, label: "Removed" }]}>
        <StackedItems groups={model.subjects.map((s) => ({ label: s.short, usable: model.cycles.map((c) => c.subjects[s.id]?.itemsUsable ?? null), removed: model.cycles.map((c) => c.subjects[s.id]?.itemsRemoved ?? null) }))} cycles={cyclesMeta} max={itemMax} ticks={ticksTo(itemMax, 5)} />
      </ChartCard>
    </div>
  );
}

// ── SINGLE-SUBJECT FOCUS ─────────────────────────────────────────────────────
function FocusBody({ model, cyclesMeta, subjectId, onBack }: { model: CompareCyclesModel; cyclesMeta: CycleMeta[]; subjectId: string; onBack: () => void }) {
  const subject = model.subjects.find((s) => s.id === subjectId);
  if (!subject) return null;
  const cyclesCaption = model.cycles.map((c) => c.name).join(" → ");
  const newest = model.cycles[model.cycles.length - 1];
  const newestSubj = newest?.subjects[subjectId];
  const scoreMax = newestSubj?.scoreMax ?? Math.max(1, ...model.cycles.map((c) => c.subjects[subjectId]?.scoreMax ?? 0));

  // cut-scores aligned by index across cycles
  const cutCount = Math.max(0, model.performanceLevels.length - 1);
  const cutRows = Array.from({ length: cutCount }, (_, i) => {
    const nameFrom = model.cycles.map((c) => c.subjects[subjectId]?.cuts[i]?.name).find(Boolean);
    return {
      name: nameFrom ?? `Cut ${i + 1}`,
      values: model.cycles.map((c) => c.subjects[subjectId]?.cuts[i]?.value ?? null),
    };
  });
  const perfCounts = model.performanceLevels.map((lvl) => model.cycles.map((c) => c.subjects[subjectId]?.perfCounts?.[lvl] ?? 0));
  const itemMax = niceMax(model.cycles.map((c) => (c.subjects[subjectId]?.itemsUsable ?? 0) + (c.subjects[subjectId]?.itemsRemoved ?? 0)), 10, 10);

  return (
    <div className="hf-col" style={{ gap: 18 }}>
      <div className="hf-row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Chip onClick={onBack}><Icon name="chev" size={12} /> All subjects</Chip>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.3px" }}>{subject.full}</span>
        <Badge tone="neutral">{cyclesCaption}</Badge>
      </div>

      {/* ── Exam info ── */}
      <SectionHead title="Exam info" sub="Participation, scores and award outcomes for this subject." />
      <div className="hf-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "stretch" }}>
        <KpiTile label="Participants" cycles={cyclesMeta} values={model.cycles.map((c) => c.subjects[subjectId]?.participants ?? null)} fmt={(v) => String(v)} good />
        <KpiTile label="Average score" cycles={cyclesMeta} values={model.cycles.map((c) => c.subjects[subjectId]?.scoreMean ?? null)} fmt={pct} good />
        <KpiTile label="Median score" cycles={cyclesMeta} values={model.cycles.map((c) => c.subjects[subjectId]?.scoreMedian ?? null)} fmt={pct} good />
      </div>
      <div style={GRID2}>
        <ChartCard title={`Cut-scores — ${subject.short}`} cycles={`How the cut-scores moved · ${cyclesCaption}`}
          note="Each marker is a raw-score threshold between performance levels. Hollow = earlier sitting, magenta = newest."
          legend={cyclesMeta.map((c, i) => ({ c: cycleColor(i, cyclesMeta.length), label: c.name, ring: i !== cyclesMeta.length - 1 }))}>
          <CutScores cuts={cutRows} cycles={cyclesMeta} scoreMax={scoreMax} />
        </ChartCard>
        <ChartCard title={`Performance-level distribution — ${subject.short}`} cycles={`Share of candidates in each performance level · ${cyclesCaption}`}
          note="Each column is scaled to 100% of its cohort so the mix is comparable even as the number of candidates changes.">
          <PerfLevels levels={model.performanceLevels} cycles={cyclesMeta} counts={perfCounts} />
        </ChartCard>
      </div>

      {/* ── Question statistics ── */}
      <SectionHead title="Question statistics" sub="How this subject's items behaved between the sittings." />
      <div className="hf-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "stretch" }}>
        <KpiTile label="Difficulty (p-value)" cycles={cyclesMeta} values={model.cycles.map((c) => c.subjects[subjectId]?.avgPValue ?? null)} fmt={f2} good={null} info={PVALUE_INFO} />
        <KpiTile label="Discrimination (point-biserial)" cycles={cyclesMeta} values={model.cycles.map((c) => c.subjects[subjectId]?.avgPointBiserial ?? null)} fmt={f2} good info={PB_INFO} />
        <KpiTile label="Reliability (α)" cycles={cyclesMeta} values={model.cycles.map((c) => c.subjects[subjectId]?.alpha ?? null)} fmt={f2} good info={ALPHA_INFO} />
      </div>

      {/* ── Usable items ── */}
      <SectionHead title="Usable items" sub="The item pool for this subject and how much was removed." />
      <ChartCard title={`Item pool — ${subject.short}`} cycles={`Items scored vs removed · ${cyclesCaption}`}
        note="Fewer items removed indicates a cleaner, more usable item pool that sitting."
        legend={[...cyclesMeta.map((c, i) => ({ c: cycleColor(i, cyclesMeta.length), label: `Usable · ${c.name}` })), { c: H.warn, label: "Removed" }]}>
        <StackedItems groups={[{ label: subject.short, usable: model.cycles.map((c) => c.subjects[subjectId]?.itemsUsable ?? null), removed: model.cycles.map((c) => c.subjects[subjectId]?.itemsRemoved ?? null) }]} cycles={cyclesMeta} max={itemMax} ticks={ticksTo(itemMax, 5)} />
      </ChartCard>
    </div>
  );
}

// ── export: xlsx workbook consistent with the other exports ──────────────────
async function exportComparison(model: CompareCyclesModel) {
  const exp = await import("@/lib/export");
  const wb = exp.buildCompareCyclesWorkbook(model);
  const buf = exp.workbookToBuffer(wb);
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `compare_cycles_${model.cycles.map((c) => c.name.replace(/\s+/g, "_").toLowerCase()).join("_vs_")}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
