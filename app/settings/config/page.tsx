"use client";

/**
 * Settings › Configuration. Item-quality thresholds (the engine's REAL active
 * rating rules — display-only), the grade-vocabulary defaults editor, and the
 * (mock) data-retention and branding settings.
 */
import type { ReactNode } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Badge, Toggle } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { settingsSubnav } from "@/lib/ui/subnav";
import { GradingDefaultsEditor } from "@/components/settings/GradingDefaultsEditor";

export default function ConfigPage() {
  const provider = useProvider();
  const config = useProviderData((p) => p.getConfig());

  return (
    <Shell
      active="Settings"
      crumb={[{ label: "Settings" }, { label: "Configuration" }]}
      subnav={settingsSubnav("config")}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1, maxWidth: 1040 }}>
        <div>
          <div className="hf-h1">Configuration</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>Quality thresholds, grading defaults, data retention and branding for the whole workspace.</div>
        </div>

        <SectionCard title="Item-quality thresholds" sub="The bands that drive the Good / Review / Flag rating on each item statistic. These are the engine's active rules — editing them requires an engine change.">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="hf-th" style={{ paddingLeft: 0 }}>Statistic</th>
                <th className="hf-th" style={{ textAlign: "right" }}><Badge tone="good">Good</Badge></th>
                <th className="hf-th" style={{ textAlign: "right" }}><Badge tone="warn">Review</Badge></th>
                <th className="hf-th" style={{ textAlign: "right", paddingRight: 0 }}><Badge tone="bad">Flag</Badge></th>
              </tr>
            </thead>
            <tbody>
              {config.thresholds.map((t) => (
                <tr key={t.metric}>
                  <td className="hf-td" style={{ paddingLeft: 0, fontSize: 12.5, fontWeight: 600 }}>{t.metric}</td>
                  <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 11.5 }}>{t.good}</td>
                  <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 11.5, color: H.ink2 }}>{t.review}</td>
                  <td className="hf-td hf-mono" style={{ textAlign: "right", paddingRight: 0, fontSize: 11.5, color: H.bad }}>{t.flag}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        {/* grade vocabulary editor (configurable, real) */}
        <GradingDefaultsEditor />

        {/* distinction safeguard (real — drives the grading-stage safeguard) */}
        <SectionCard
          title="Distinction safeguard"
          sub="A top award is only granted when a student attempted enough of the hardest questions. These settings drive the safeguard that runs at the grading stage."
        >
          <Row label="Minimum top-difficulty questions answered">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                className="hf-input"
                style={{ width: 48 }}
                value={String(config.safeguard.distinctionThreshold)}
                inputMode="numeric"
                onChange={(e) => provider.setSafeguardConfig({ distinctionThreshold: Number(e.target.value.replace(/[^0-9]/g, "")) || 1 })}
                aria-label="Distinction safeguard threshold"
              />
              <span className="hf-sub">questions</span>
            </span>
          </Row>
          <Row label="Top-difficulty defined as" last>
            <span className={`hf-chip on`} style={{ padding: 0, overflow: "hidden" }}>
              <select
                value={config.safeguard.topDifficultyDemand}
                onChange={(e) => provider.setSafeguardConfig({ topDifficultyDemand: e.target.value })}
                aria-label="Top-difficulty demand level"
                style={{ border: "none", background: "transparent", font: "inherit", color: "inherit", padding: "4px 11px", cursor: "pointer", outline: "none" }}
              >
                {config.safeguard.demandLevels.map((d) => (
                  <option key={d} value={d}>{d}{d === config.safeguard.demandLevels[config.safeguard.demandLevels.length - 1] ? " (highest demand)" : ""}</option>
                ))}
              </select>
            </span>
          </Row>
        </SectionCard>

        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 18 }}>
            <SectionCard title="Data retention" mock>
              <Row label="Archive locked cycles after">
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    className="hf-input"
                    style={{ width: 48 }}
                    value={String(config.retention.archiveAfterYears)}
                    inputMode="numeric"
                    onChange={(e) => provider.setRetention({ archiveAfterYears: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
                  />
                  <span className="hf-sub">years</span>
                </span>
              </Row>
              <Row label="Delete raw exports after archive">
                <Toggle on={config.retention.deleteRawAfterArchive} onClick={() => provider.setRetention({ deleteRawAfterArchive: !config.retention.deleteRawAfterArchive })} />
              </Row>
              <Row label="Keep audit log indefinitely" last>
                <Toggle on={config.retention.keepAuditIndefinitely} onClick={() => provider.setRetention({ keepAuditIndefinitely: !config.retention.keepAuditIndefinitely })} />
              </Row>
            </SectionCard>
          </div>

          <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 18 }}>
            <SectionCard title="Branding" sub="Used on certificates and the sign-in screen." mock>
              <Row label="Organisation logo">
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="hf-mono hf-sub" style={{ fontSize: 11 }}>{config.branding.logoName}</span>
                  <Button style={{ fontSize: 11.5 }}><Icon name="upload" size={13} />Replace</Button>
                </span>
              </Row>
              <Row label="Accent colour">
                <span style={{ display: "flex", gap: 8 }}>
                  {[H.pink, H.slate, H.good].map((c) => {
                    const on = config.branding.accent.toLowerCase() === c.toLowerCase();
                    return (
                      <button key={c} onClick={() => provider.setBranding({ accent: c })} title={c} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: on ? `2px solid ${H.ink}` : `1px solid ${H.line2}`, outline: on ? `2px solid ${H.paper}` : "none", outlineOffset: -3, cursor: "pointer" }} />
                    );
                  })}
                </span>
              </Row>
              <Row label="Default certificate template" last>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="hf-mono hf-sub" style={{ fontSize: 11 }}>{config.branding.defaultCertificateTemplate}</span>
                  <Button variant="ghost" style={{ fontSize: 11 }}>Change</Button>
                </span>
              </Row>
            </SectionCard>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function SectionCard({ title, sub, mock, children }: { title: string; sub?: string; mock?: boolean; children: ReactNode }) {
  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="hf-h2">{title}</div>
        {mock && <span style={{ fontSize: 8.5, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 5px", letterSpacing: 0.5 }}>MOCK</span>}
      </div>
      {sub && <div className="hf-sub" style={{ fontSize: 12, marginTop: 3, marginBottom: 14 }}>{sub}</div>}
      {!sub && <div style={{ height: 14 }} />}
      {children}
    </Card>
  );
}

function Row({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: last ? "none" : `1px solid ${H.line}`, gap: 16 }}>
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
      {children}
    </div>
  );
}
