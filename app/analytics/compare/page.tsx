"use client";

/**
 * Analytics › Compare cycles — two sittings side by side. The live cycle column
 * is REAL; the prior column is clearly-labelled MOCK.
 */
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Chip } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { analyticsSubnav } from "@/lib/ui/subnav";
import { MockBanner, awardRamp } from "@/components/ui/analytics";

function numeric(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function ComparePage() {
  const model = useProviderData((p) => p.getAnalyticsCompare());
  const [live, prior] = model.columns;
  const maxShare = Math.max(1, ...model.awardLevels.flatMap((g) => model.columns.map((c) => c.dist[g] ?? 0)));

  return (
    <Shell
      active="Analytics"
      crumb={[{ label: "Analytics" }, { label: "Compare cycles" }]}
      subnav={analyticsSubnav("compare")}
      actions={<Button variant="ghost"><Icon name="download" />Export comparison</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "24px 30px", gap: 18, flex: 1 }}>
        <div>
          <div className="hf-h1">Compare cycles</div>
          <div className="hf-sub" style={{ marginTop: 6 }}>Pick two or more sittings and an assessment to see them side by side.</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="hf-lbl" style={{ marginRight: 2 }}>Cycles</span>
          {model.columns.map((c) => (
            <Chip key={c.cycle} on as="span">
              {c.cycle}{c.mock ? <span style={{ fontSize: 8, marginLeft: 5, opacity: 0.8 }}>MOCK</span> : null}
            </Chip>
          ))}
          <Chip as="span"><Icon name="plus" size={12} />Add cycle</Chip>
          <span style={{ width: 1, height: 20, background: H.line2, margin: "0 4px" }} />
          <span className="hf-lbl" style={{ marginRight: 2 }}>Assessment</span>
          <Chip on as="span">Overall<Icon name="chev" /></Chip>
        </div>

        {model.priorsAreMock && <MockBanner text="The prior column is illustrative mock data — only the live cycle is computed from real results." />}

        <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0, alignItems: "stretch" }}>
          {/* metrics table */}
          <Card style={{ flex: 1, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="hf-th">Metric</th>
                  {model.columns.map((c) => (
                    <th key={c.cycle} className="hf-th" style={{ textAlign: "right" }}>
                      {c.cycle}{c.mock ? <span style={{ color: H.ink3, marginLeft: 4 }}>(mock)</span> : null}
                    </th>
                  ))}
                  <th className="hf-th" style={{ textAlign: "right", width: 70 }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {model.metrics.map((m) => {
                  const v0 = numeric(live?.metrics[m.key] ?? "0");
                  const v1 = numeric(prior?.metrics[m.key] ?? "0");
                  const delta = v0 - v1;
                  const dp = Math.abs(delta) >= 100 ? delta.toLocaleString() : delta.toFixed(1).replace(/\.0$/, "");
                  return (
                    <tr key={m.key} className="hf-hover">
                      <td className="hf-td" style={{ fontWeight: 600, fontSize: 12.5 }}>{m.label}</td>
                      {model.columns.map((c) => (
                        <td key={c.cycle} className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13 }}>{c.metrics[m.key]}</td>
                      ))}
                      <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 12, color: Math.abs(delta) < 0.05 ? H.ink3 : delta > 0 ? H.good : H.bad }}>
                        {delta > 0 ? "+" : ""}{dp}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* award distribution grouped */}
          <Card style={{ flex: "0 0 380px", padding: "18px 20px" }}>
            <div className="hf-lbl" style={{ marginBottom: 16 }}>Award distribution</div>
            <div style={{ display: "flex", justifyContent: "space-around", alignItems: "flex-end", height: 170 }}>
              {model.awardLevels.map((g, i) => (
                <div key={g} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 140 }}>
                    <div style={{ width: 16, height: `${((live?.dist[g] ?? 0) / maxShare) * 100}%`, background: awardRamp(i, model.awardLevels.length), borderRadius: "2px 2px 0 0" }} title={`${live?.cycle} ${live?.dist[g] ?? 0}%`} />
                    <div style={{ width: 16, height: `${((prior?.dist[g] ?? 0) / maxShare) * 100}%`, background: H.ink2, opacity: 0.4, borderRadius: "2px 2px 0 0" }} title={`${prior?.cycle} ${prior?.dist[g] ?? 0}%`} />
                  </div>
                  <span style={{ fontSize: 8.5, fontWeight: 700, color: H.ink2, maxWidth: 56, textAlign: "center", lineHeight: 1.05 }}>{g.replace(/ (award|achievement award)$/i, "")}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 14 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: H.ink2 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: H.pink }} />{live?.cycle}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: H.ink2 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: H.ink2, opacity: 0.4 }} />{prior?.cycle} (mock)</span>
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
