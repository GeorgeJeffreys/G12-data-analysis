"use client";

/**
 * Cycle diagnostics — speededness / omission / completion and timing–performance,
 * at assessment and major-element level. INFORMATIONAL ONLY: these are computed
 * from the raw QM export (response-time + answer columns) and never affect
 * grading. They reproduce the team's Speededness and Timing workbook definitions.
 */
import { useState } from "react";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { cyclesSubnav } from "@/lib/ui/subnav";
import type { DiagnosticsModel, DiagnosticsAssessment, DiagnosticsGroup } from "@/lib/data/types";
import type { DiagStatus } from "@/lib/diagnostics";

const statusColor = (s: DiagStatus) => (s === "Good" ? H.good : s === "Review" ? H.warn : H.bad);
const statusBg = (s: DiagStatus) => (s === "Good" ? H.goodSoft : s === "Review" ? H.warnSoft : H.badSoft);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function DiagnosticsPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const model = useProviderData((p) => p.getDiagnostics(cycleId), [cycleId]) as DiagnosticsModel | null;
  const [active, setActive] = useState(0);

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
          <div className="hf-h1">Timing &amp; speededness diagnostics</div>
          <div className="hf-sub" style={{ marginTop: 7, maxWidth: 680 }}>
            Computed from the raw export’s response-time and answer columns — <b style={{ color: H.ink }}>informational
            only</b>, never part of grading. Speededness flags whether students were running out of time; timing–performance
            relates time-on-task to score.
          </div>
        </div>

        {/* assessment tabs */}
        <div className="hf-pad" style={{ display: "flex", gap: 4, padding: "14px 28px 0", borderBottom: `1px solid ${H.line}`, overflowX: "auto" }}>
          {model.assessments.map((as, i) => (
            <button
              key={as.assessmentId}
              onClick={() => setActive(i)}
              style={{ padding: "9px 14px", fontSize: 13, fontWeight: i === active ? 700 : 500, color: i === active ? H.pink : H.ink2, borderBottom: `3px solid ${i === active ? H.pink : "transparent"}`, background: "transparent", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {as.shortName}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "20px 28px", display: "flex", flexDirection: "column", gap: 22 }}>
          <Section title="Speededness · omission · completion" sub="By assessment, then by major element. Late items = the final 25% of questions by presented order.">
            <SpeededTable a={a} />
          </Section>
          <Section title="Timing–performance" sub="Correlation between each student's median item time and their score %, at assessment and element level.">
            <TimingTable a={a} />
          </Section>
        </div>
      </div>
    </Shell>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="hf-h2">{title}</div>
      <div className="hf-sub" style={{ fontSize: 12, marginTop: 3, marginBottom: 12 }}>{sub}</div>
      <div className="hf-card" style={{ overflow: "auto" }}>{children}</div>
    </div>
  );
}

function Pill({ s, children }: { s: DiagStatus; children: React.ReactNode }) {
  return (
    <span className="hf-mono" style={{ fontSize: 11.5, fontWeight: 700, color: statusColor(s), background: statusBg(s), padding: "2px 8px", borderRadius: 999 }}>
      {children}
    </span>
  );
}

function rowLabel(g: DiagnosticsGroup): string {
  return g.key === "Overall" ? "Overall" : g.key;
}

function SpeededTable({ a }: { a: DiagnosticsAssessment }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
      <thead>
        <tr>
          <th className="hf-th">Group</th>
          <th className="hf-th" style={{ textAlign: "right" }}>Items</th>
          <th className="hf-th" style={{ textAlign: "right" }}>Omission</th>
          <th className="hf-th" style={{ textAlign: "right" }}>Completion</th>
          <th className="hf-th" style={{ textAlign: "right" }}>Speededness</th>
          <th className="hf-th" style={{ textAlign: "right" }}>Late−early omission</th>
          <th className="hf-th" style={{ textAlign: "right" }}>Early−late accuracy</th>
        </tr>
      </thead>
      <tbody>
        {a.groups.map((g) => {
          const s = g.speeded;
          const first = g.key === "Overall";
          return (
            <tr key={g.key} style={{ background: first ? H.tint : "transparent" }}>
              <td className="hf-td" style={{ fontWeight: first ? 700 : 500, fontSize: 12.5 }}>{rowLabel(g)}</td>
              <td className="hf-td hf-mono" style={{ textAlign: "right" }}>{s.nItems}</td>
              <td className="hf-td" style={{ textAlign: "right" }}><Pill s={s.omissionStatus}>{pct(s.omissionRate)}</Pill></td>
              <td className="hf-td" style={{ textAlign: "right" }}><Pill s={s.completionStatus}>{pct(s.completion)}</Pill></td>
              <td className="hf-td" style={{ textAlign: "right" }}><Pill s={s.speededStatus}>{s.speedednessIndex.toFixed(3)}</Pill></td>
              <td className="hf-td hf-mono" style={{ textAlign: "right", color: H.ink2 }}>{pct(Math.max(0, s.lateOmission - s.earlyOmission))}</td>
              <td className="hf-td hf-mono" style={{ textAlign: "right", color: H.ink2 }}>{pct(Math.max(0, s.earlyAccuracy - s.lateAccuracy))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TimingTable({ a }: { a: DiagnosticsAssessment }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
      <thead>
        <tr>
          <th className="hf-th">Group</th>
          <th className="hf-th" style={{ textAlign: "right" }}>Students</th>
          <th className="hf-th" style={{ textAlign: "right" }}>Pearson r</th>
          <th className="hf-th" style={{ textAlign: "right" }}>Spearman ρ</th>
          <th className="hf-th">Strength</th>
        </tr>
      </thead>
      <tbody>
        {a.groups.map((g) => {
          const t = g.timing;
          const first = g.key === "Overall";
          return (
            <tr key={g.key} style={{ background: first ? H.tint : "transparent" }}>
              <td className="hf-td" style={{ fontWeight: first ? 700 : 500, fontSize: 12.5 }}>{rowLabel(g)}</td>
              <td className="hf-td hf-mono" style={{ textAlign: "right" }}>{t.nStudents}</td>
              <td className="hf-td hf-mono" style={{ textAlign: "right" }}>{t.pearson === null ? "—" : t.pearson.toFixed(3)}</td>
              <td className="hf-td hf-mono" style={{ textAlign: "right" }}>{t.spearman === null ? "—" : t.spearman.toFixed(3)}</td>
              <td className="hf-td" style={{ fontSize: 12, color: H.ink2 }}>{t.pearsonStrength}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
