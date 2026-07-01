"use client";

/**
 * Shared presentational pieces for the two diagnostics surfaces, so the
 * whole-assessment health check (critical-path "Assessment Health" step) and the
 * exploratory reference tab ("Analysis") render identical tables/badges/charts
 * from the same read-model without duplicating the markup.
 *
 * These are display-only atoms — they consume the diagnostics read-model and
 * never touch scoring/engine logic.
 */
import type { CSSProperties } from "react";
import { H } from "@/lib/ui/tokens";
import { Mark } from "@/components/ui/icons";
import type { DiagStatus, PositionOmission, SpeededResult } from "@/lib/diagnostics";

export type Tone = "good" | "warn" | "bad";

export const statusColor = (s: DiagStatus) => (s === "Good" ? H.good : s === "Review" ? H.warn : H.bad);
export const statusBg = (s: DiagStatus) => (s === "Good" ? H.goodSoft : s === "Review" ? H.warnSoft : H.badSoft);

/** Demand-level palette (difficulty axis, not a quality status). */
export const DEMAND_COLOR: Record<string, string> = { D1: "#5B8DEF", D2: "#E8A13A", D3: "#D9534F" };
export const demandColor = (d: string | null) => (d && DEMAND_COLOR[d]) || H.ink3;
export const demandLabel: Record<string, string> = { D1: "D1 · foundational", D2: "D2 · intermediate", D3: "D3 · top-difficulty" };

/** One speededness row — whole assessment (highlighted) or a demand level / item set. */
export function SpeededRow({ label, s, whole = false, demand }: { label: string; s: SpeededResult; whole?: boolean; demand?: string }) {
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

export function Hc({ t, sub }: { t: string; sub?: string }) {
  return (
    <th className="hf-th" style={{ textAlign: "right" }}>
      {t}
      {sub && <div style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: H.ink3, fontSize: 9 }}>{sub}</div>}
    </th>
  );
}

export function SectionHead({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} style={{ padding: "8px 12px", background: H.tint, borderTop: `1px solid ${H.line2}`, borderBottom: `1px solid ${H.line2}` }}>
        <span className="hf-lbl">{children}</span>
      </td>
    </tr>
  );
}

/** Plain-language interpretation block, embedded under a figure. */
export function HelpNote({ title, body }: { title: string; body: React.ReactNode }) {
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
export function DemandLegend({ demands }: { demands: string[] }) {
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
export function OmissionByPosition({ points }: { points: PositionOmission[] }) {
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

export function DiagStatusBadge({ s }: { s: DiagStatus }) {
  const kind = s === "Good" ? "pass" : s === "Review" ? "warn" : "fail";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: statusColor(s), background: statusBg(s), padding: "2px 8px", borderRadius: 999 }}>
      <Mark kind={kind} size={11} />
      {s}
    </span>
  );
}

/** Horizontal completion meter (0–100). */
export function RateBar({ v, tone }: { v: number; tone: Tone }) {
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
export function CorrMeter({ r }: { r: number }) {
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
