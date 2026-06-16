"use client";

/**
 * Analytics › Trends — how each assessment has behaved across cycles. The latest
 * cycle's aggregates are REAL (computed from the provider/engine); prior cycles
 * are clearly-labelled MOCK (there is no real history yet).
 */
import { useState } from "react";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { analyticsSubnav } from "@/lib/ui/subnav";
import { MockBanner, Spark, AwardStack, awardRamp } from "@/components/ui/analytics";
import type { KpiFormat } from "@/lib/data/types";

const round1 = (n: number) => Math.round(n * 10) / 10;
function fmtKpi(v: number, f: KpiFormat): string {
  if (f === "pct") return `${round1(v)}%`;
  if (f === "intComma") return Math.round(v).toLocaleString();
  return String(Math.round(v));
}
/** Signed delta vs the previous cycle, naming it explicitly. */
function deltaVs(cur: number, prevVal: number | undefined, prevName: string | undefined) {
  if (prevVal === undefined || prevName === undefined) return { text: "first sitting on record", color: H.ink3 };
  const d = round1(cur - prevVal);
  return { text: `${d >= 0 ? "+" : "−"}${Math.abs(d)} vs ${prevName}`, color: d < 0 ? H.bad : d > 0 ? H.good : H.ink2 };
}

export default function TrendsPage() {
  const model = useProviderData((p) => p.getAnalyticsTrends());
  const [sel, setSel] = useState(model.currentIndex);

  const currentName = model.cycleNames[sel] ?? model.cycleLabels[sel] ?? "";
  const prevName = sel > 0 ? model.cycleNames[sel - 1] : undefined;
  const isCurrent = sel === model.currentIndex;

  return (
    <Shell
      active="Analytics"
      crumb={[{ label: "Analytics" }, { label: "Trends" }]}
      subnav={analyticsSubnav("trends")}
      actions={<Button variant="ghost"><Icon name="download" />Export</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "24px 30px", gap: 18, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="hf-h1">Trends across cycles</div>
            <div className="hf-sub" style={{ marginTop: 6 }}>
              How each assessment has behaved over the last {model.cycleNames.length} sittings ({model.cycleNames[0]} → {model.cycleNames[model.cycleNames.length - 1]}).
            </div>
          </div>
          {/* cycle selector: which cycle the figures below describe */}
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="hf-lbl">Showing</span>
            <span className="hf-chip on" style={{ padding: 0, overflow: "hidden" }}>
              <select
                value={sel}
                onChange={(e) => setSel(Number(e.target.value))}
                aria-label="Cycle to show trends for"
                style={{ border: "none", background: "transparent", font: "inherit", color: "inherit", padding: "5px 11px", cursor: "pointer", outline: "none", fontWeight: 700 }}
              >
                {model.cycleNames.map((name, i) => (
                  <option key={name + i} value={i}>
                    {name}{i === model.currentIndex ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>

        {/* which cycle, and what it's compared against */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: H.ink2, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: H.ink }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: isCurrent ? H.pink : H.ink3 }} />
            {currentName}
          </span>
          <span style={{ fontSize: 8.5, color: isCurrent ? H.good : H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 6px", letterSpacing: 0.4 }}>
            {isCurrent ? "CURRENT / LIVE" : "MOCK PRIOR"}
          </span>
          <span style={{ color: H.ink3 }}>·</span>
          <span>{prevName ? <>compared against <b style={{ color: H.ink }}>{prevName}</b></> : "first sitting on record — no prior to compare"}</span>
        </div>

        {model.priorsAreMock && <MockBanner />}

        {/* KPI row — values + deltas reflect the selected cycle */}
        <div style={{ display: "flex", gap: 16 }}>
          {model.kpis.map((k) => {
            const cur = k.points[sel] ?? 0;
            const d = deltaVs(cur, sel > 0 ? k.points[sel - 1] : undefined, prevName);
            return (
              <Card key={k.label} style={{ flex: 1, padding: "16px 18px" }}>
                <div className="hf-lbl">{k.label}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8 }}>
                  <div>
                    <div className="hf-mono" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{fmtKpi(cur, k.format)}</div>
                    <div className="hf-sub" style={{ fontSize: 11, marginTop: 5, color: d.color }}>{d.text}</div>
                  </div>
                  <Spark pts={k.points} w={96} h={36} highlight={sel} />
                </div>
              </Card>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0, alignItems: "stretch", flexWrap: "wrap" }}>
          {/* cohort mean by assessment */}
          <Card style={{ flex: "1 1 360px", minWidth: 280, padding: "18px 20px", overflow: "auto" }}>
            <div className="hf-lbl" style={{ marginBottom: 4 }}>Cohort mean by assessment</div>
            <div className="hf-sub" style={{ fontSize: 11, marginBottom: 4 }}>% for {currentName}{prevName ? `, change vs ${prevName}` : ""}</div>
            {model.byAssessment.map((m, i) => {
              const cur = m.points[sel] ?? 0;
              const prev = sel > 0 ? m.points[sel - 1] : undefined;
              const dv = prev === undefined ? null : round1(cur - prev);
              return (
                <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: i < model.byAssessment.length - 1 ? `1px solid ${H.line}` : "none" }}>
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{m.name}</span>
                  <Spark pts={m.points} w={104} h={28} color={H.ink2} highlight={sel} />
                  <span className="hf-mono" style={{ width: 52, textAlign: "right", fontSize: 13, fontWeight: 600 }}>{round1(cur)}%</span>
                  <span className="hf-mono" style={{ width: 44, textAlign: "right", fontSize: 11.5, color: dv === null ? H.ink3 : dv < 0 ? H.bad : H.good }}>
                    {dv === null ? "—" : `${dv >= 0 ? "+" : "−"}${Math.abs(dv)}`}
                  </span>
                </div>
              );
            })}
          </Card>

          {/* award distribution over time */}
          <Card style={{ flex: "1 1 340px", minWidth: 280, padding: "18px 20px" }}>
            <div className="hf-lbl" style={{ marginBottom: 4 }}>Award distribution over time</div>
            <div className="hf-sub" style={{ fontSize: 11, marginBottom: 16 }}>% of cohort in each award level</div>
            <div style={{ display: "flex", justifyContent: "space-around", alignItems: "flex-end", height: 168 }}>
              {model.awardOverTime.map((d) => (
                <div key={d.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <AwardStack dist={d.dist} levels={model.awardLevels} h={150} w={34} />
                  <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink2 }}>{d.label}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 14 }}>
              {model.awardLevels.map((g, i) => (
                <span key={g} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: H.ink2 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: awardRamp(i, model.awardLevels.length) }} />
                  {g.replace(/ (award|achievement award)$/i, "")}
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
