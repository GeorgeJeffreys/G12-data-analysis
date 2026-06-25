"use client";

/**
 * Cycle diagnostics — actionable read-side measures, computed from the raw QM
 * export (response-time + answer columns). INFORMATIONAL ONLY: they never affect
 * grading. Three lenses are shown, all chosen because something can be done about
 * them for the next sitting:
 *   - whole-assessment speededness / omission / completion (was it timed right?),
 *   - the same split by demand level D1/D2/D3 (are the hard items the ones being
 *     left blank?) — the demand-level lens replaces the old, non-actionable
 *     construct/element breakdown,
 *   - omission rate by item position (are students running out of time at the
 *     end?),
 *   - whole-assessment timing vs performance, and Cronbach's α.
 * Plain-language interpretation sits next to each figure.
 */
import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { AssessmentTabs } from "@/components/shell/AssessmentTabs";
import { Badge, Button } from "@/components/ui/primitives";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { downloadCsv, downloadWorkbook, fileStem } from "@/lib/ui/export";
import { Icon, Mark } from "@/components/ui/icons";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";
import { ReliabilityPanel } from "@/components/ui/reliability";
import type { DiagnosticsModel, ReliabilityModel } from "@/lib/data/types";
import type { DiagStatus, PositionOmission, SpeededResult } from "@/lib/diagnostics";

const statusColor = (s: DiagStatus) => (s === "Good" ? H.good : s === "Review" ? H.warn : H.bad);
const statusBg = (s: DiagStatus) => (s === "Good" ? H.goodSoft : s === "Review" ? H.warnSoft : H.badSoft);

/** Demand-level palette (difficulty axis, not a quality status). */
const DEMAND_COLOR: Record<string, string> = { D1: "#5B8DEF", D2: "#E8A13A", D3: "#D9534F" };
const demandColor = (d: string | null) => (d && DEMAND_COLOR[d]) || H.ink3;
const demandLabel: Record<string, string> = { D1: "D1 · foundational", D2: "D2 · intermediate", D3: "D3 · top-difficulty" };

export default function DiagnosticsPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const model = useProviderData((p) => p.getDiagnostics(cycleId), [cycleId]) as DiagnosticsModel | null;
  const reliability = useProviderData((p) => p.getReliability(cycleId), [cycleId]) as ReliabilityModel | null;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";
  const [active, setActive] = useState(0);
  const { zoom, setZoom, scrollRef, zoomWrapStyle } = useTableZoom();

  if (!model || model.assessments.length === 0) {
    return (
      <CycleShell cycleId={cycleId} cycleName={cycleName} page="Diagnostics" stageIndex={4}>
        <div style={{ padding: 32 }} className="hf-sub">No diagnostics for this sitting.</div>
      </CycleShell>
    );
  }
  const a = model.assessments[Math.min(active, model.assessments.length - 1)]!;

  // CSV = the reliability table (α with item k + participant n alongside);
  // XLSX = Reliability + Speededness + Omission-by-position + Timing sheets.
  const exportCsv = () => {
    if (!reliability) return;
    const headers = ["Level", "Group", "Subject", "Items (k)", "Participants (n)", "Cronbach's Alpha", "Low items?", "Small sample?", "Note"];
    const levelLabel: Record<string, string> = { overall: "Overall exam", subject: "Subject", majorElement: "Major element", subElement: "Sub-element" };
    const rows = reliability.rows.map((r) => [levelLabel[r.level] ?? r.level, r.label, r.assessmentName ?? "", r.k, r.n, r.alpha ?? "n/a", r.lowItems ? "Yes" : "", r.smallSample ? "Yes" : "", r.note ?? ""]);
    downloadCsv(`${fileStem("reliability", cycleName)}.csv`, headers, rows);
    provider.recordExport(cycleId, "Reliability (CSV)");
  };
  const exportXlsx = async () => {
    const exp = await import("@/lib/export");
    const wb = exp.buildDiagnosticsWorkbook({ cycleName, reliability, diagnostics: model });
    await downloadWorkbook(`${fileStem("diagnostics", cycleName)}.xlsx`, wb);
    provider.recordExport(cycleId, "Diagnostics & reliability (Excel)");
  };

  const whole = a.whole.speeded;
  const wholeTiming = a.whole.timing;

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Diagnostics"
      stageIndex={4}
      actions={<ExportButtons onCsv={exportCsv} onXlsx={exportXlsx} disabled={!reliability} title={reliability ? undefined : "No reliability data"} />}
      primary={
        <Link href={`/cycles/${cycleId}/essays`}>
          <Button variant="pri" title="Continue to essay marks">Continue<Icon name="arrow" color="#fff" /></Button>
        </Link>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="hf-pad" style={{ padding: "22px 28px 0" }}>
          <div style={{ display: "flex", gap: 11, alignItems: "center", flexWrap: "wrap" }}>
            <div className="hf-h1">Diagnostics</div>
            <Badge tone="neutral"><Mark kind="warn" size={11} />Review only · not a grading step</Badge>
          </div>
          <div className="hf-sub" style={{ marginTop: 7, maxWidth: 720 }}>
            Exam-quality measures the app computes from raw response-time data. Each one points to something you can
            act on for the next sitting — they never change a student’s mark or grade.
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
          {/* A — speededness / omission / completion: whole assessment + demand level */}
          <div className="hf-card" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${H.line2}`, gap: 12 }}>
              <div style={{ flex: 1 }}>
                <span className="hf-h2">Speededness, omission &amp; completion</span>
                <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>Whether students had enough time to attempt the questions — for the whole paper, then by item difficulty.</div>
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
                  <SpeededRow label="Whole assessment" s={whole} whole />
                  {a.byDemand.length > 0 && <SectionHead cols={5}>By demand level (item difficulty)</SectionHead>}
                  {a.byDemand.map((d) => (
                    <SpeededRow key={d.demand} label={demandLabel[d.demand] ?? d.demand} s={d.speeded} demand={d.demand} />
                  ))}
                  {a.byItemSet.length > 0 && <SectionHead cols={5}>By item set (shared stimulus / passage)</SectionHead>}
                  {a.byItemSet.map((it) => (
                    <SpeededRow key={it.itemSet} label={it.itemSet} s={it.speeded} />
                  ))}
                </tbody>
              </table>
            </div>
            <HelpNote
              title="How to read this"
              body={
                <>
                  <b>Speededness index</b> (0–1) combines two end-of-paper warning signs: more blanks late than early, and a
                  late accuracy drop. <b>≤0.05</b> is fine; <b>0.05–0.15</b> worth a look; <b>&gt;0.15</b> flags time pressure.
                  <b> Omission rate</b> is the share of presented questions left blank; <b>completion</b> is its mirror.
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

          {/* C — timing / performance (whole assessment only) */}
          <div className="hf-card" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${H.line2}`, gap: 12 }}>
              <div style={{ flex: 1 }}>
                <span className="hf-h2">Timing &amp; performance</span>
                <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>Whether time spent relates to how well students scored.</div>
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
                  <tr style={{ background: H.canvas }}>
                    <td className="hf-td" style={{ fontWeight: 700, fontSize: 12.5, paddingLeft: 12 }}>Whole assessment</td>
                    <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13 }}>{wholeTiming.nStudents}</td>
                    <td className="hf-td" style={{ textAlign: "right" }}>{wholeTiming.pearson === null ? <span className="hf-sub hf-mono">—</span> : <CorrMeter r={wholeTiming.pearson} />}</td>
                    <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13 }}>{wholeTiming.spearman === null ? "—" : wholeTiming.spearman.toFixed(2)}</td>
                    <td className="hf-td" style={{ fontSize: 11.5, color: H.ink2, fontWeight: 600 }}>{wholeTiming.pearsonStrength}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", padding: "12px 18px", gap: 9, alignItems: "center", background: H.canvas, borderTop: `1px solid ${H.line}` }}>
              <Mark kind="warn" size={13} />
              <span className="hf-sub" style={{ fontSize: 11.5 }}>
                A stronger negative correlation means slower responses tended to score lower — usually a sign the paper
                was demanding, not a data fault. Informational only; nothing here changes a grade.
              </span>
            </div>
          </div>

          {/* D — internal consistency (Cronbach's α) for this subject */}
          {reliability && <ReliabilityPanel model={reliability} assessmentId={a.assessmentId} />}
          </div>
          </div>
        </div>
      </div>
    </CycleShell>
  );
}

type Tone = "good" | "warn" | "bad";

/** One speededness row — whole assessment (highlighted) or a demand level. */
function SpeededRow({ label, s, whole = false, demand }: { label: string; s: SpeededResult; whole?: boolean; demand?: string }) {
  const omTone: Tone = s.omissionStatus === "Flag" ? "bad" : s.omissionStatus === "Review" ? "warn" : "good";
  const compTone: Tone = s.completionStatus === "Flag" ? "bad" : s.completionStatus === "Review" ? "warn" : "good";
  return (
    <tr style={{ background: whole ? H.canvas : "transparent" }} className={whole ? "" : "hf-hover"}>
      <td className="hf-td" style={{ fontWeight: whole ? 700 : 600, fontSize: 12.5, paddingLeft: whole ? 12 : 26, maxWidth: 260, whiteSpace: "normal", lineHeight: 1.25 }}>
        {demand && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: demandColor(demand), marginRight: 7, verticalAlign: "middle" }} />}
        {label}
      </td>
      <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13 }}>{s.speedednessIndex.toFixed(2)}</td>
      <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13, color: omTone === "bad" ? H.bad : omTone === "warn" ? H.warn : H.ink }}>{(s.omissionRate * 100).toFixed(1)}%</td>
      <td className="hf-td" style={{ textAlign: "right" }}><RateBar v={s.completion * 100} tone={compTone} /></td>
      <td className="hf-td" style={{ textAlign: "right" }}><DiagStatusBadge s={s.speededStatus} /></td>
    </tr>
  );
}

function Hc({ t, sub }: { t: string; sub?: string }) {
  return (
    <th className="hf-th" style={{ textAlign: "right" }}>
      {t}
      {sub && <div style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: H.ink3, fontSize: 9 }}>{sub}</div>}
    </th>
  );
}

function SectionHead({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} style={{ padding: "8px 12px", background: H.tint, borderTop: `1px solid ${H.line2}`, borderBottom: `1px solid ${H.line2}` }}>
        <span className="hf-lbl">{children}</span>
      </td>
    </tr>
  );
}

/** Plain-language interpretation block, embedded under a figure. */
function HelpNote({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div style={{ display: "flex", padding: "12px 18px", gap: 10, alignItems: "flex-start", background: H.canvas, borderTop: `1px solid ${H.line}` }}>
      <Mark kind="warn" size={13} />
      <span className="hf-sub" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
        <span style={{ fontWeight: 700, color: H.ink2 }}>{title}. </span>
        {body}
      </span>
    </div>
  );
}

/** Legend for the demand-level colours used in the position chart. */
function DemandLegend({ demands }: { demands: string[] }) {
  const order = ["D1", "D2", "D3"].filter((d) => demands.includes(d));
  if (order.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      {order.map((d) => (
        <span key={d} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: demandColor(d) }} />
          <span className="hf-sub" style={{ fontSize: 10.5 }}>{demandLabel[d] ?? d}</span>
        </span>
      ))}
    </span>
  );
}

/** Omission rate by item position — a div bar chart, coloured by demand level. */
function OmissionByPosition({ points }: { points: PositionOmission[] }) {
  if (points.length === 0) {
    return <div style={{ padding: "20px 18px" }} className="hf-sub">No item-position data for this assessment.</div>;
  }
  const maxRate = Math.max(0.1, ...points.map((p) => p.omissionRate)); // floor the axis at 10% so tiny bars stay visible
  const axisPct = Math.ceil(maxRate * 100);
  return (
    <div style={{ padding: "16px 18px 6px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 140, borderBottom: `1px solid ${H.line2}`, position: "relative" }}>
        <span style={{ position: "absolute", top: -2, left: 0, fontSize: 9.5, color: H.ink3 }} className="hf-mono">{axisPct}%</span>
        <span style={{ position: "absolute", bottom: -1, left: 0, fontSize: 9.5, color: H.ink3 }} className="hf-mono">0%</span>
        {points.map((p) => (
          <div
            key={p.itemId}
            title={`Position ${p.position}${p.demandLevel ? ` · ${p.demandLevel}` : ""} — ${(p.omissionRate * 100).toFixed(1)}% omitted (${p.omitted}/${p.nPresentations})`}
            style={{ flex: 1, minWidth: 3, height: `${(p.omissionRate / maxRate) * 100}%`, background: demandColor(p.demandLevel), borderRadius: "2px 2px 0 0", alignSelf: "flex-end" }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
        <span className="hf-sub" style={{ fontSize: 10 }}>item 1 (start)</span>
        <span className="hf-sub" style={{ fontSize: 10 }}>item {points.length} (end)</span>
      </div>
    </div>
  );
}

function DiagStatusBadge({ s }: { s: DiagStatus }) {
  const kind = s === "Good" ? "pass" : s === "Review" ? "warn" : "fail";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: statusColor(s), background: statusBg(s), padding: "2px 8px", borderRadius: 999 }}>
      <Mark kind={kind} size={11} />
      {s}
    </span>
  );
}

/** Horizontal completion meter (0–100). */
function RateBar({ v, tone }: { v: number; tone: Tone }) {
  const c = tone === "bad" ? H.bad : tone === "warn" ? H.warn : H.good;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
      <span style={{ width: 64, height: 6, background: H.tint2, borderRadius: 5, flex: "0 0 auto" }}>
        <span style={{ display: "block", width: `${Math.max(0, Math.min(100, v))}%`, height: "100%", background: c, borderRadius: 5 }} />
      </span>
      <span className="hf-mono" style={{ fontSize: 12.5, width: 46, textAlign: "right" }}>{v.toFixed(1)}%</span>
    </span>
  );
}

/** Diverging correlation meter: a centre tick, the bar extends left (−) or right (+). */
function CorrMeter({ r }: { r: number }) {
  const a = Math.abs(r);
  const tone: Tone | "neutral" = a >= 0.4 ? "bad" : a >= 0.2 ? "warn" : "neutral";
  const c = tone === "bad" ? H.bad : tone === "warn" ? H.warn : H.bar;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
      <span style={{ width: 50, height: 6, background: H.tint2, borderRadius: 5, position: "relative", flex: "0 0 auto" }}>
        <span style={{ position: "absolute", left: "50%", top: -2, width: 1, height: 10, background: H.line2 }} />
        <span style={{ position: "absolute", [r < 0 ? "right" : "left"]: "50%", width: `${Math.min(50, a * 100)}%`, height: "100%", background: c, borderRadius: 5 } as CSSProperties} />
      </span>
      <span className="hf-mono" style={{ fontSize: 12.5, width: 40, textAlign: "right", color: tone === "bad" ? H.bad : tone === "warn" ? H.warn : H.ink }}>{r.toFixed(2)}</span>
    </span>
  );
}
