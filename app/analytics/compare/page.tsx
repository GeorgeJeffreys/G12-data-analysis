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
import { MockBanner, AwardCompareChart } from "@/components/ui/analytics";

function numeric(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function ComparePage() {
  const model = useProviderData((p) => p.getAnalyticsCompare());
  const [live, prior] = model.columns;

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

        <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0, alignItems: "stretch", flexWrap: "wrap" }}>
          {/* metrics table */}
          <Card style={{ flex: "1 1 420px", minWidth: 300, overflow: "auto" }}>
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

          {/* award mix for the TWO selected cycles — distinct from Trends' over-time view */}
          <Card style={{ flex: "1 1 320px", minWidth: 280, padding: "18px 20px" }}>
            <div className="hf-lbl" style={{ marginBottom: 2 }}>Award mix: {live?.cycle} vs {prior?.cycle}</div>
            <div className="hf-sub" style={{ fontSize: 11, marginBottom: 14 }}>% of cohort in each award level, this cycle vs the prior sitting</div>
            {live && prior && (
              <AwardCompareChart
                levels={model.awardLevels}
                primary={{ name: live.cycle, dist: live.dist }}
                secondary={{ name: `${prior.cycle} (mock)`, dist: prior.dist }}
              />
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
