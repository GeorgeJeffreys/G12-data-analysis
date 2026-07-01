"use client";

/**
 * Sitting-level "Diagnostics" tab — the single home for exploratory / reference
 * analysis, reached from the top cycle tab bar (alongside Critical Path / Audit
 * log). It is distinct from the whole-assessment "Assessment Health" step inside
 * the critical path (`/cycles/[cycleId]/diagnostics`), which carries only the
 * go/no-go whole-paper checks.
 *
 * This tab holds the demand-level (D1/D2/D3) and item-level breakdowns relocated
 * out of the critical path: speededness/omission/completion by difficulty tier
 * and by item set, plus omission rate by item position. Its fuller analytical
 * content (timing/performance and speededness/omission ported from the analyst's
 * notebooks) follows in a later build; this establishes the home and moves the
 * demand-level breakdown into it. INFORMATIONAL ONLY — nothing here changes a grade.
 */
import { useState } from "react";
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { AssessmentTabs } from "@/components/shell/AssessmentTabs";
import { Badge } from "@/components/ui/primitives";
import { Mark } from "@/components/ui/icons";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";
import {
  DemandLegend,
  DiagStatusBadge,
  Hc,
  HelpNote,
  OmissionByPosition,
  SectionHead,
  SpeededRow,
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
            <Badge tone="neutral"><Mark kind="warn" size={11} />Exploratory · not a grading step</Badge>
          </div>
          <div className="hf-sub" style={{ marginTop: 7, maxWidth: 720 }}>
            Reference breakdowns by difficulty tier (D1/D2/D3) and item, for exploring where time pressure concentrates.
            The whole-assessment go/no-go check lives on the{" "}
            <Link href={`/cycles/${cycleId}/diagnostics`} style={{ color: H.pink, fontWeight: 600 }}>Assessment Health</Link>{" "}
            step in the critical path. Informational only — nothing here changes a student’s mark or grade.
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
