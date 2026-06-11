"use client";

/**
 * Editable item-quality thresholds — the Good / Review / Flag bands the engine
 * reads from `ScoringConfig.quality` (prompt 1). Editing here actually changes
 * how every item is rated. Lead/Admin only; non-leads see the bands read-only.
 *
 *  - p-value (difficulty) is a two-sided band: < flagBelow → Flag, < reviewBelow
 *    → Review, ≤ goodUpTo → Good, ≤ reviewUpTo → Review, else Flag.
 *  - item-total / point-biserial / discrimination are one-sided: < flagBelow →
 *    Flag, < reviewBelow → Review, else Good.
 */
import { useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button, Card } from "@/components/ui/primitives";
import { Mark } from "@/components/ui/icons";
import type { CorrelationThresholds, QualityThresholds } from "@/lib/engine";

const CORR_METRICS: { key: keyof Pick<QualityThresholds, "itemTotal" | "pointBiserial" | "discrimination">; label: string }[] = [
  { key: "itemTotal", label: "Item-total correlation" },
  { key: "pointBiserial", label: "Point-biserial" },
  { key: "discrimination", label: "Discrimination" },
];

export function QualityThresholdsEditor() {
  const provider = useProvider();
  const config = useProviderData((p) => p.getScoringConfig());
  const live = config.quality;
  const editable = provider.getCurrentUser().role === "lead_admin";

  const [draft, setDraft] = useState<QualityThresholds>(() => clone(live));
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(live);

  const save = () => {
    provider.setQualityThresholds(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const reset = () => setDraft(clone(live));

  const setP = (field: keyof QualityThresholds["pValue"], v: number) =>
    setDraft((d) => ({ ...d, pValue: { ...d.pValue, [field]: v } }));
  const setCorr = (metric: (typeof CORR_METRICS)[number]["key"], field: keyof CorrelationThresholds, v: number) =>
    setDraft((d) => ({ ...d, [metric]: { ...d[metric], [field]: v } }));

  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="hf-h2">Item-quality thresholds</div>
        <div style={{ flex: 1 }} />
        {editable && saved && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: H.good, fontSize: 12.5, fontWeight: 600 }}>
            <Mark kind="pass" size={15} /> Saved
          </span>
        )}
        {editable && (
          <>
            <Button variant="ghost" disabled={!dirty} onClick={reset}>Reset</Button>
            <Button variant="pri" disabled={!dirty} onClick={save}>Save thresholds</Button>
          </>
        )}
      </div>
      <div className="hf-sub" style={{ fontSize: 12, marginTop: 3, marginBottom: 12 }}>
        The bands that drive the Good / Review / Flag rating on each item statistic. These feed the
        engine directly — changing them re-rates every item.
      </div>

      {dirty && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 13px", marginBottom: 12, background: H.warnSoft, border: `1px solid ${H.warn}33`, borderRadius: 9 }}>
          <Mark kind="warn" size={16} />
          <span style={{ fontSize: 12, color: H.ink }}>
            Saving changes how items are rated across every assessment in the workspace. The parity
            baseline is the default set — only change these with the assessment team’s agreement.
          </span>
        </div>
      )}

      <div className="hf-scroll-x">
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr>
              <th className="hf-th" style={{ paddingLeft: 0 }}>Statistic</th>
              <th className="hf-th" style={{ textAlign: "right" }}>Flag below</th>
              <th className="hf-th" style={{ textAlign: "right" }}>Review below</th>
              <th className="hf-th" style={{ textAlign: "right" }}>Good up to</th>
              <th className="hf-th" style={{ textAlign: "right", paddingRight: 0 }}>Review up to</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="hf-td" style={{ paddingLeft: 0, fontSize: 12.5, fontWeight: 600 }}>p-value (difficulty)</td>
              <Cell><DecimalField value={draft.pValue.flagBelow} editable={editable} onChange={(v) => setP("flagBelow", v)} /></Cell>
              <Cell><DecimalField value={draft.pValue.reviewBelow} editable={editable} onChange={(v) => setP("reviewBelow", v)} /></Cell>
              <Cell><DecimalField value={draft.pValue.goodUpTo} editable={editable} onChange={(v) => setP("goodUpTo", v)} /></Cell>
              <Cell pr><DecimalField value={draft.pValue.reviewUpTo} editable={editable} onChange={(v) => setP("reviewUpTo", v)} /></Cell>
            </tr>
            {CORR_METRICS.map((m) => (
              <tr key={m.key}>
                <td className="hf-td" style={{ paddingLeft: 0, fontSize: 12.5, fontWeight: 600 }}>{m.label}</td>
                <Cell><DecimalField value={draft[m.key].flagBelow} editable={editable} onChange={(v) => setCorr(m.key, "flagBelow", v)} /></Cell>
                <Cell><DecimalField value={draft[m.key].reviewBelow} editable={editable} onChange={(v) => setCorr(m.key, "reviewBelow", v)} /></Cell>
                <Cell><span className="hf-sub hf-mono" style={{ color: H.ink3 }}>—</span></Cell>
                <Cell pr><span className="hf-sub hf-mono" style={{ color: H.ink3 }}>—</span></Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!editable && (
        <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 10 }}>
          Only a Lead/Admin can edit the rating thresholds.
        </div>
      )}
    </Card>
  );
}

function Cell({ children, pr }: { children: React.ReactNode; pr?: boolean }) {
  return (
    <td className="hf-td" style={{ textAlign: "right", paddingRight: pr ? 0 : undefined }}>
      {children}
    </td>
  );
}

function clone(q: QualityThresholds): QualityThresholds {
  return {
    pValue: { ...q.pValue },
    itemTotal: { ...q.itemTotal },
    pointBiserial: { ...q.pointBiserial },
    discrimination: { ...q.discrimination },
  };
}

function DecimalField({ value, editable, onChange }: { value: number; editable: boolean; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  if (!editable) {
    return <span className="hf-mono" style={{ fontSize: 12 }}>{value.toFixed(2)}</span>;
  }
  return (
    <input
      className="hf-input"
      style={{ width: 64 }}
      inputMode="decimal"
      value={text ?? value.toFixed(2)}
      onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
      onBlur={() => {
        if (text !== null && text !== "") {
          const n = Number(text);
          if (!Number.isNaN(n)) onChange(n);
        }
        setText(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
