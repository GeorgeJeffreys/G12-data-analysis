"use client";

/**
 * Cycle diagnostics — speededness / omission / completion and timing–performance,
 * at assessment and major-element level. INFORMATIONAL ONLY: these are computed
 * from the raw QM export (response-time + answer columns) and never affect
 * grading. They reproduce the team's Speededness and Timing workbook definitions.
 */
import { Fragment, useState, type CSSProperties } from "react";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { AssessmentTabs } from "@/components/shell/AssessmentTabs";
import { Badge } from "@/components/ui/primitives";
import { Mark } from "@/components/ui/icons";
import { cyclesSubnav } from "@/lib/ui/subnav";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";
import type { DiagnosticsModel, DiagnosticsAssessment } from "@/lib/data/types";
import type { DiagStatus } from "@/lib/diagnostics";

const statusColor = (s: DiagStatus) => (s === "Good" ? H.good : s === "Review" ? H.warn : H.bad);
const statusBg = (s: DiagStatus) => (s === "Good" ? H.goodSoft : s === "Review" ? H.warnSoft : H.badSoft);

export default function DiagnosticsPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const model = useProviderData((p) => p.getDiagnostics(cycleId), [cycleId]) as DiagnosticsModel | null;
  const [active, setActive] = useState(0);
  const { zoom, setZoom, scrollRef, zoomWrapStyle } = useTableZoom();

  if (!model || model.assessments.length === 0) {
    return (
      <Shell active="Cycles" crumb={[{ label: "Cycles", href: "/" }, { label: "Diagnostics" }]} subnav={cyclesSubnav(cycleId, "diagnostics")}>
        <div style={{ padding: 32 }} className="hf-sub">No diagnostics for this cycle.</div>
      </Shell>
    );
  }
  const a = model.assessments[Math.min(active, model.assessments.length - 1)]!;

  return (
    <Shell
      active="Cycles"
      crumb={[{ label: "Cycles", href: "/" }, { label: "May 2026", href: `/cycles/${cycleId}` }, { label: "Diagnostics" }]}
      subnav={cyclesSubnav(cycleId, "diagnostics")}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="hf-pad" style={{ padding: "22px 28px 0" }}>
          <div style={{ display: "flex", gap: 11, alignItems: "center", flexWrap: "wrap" }}>
            <div className="hf-h1">Diagnostics</div>
            <Badge tone="neutral"><Mark kind="warn" size={11} />Review only · not a grading step</Badge>
          </div>
          <div className="hf-sub" style={{ marginTop: 7, maxWidth: 700 }}>
            Exam-quality measures the app computes from raw response-time data. Use them to spot speededness or
            weak elements for the next sitting — they never change a student’s mark or grade.
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
          {/* Family A — speededness / omission / completion */}
          <div className="hf-card" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${H.line2}`, gap: 12 }}>
              <div style={{ flex: 1 }}>
                <span className="hf-h2">Speededness, omission &amp; completion</span>
                <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>Whether students had enough time to attempt the questions.</div>
              </div>
              <span style={{ display: "flex", gap: 10 }}>{(["Good", "Review", "Flag"] as DiagStatus[]).map((s) => <DiagStatusBadge key={s} s={s} />)}</span>
            </div>
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                <thead>
                  <tr>
                    <th className="hf-th">Element</th>
                    <Hc t="Speededness index" sub="0–1, lower is better" />
                    <Hc t="Omission rate" sub="% left blank" />
                    <Hc t="Completion rate" sub="% reaching the end" />
                    <th className="hf-th" style={{ textAlign: "right" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {a.groups.map((g, i) => {
                    const s = g.speeded;
                    const whole = i === 0;
                    const omTone: Tone = s.omissionStatus === "Flag" ? "bad" : s.omissionStatus === "Review" ? "warn" : "good";
                    const compTone: Tone = s.completionStatus === "Flag" ? "bad" : s.completionStatus === "Review" ? "warn" : "good";
                    return (
                      <Fragment key={g.key}>
                        {i === 1 && <SectionHead cols={5}>Major curriculum elements</SectionHead>}
                        <tr style={{ background: whole ? H.canvas : "transparent" }} className={whole ? "" : "hf-hover"}>
                          <td className="hf-td" style={{ fontWeight: whole ? 700 : 600, fontSize: 12.5, paddingLeft: whole ? 12 : 26, maxWidth: 230, whiteSpace: "normal", lineHeight: 1.25 }}>{whole ? "Whole assessment" : g.key}</td>
                          <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13 }}>{s.speedednessIndex.toFixed(2)}</td>
                          <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13, color: omTone === "bad" ? H.bad : omTone === "warn" ? H.warn : H.ink }}>{(s.omissionRate * 100).toFixed(1)}%</td>
                          <td className="hf-td" style={{ textAlign: "right" }}><RateBar v={s.completion * 100} tone={compTone} /></td>
                          <td className="hf-td" style={{ textAlign: "right" }}><DiagStatusBadge s={s.speededStatus} /></td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Family B — timing / performance */}
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
                    <th className="hf-th">Element</th>
                    <Hc t="Students" sub="with timing" />
                    <Hc t="Time ↔ score" sub="Pearson r" />
                    <Hc t="Spearman" sub="rank ρ" />
                    <th className="hf-th">Strength</th>
                  </tr>
                </thead>
                <tbody>
                  {a.groups.map((g, i) => {
                    const t = g.timing;
                    const whole = i === 0;
                    return (
                      <Fragment key={g.key}>
                        {i === 1 && <SectionHead cols={5}>Major curriculum elements</SectionHead>}
                        <tr style={{ background: whole ? H.canvas : "transparent" }} className={whole ? "" : "hf-hover"}>
                          <td className="hf-td" style={{ fontWeight: whole ? 700 : 600, fontSize: 12.5, paddingLeft: whole ? 12 : 26, maxWidth: 230, whiteSpace: "normal", lineHeight: 1.25 }}>{whole ? "Whole assessment" : g.key}</td>
                          <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13 }}>{t.nStudents}</td>
                          <td className="hf-td" style={{ textAlign: "right" }}>{t.pearson === null ? <span className="hf-sub hf-mono">—</span> : <CorrMeter r={t.pearson} />}</td>
                          <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13 }}>{t.spearman === null ? "—" : t.spearman.toFixed(2)}</td>
                          <td className="hf-td" style={{ fontSize: 11.5, color: H.ink2, fontWeight: 600 }}>{t.pearsonStrength}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", padding: "12px 18px", gap: 9, alignItems: "center", background: H.canvas, borderTop: `1px solid ${H.line}` }}>
              <Mark kind="warn" size={13} />
              <span className="hf-sub" style={{ fontSize: 11.5 }}>
                A stronger negative correlation means slower responses tended to score lower — usually a sign the element
                was demanding, not a data fault. Informational only; nothing here changes a grade.
              </span>
            </div>
          </div>
          </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

type Tone = "good" | "warn" | "bad";

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
