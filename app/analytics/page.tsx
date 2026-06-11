"use client";

/**
 * Analytics › Trends — how each assessment has behaved across cycles. The latest
 * cycle's aggregates are REAL (computed from the provider/engine); prior cycles
 * are clearly-labelled MOCK (there is no real history yet).
 */
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { analyticsSubnav } from "@/lib/ui/subnav";
import { MockBanner, Spark, AwardStack, awardRamp } from "@/components/ui/analytics";

export default function TrendsPage() {
  const model = useProviderData((p) => p.getAnalyticsTrends());

  return (
    <Shell
      active="Analytics"
      crumb={[{ label: "Analytics" }, { label: "Trends" }]}
      subnav={analyticsSubnav("trends")}
      actions={<Button variant="ghost"><Icon name="download" />Export</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "24px 30px", gap: 18, flex: 1 }}>
        <div>
          <div className="hf-h1">Trends across cycles</div>
          <div className="hf-sub" style={{ marginTop: 6 }}>
            How each assessment has behaved over the last four sittings ({model.cycleLabels[0]} → {model.cycleLabels[model.cycleLabels.length - 1]}).
          </div>
        </div>

        {model.priorsAreMock && <MockBanner />}

        {/* KPI row */}
        <div style={{ display: "flex", gap: 16 }}>
          {model.kpis.map((k) => (
            <Card key={k.label} style={{ flex: 1, padding: "16px 18px" }}>
              <div className="hf-lbl">{k.label}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8 }}>
                <div>
                  <div className="hf-mono" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{k.value}</div>
                  <div className="hf-sub" style={{ fontSize: 11, marginTop: 5, color: k.delta.startsWith("−") ? H.bad : H.good }}>{k.delta}</div>
                </div>
                <Spark pts={k.points} w={96} h={36} />
              </div>
            </Card>
          ))}
        </div>

        <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0, alignItems: "stretch", flexWrap: "wrap" }}>
          {/* cohort mean by assessment */}
          <Card style={{ flex: "1 1 360px", minWidth: 280, padding: "18px 20px", overflow: "auto" }}>
            <div className="hf-lbl" style={{ marginBottom: 4 }}>Cohort mean by assessment</div>
            {model.byAssessment.map((m, i) => (
              <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: i < model.byAssessment.length - 1 ? `1px solid ${H.line}` : "none" }}>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{m.name}</span>
                <Spark pts={m.points} w={104} h={28} color={H.ink2} />
                <span className="hf-mono" style={{ width: 52, textAlign: "right", fontSize: 13, fontWeight: 600 }}>{m.now}</span>
                <span className="hf-mono" style={{ width: 40, textAlign: "right", fontSize: 11.5, color: m.delta.startsWith("−") ? H.bad : H.good }}>{m.delta}</span>
              </div>
            ))}
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
