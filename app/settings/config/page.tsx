"use client";

/**
 * Settings › Configuration. Mirrors the engine's REAL configurable surface:
 *   - Item-quality thresholds (editable — drive item ratings).
 *   - Grade vocabulary + the confirmed level-pattern award rule (vocabulary
 *     editable; the rule's counts are policy-fixed, shown read-only).
 *   - The Distinction D3 safeguard (the demand level is editable; the threshold
 *     is the engine's dynamic per-exam majority, not a fixed count).
 *   - The cut-score guard-rails and target distribution (policy-fixed, display).
 *   - Reliability flags (engine constants, display).
 *   - Mock data-retention and branding settings.
 *
 * Nothing here is decorative: an editable control writes a value the engine
 * actually reads; everything the engine fixes by policy is labelled DISPLAY-ONLY.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Toggle } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { settingsSubnav } from "@/lib/ui/subnav";
import { GradingDefaultsEditor } from "@/components/settings/GradingDefaultsEditor";
import { QualityThresholdsEditor } from "@/components/settings/QualityThresholdsEditor";
import { POLICY_GUARDRAILS, POLICY_BAND_RANGES, DEFAULT_POLICY_TARGETS } from "@/lib/engine/cut-scores";
import { LOW_ITEMS_THRESHOLD, SMALL_SAMPLE_THRESHOLD } from "@/lib/engine/reliability";
import { BORDERLINE_BAND_MIN, BORDERLINE_BAND_MAX, isValidBorderlineBand } from "@/lib/data/grading";

export default function ConfigPage() {
  const provider = useProvider();
  const config = useProviderData((p) => p.getConfig());

  const topDemand = config.safeguard.topDifficultyDemand;
  const demandLevels = config.safeguard.demandLevels;

  return (
    <Shell
      active="Settings"
      crumb={[{ label: "Settings" }, { label: "Configuration" }]}
      subnav={settingsSubnav("config")}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1, maxWidth: 1040 }}>
        <div>
          <div className="hf-h1">Configuration</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>Quality thresholds, grading defaults, the award rule and its safeguards, data retention and branding for the whole workspace.</div>
        </div>

        {/* test centres now live in their own admin tab — Settings › Test centres. */}

        {/* item-quality thresholds (editable — drive the engine's item ratings) */}
        <QualityThresholdsEditor />

        {/* grade vocabulary + the level-pattern award rule (configurable + display) */}
        <GradingDefaultsEditor />

        {/* Distinction D3 safeguard — the demand level is editable; the threshold
            is the engine's DYNAMIC per-exam majority of available D3 items. */}
        <SectionCard
          title="Distinction D3 safeguard"
          sub="A Distinction is only granted when the student answered correctly a majority of the available D3 (top-difficulty) items on each exam. This drives the per-student safeguard that runs at the grading stage."
        >
          <Row label="Top-difficulty (D3) defined as">
            <span className={`hf-chip on`} style={{ padding: 0, overflow: "hidden" }}>
              <select
                value={topDemand}
                onChange={(e) => provider.setSafeguardConfig({ topDifficultyDemand: e.target.value })}
                aria-label="Top-difficulty demand level"
                style={{ border: "none", background: "transparent", font: "inherit", color: "inherit", padding: "4px 11px", cursor: "pointer", outline: "none" }}
              >
                {demandLevels.map((d) => (
                  <option key={d} value={d}>{d}{d === demandLevels[demandLevels.length - 1] ? " (highest demand)" : ""}</option>
                ))}
              </select>
            </span>
          </Row>
          <Row label="Required threshold">
            <span className="hf-sub" style={{ textAlign: "right", maxWidth: 360 }}>
              Dynamic — a <strong>majority of the available D3 items</strong> on each exam (more than half of however
              many D3 items exist, recomputed per exam after exclusions). No fixed count.
            </span>
          </Row>
          <Row label="Measured on" last>
            <span className="hf-sub" style={{ textAlign: "right", maxWidth: 360 }}>
              D3 items answered <strong>correctly</strong> (not attempted), against the items <strong>available</strong>
              {" "}(not attempted). A single exam below its majority caps the award to the next tier.
            </span>
          </Row>
        </SectionCard>

        {/* Borderline (marginal) flagging band — EDITABLE, grade-bearing. The engine
            reads this when flagging students just below a grade boundary; editing
            it re-flags through the full grade recompute (incl. the D3 safeguard). */}
        <SectionCard
          title="Borderline (marginal) flagging"
          sub="How close to a grade boundary a student must be to be flagged 'marginal' on the Grades screen. Measured as a symmetric percentage band (±%) around each threshold — fairer than a raw item count, which is harsher in subjects with fewer items. The flag drives the marginal filter and the suggested mark adjustment."
        >
          <BorderlineBandRow
            value={config.borderline.bandPct}
            onCommit={(pct) => provider.setBorderlineConfig({ bandPct: pct })}
          />
          <Row label="Pending G12 policy" last>
            <span className="hf-sub" style={{ textAlign: "right", maxWidth: 360 }}>
              <strong>±2% is a placeholder</strong> until G12 confirms the policy value — edit it above. Bounds:
              {" "}{BORDERLINE_BAND_MIN}–{BORDERLINE_BAND_MAX}%. The value is validated again server-side before it is saved.
            </span>
          </Row>
        </SectionCard>

        {/* cut-score guard-rails (Wave 3b) — policy-fixed in the engine. */}
        <SectionCard
          title="Cut-score guard-rails"
          sub="Numeric guard-rails the engine applies when suggesting per-subject cut-scores (Standard-Setting Policy, slide 14). Fixed by policy — shown for transparency."
          fixed
        >
          <Row label="Cut-score floor">
            <DisplayValue>{POLICY_GUARDRAILS.floorPct}% of subject max — no cut may sit below this.</DisplayValue>
          </Row>
          <Row label="Cut-score ceiling">
            <DisplayValue>{POLICY_GUARDRAILS.ceilingPct}% of subject max — no cut may sit above this.</DisplayValue>
          </Row>
          <Row label="Outstanding cut — ½-D3 requirement" last>
            <DisplayValue>
              The Outstanding cut must imply <strong>≥ ½ of the D3 items correct</strong>; if any student clears the cut
              without it, the engine surfaces a cohort-level warning (never a silent clamp).
            </DisplayValue>
          </Row>
        </SectionCard>

        {/* target band distribution defaults — policy-fixed seeds. */}
        <SectionCard
          title="Target band distribution"
          sub="The default cohort proportions the cut-score backsolve aims for, seeded from the policy indicative band ranges (the lowest band is always the remainder)."
          fixed
        >
          {POLICY_BAND_RANGES.map((r, i) => {
            const labels = ["★★★ Outstanding", "★★ Exceeds", "★ Meets", "no-star Doesn’t-yet-meet"];
            const target = DEFAULT_POLICY_TARGETS[i];
            const last = i === POLICY_BAND_RANGES.length - 1;
            return (
              <Row key={i} label={labels[i] ?? `Band ${i + 1}`} last={last}>
                <DisplayValue>
                  range {r.min}–{r.max}%{target != null ? <> · default target <strong>{target}%</strong></> : <> · remainder</>}
                </DisplayValue>
              </Row>
            );
          })}
        </SectionCard>

        {/* reliability flags — engine constants, display-only. */}
        <SectionCard
          title="Reliability (Cronbach’s α)"
          sub="Thresholds the engine and the reliability panel use to flag fragile internal-consistency estimates. Additive output — these never perturb scores."
          fixed
        >
          <Row label="Acceptable α">
            <DisplayValue>≥ <strong>0.70</strong> reads as acceptable (the reliability panel bands 0.50–0.70 as marginal, below 0.50 as weak).</DisplayValue>
          </Row>
          <Row label="Low-items flag">
            <DisplayValue>fewer than <strong>{LOW_ITEMS_THRESHOLD}</strong> items — α is fragile.</DisplayValue>
          </Row>
          <Row label="Small-sample flag" last>
            <DisplayValue>fewer than <strong>{SMALL_SAMPLE_THRESHOLD}</strong> participants — α is unstable.</DisplayValue>
          </Row>
        </SectionCard>

        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 18 }}>
            <SectionCard title="Data retention" mock>
              <Row label="Archive locked sittings after">
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

function SectionCard({ title, sub, mock, fixed, children }: { title: string; sub?: string; mock?: boolean; fixed?: boolean; children: ReactNode }) {
  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="hf-h2">{title}</div>
        {mock && <span style={{ fontSize: 8.5, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 5px", letterSpacing: 0.5 }}>MOCK</span>}
        {fixed && <span style={{ fontSize: 8.5, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 5px", letterSpacing: 0.5 }}>DISPLAY-ONLY</span>}
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

/** A read-only value cell for policy-fixed settings (right-aligned, muted). */
function DisplayValue({ children }: { children: ReactNode }) {
  return (
    <span className="hf-sub" style={{ fontSize: 12, textAlign: "right", maxWidth: 380, color: H.ink2 }}>{children}</span>
  );
}

/**
 * Editable borderline-band (±%) control. Holds local text while editing, validates
 * numerically against the bounds, and commits a clamped value on blur / Enter. The
 * commit is the grade-bearing write — the engine re-flags through the full recompute.
 */
function BorderlineBandRow({ value, onCommit }: { value: number; onCommit: (pct: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(value);
  const parsed = Number(shown);
  const invalid = shown.trim() === "" || Number.isNaN(parsed) || !isValidBorderlineBand(parsed);
  const commit = () => {
    if (!invalid) onCommit(parsed);
    setText(null); // fall back to the (clamped) live value
  };
  return (
    <Row label="Borderline band (±%)">
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="hf-sub" style={{ fontSize: 12 }}>±</span>
          <input
            className="hf-input"
            style={{ width: 64, textAlign: "right", borderColor: invalid ? H.pink : undefined }}
            value={shown}
            inputMode="decimal"
            aria-label="Borderline band, percent"
            aria-invalid={invalid}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="hf-sub" style={{ fontSize: 12 }}>%</span>
        </span>
        {invalid && (
          <span style={{ fontSize: 10.5, color: H.pink }}>
            Enter a number between {BORDERLINE_BAND_MIN} and {BORDERLINE_BAND_MAX}.
          </span>
        )}
      </span>
    </Row>
  );
}
