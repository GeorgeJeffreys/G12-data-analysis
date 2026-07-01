"use client";

/**
 * Sitting-level "Diagnostics" tab — the single home for exploratory / reference
 * analysis, reached from the top cycle tab bar (alongside Critical Path / Audit
 * log). It is distinct from the whole-assessment "Assessment Health" step inside
 * the critical path (`/cycles/[cycleId]/diagnostics`), which carries only the
 * go/no-go whole-paper checks.
 *
 * This tab holds the demand-level (D1/D2/D3) and item-level breakdowns relocated
 * out of the critical path, ported verbatim from the analyst's two notebooks
 * (timing/performance and speededness/omission-rate):
 *   - speededness/omission/completion by difficulty tier and by item set,
 *   - the speededness index broken into its early-vs-late omission & accuracy parts,
 *   - timing↔performance (median item time ↔ score %) by difficulty tier,
 *   - omission rate by item position.
 * Every measure keys on P-A's stable participant id over the corrected matrix (the
 * same cohort the item stats use), so counts match the scores. The whole-assessment
 * speededness + timing go/no-go check stays on the critical path's "Assessment
 * Health" step. INFORMATIONAL ONLY — nothing here changes a grade.
 */
import { useState } from "react";
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { AssessmentTabs } from "@/components/shell/AssessmentTabs";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";
import {
  DemandLegend,
  DiagStatusBadge,
  EarlyLateRow,
  Hc,
  HelpNote,
  OmissionByPosition,
  SectionHead,
  SpeededRow,
  TimingRow,
  demandLabel,
} from "@/components/ui/diagnostics-parts";
import type { DiagnosticsModel } from "@/lib/data/types";
import type { DiagStatus } from "@/lib/diagnostics";

export default function DiagnosticsHubPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const model = useProviderData((p) => p.getDiagnostics(cycleId), [cycleId]) as DiagnosticsModel | null;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";
  const [active, setActive] = useState(0);
  const { zoom, setZoom, scrollRef, zoomWrapStyle } = useTableZoom();

  if (!model || model.assessments.length === 0) {
    return (
      <CycleShell cycleId={cycleId} cycleName={cycleName} page="Diagnostics" area="diagnostics">
        <div style={{ padding: 32 }} className="hf-sub">No diagnostics data for this sitting yet.</div>
      </CycleShell>
    );
  }
  const a = model.assessments[Math.min(active, model.assessments.length - 1)]!;

  return (
    <CycleShell cycleId={cycleId} cycleName={cycleName} page="Diagnostics" area="diagnostics">
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="hf-pad" style={{ padding: "22px 28px 0" }}>
          <div style={{ display: "flex", gap: 11, alignItems: "center", flexWrap: "wrap" }}>
            <div className="hf-h1">Diagnostics</div>
          </div>
          <div className="hf-sub" style={{ marginTop: 7, maxWidth: 720 }}>
            Reference breakdowns by difficulty tier (D1/D2/D3) and item, for exploring where time pressure concentrates.
            The whole-assessment go/no-go check lives on the{" "}
            <Link href={`/cycles/${cycleId}/diagnostics`} style={{ color: H.pink, fontWeight: 600 }}>Assessment Health</Link>{" "}
            step in the critical path.
          </div>
        </div>

        {/* assessment selector — shared canonical chip-tab row; zoom on the right */}
        <AssessmentTabs
          activeId={String(active)}
          tabs={model.assessments.map((as, i) => ({ id: String(i), label: as.shortName }))}
          onSelect={(id) => setActive(Number(id))}
          right={<ZoomControl zoom={zoom} onZoom={setZoom} />}
        />

        <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "20px 28px 40px" }}>
          <div style={zoomWrapStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* A — speededness / omission / completion by demand level + item set */}
          <div className="hf-card" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${H.line2}`, gap: 12 }}>
              <div style={{ flex: 1 }}>
                <span className="hf-h2">Speededness by demand level &amp; item set</span>
                <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>Where time pressure concentrates — by item difficulty, then by shared-stimulus item set.</div>
              </div>
              <span style={{ display: "flex", gap: 10 }}>{(["Good", "Review", "Flag"] as DiagStatus[]).map((s) => <DiagStatusBadge key={s} s={s} />)}</span>
            </div>
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                <thead>
                  <tr>
                    <th className="hf-th">Level</th>
                    <Hc t="Speededness index" sub="0–1, lower is better" />
                    <Hc t="Omission rate" sub="% left blank" />
                    <Hc t="Completion rate" sub="% reaching the end" />
                    <th className="hf-th" style={{ textAlign: "right" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {a.byDemand.length > 0 && <SectionHead cols={5}>By demand level (item difficulty)</SectionHead>}
                  {a.byDemand.map((d) => (
                    <SpeededRow key={d.demand} label={demandLabel[d.demand] ?? d.demand} s={d.speeded} demand={d.demand} />
                  ))}
                  {a.byItemSet.length > 0 && <SectionHead cols={5}>By item set (shared stimulus / passage)</SectionHead>}
                  {a.byItemSet.map((it) => (
                    <SpeededRow key={it.itemSet} label={it.itemSet} s={it.speeded} />
                  ))}
                  {a.byDemand.length === 0 && a.byItemSet.length === 0 && (
                    <tr><td colSpan={5} className="hf-sub" style={{ padding: "16px 18px" }}>No demand-level or item-set breakdown for this assessment.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <HelpNote
              title="How to read this"
              body={
                <>
                  If the <b>D3 (top-difficulty)</b> row omits far more than D1/D2, the hardest items are eating the clock —
                  consider trimming their count, simplifying their wording, or moving them earlier so students reach them.
                  A single <b>item set</b> (shared stimulus/passage) with a much higher rate points at that passage being
                  too long or dense to work through in time — shorten or simplify it.
                </>
              }
            />
          </div>

          {/* A2 — early vs late (the speededness index's two components, per group) */}
          <div className="hf-card" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${H.line2}`, gap: 12 }}>
              <div style={{ flex: 1 }}>
                <span className="hf-h2">Early vs late — omission &amp; accuracy</span>
                <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>The speededness index made explicit: how omission and accuracy shift from the early items to the final quarter.</div>
              </div>
            </div>
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                <thead>
                  <tr>
                    <th className="hf-th">Level</th>
                    <Hc t="Early omission" sub="% blank, early items" />
                    <Hc t="Late omission" sub="% blank, final quarter" />
                    <Hc t="Early accuracy" sub="correct ÷ answered" />
                    <Hc t="Late accuracy" sub="final quarter" />
                  </tr>
                </thead>
                <tbody>
                  {a.byDemand.length > 0 && <SectionHead cols={5}>By demand level (item difficulty)</SectionHead>}
                  {a.byDemand.map((d) => (
                    <EarlyLateRow key={d.demand} label={demandLabel[d.demand] ?? d.demand} s={d.speeded} demand={d.demand} />
                  ))}
                  {a.byItemSet.length > 0 && <SectionHead cols={5}>By item set (shared stimulus / passage)</SectionHead>}
                  {a.byItemSet.map((it) => (
                    <EarlyLateRow key={it.itemSet} label={it.itemSet} s={it.speeded} />
                  ))}
                  {a.byDemand.length === 0 && a.byItemSet.length === 0 && (
                    <tr><td colSpan={5} className="hf-sub" style={{ padding: "16px 18px" }}>No demand-level or item-set breakdown for this assessment.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <HelpNote
              title="How to read this"
              body={
                <>
                  A row where <b>late omission</b> jumps above early, or <b>late accuracy</b> falls below early, is the
                  speededness signature for that group — students ran short of time on its later items. Flat rows mean the
                  time was adequate. Late figures that worsen are highlighted.
                </>
              }
            />
          </div>

          {/* A3 — timing vs performance by demand level (the timing notebook, per tier) */}
          <div className="hf-card" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${H.line2}`, gap: 12 }}>
              <div style={{ flex: 1 }}>
                <span className="hf-h2">Timing &amp; performance by demand level</span>
                <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>Whether time-on-task relates to score, split by item difficulty. The whole-assessment figure is on Assessment Health.</div>
              </div>
              <span className="hf-sub" style={{ fontSize: 11 }}>correlation of median item time ↔ score %</span>
            </div>
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                <thead>
                  <tr>
                    <th className="hf-th">Level</th>
                    <Hc t="Students" sub="with timing" />
                    <Hc t="Time ↔ score" sub="Pearson r" />
                    <Hc t="Spearman" sub="rank ρ" />
                    <th className="hf-th">Strength</th>
                  </tr>
                </thead>
                <tbody>
                  {a.timingByDemand.length > 0 ? (
                    a.timingByDemand.map((d) => (
                      <TimingRow key={d.demand} label={demandLabel[d.demand] ?? d.demand} t={d.timing} demand={d.demand} />
                    ))
                  ) : (
                    <tr><td colSpan={5} className="hf-sub" style={{ padding: "16px 18px" }}>No demand-tagged timing for this assessment.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <HelpNote
              title="How to read this"
              body={
                <>
                  A stronger <b>negative</b> correlation on a tier means slower responses there tended to score lower —
                  usually a sign those items were demanding, not a data fault. A positive correlation means the students who
                  spent longer scored better. Undefined (—) when too few students on that tier have timing. Informational only.
                </>
              }
            />
          </div>

          {/* B — omission rate by item position (coloured by demand level) */}
          <div className="hf-card" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${H.line2}`, gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <span className="hf-h2">Omission rate by item position</span>
                <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>Each bar is one item in presented order. A rising tail means students ran out of time before the end.</div>
              </div>
              <DemandLegend demands={[...new Set(a.omissionByPosition.map((p) => p.demandLevel).filter(Boolean) as string[])]} />
            </div>
            <OmissionByPosition points={a.omissionByPosition} />
            <HelpNote
              title="How to read this"
              body={
                <>
                  Bar height is the percentage of students who left that item blank; the colour is its demand level.
                  Scattered low bars are normal. A <b>climb toward the right-hand (late) items</b> is the classic
                  speededness signature — students are running out of time. The fix is on the paper, not the student:
                  shorten it, rebalance where the demanding items sit, or check for a late item that’s unexpectedly hard.
                </>
              }
            />
          </div>
          </div>
          </div>
        </div>
      </div>
    </CycleShell>
  );
}
