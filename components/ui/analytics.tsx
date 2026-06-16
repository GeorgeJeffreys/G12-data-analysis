"use client";

/**
 * Small analytics visualisations (sparkline, stacked award column) and the
 * mock-priors banner, ported from design/hfAnalytics.jsx. Data viz stays neutral
 * apart from the top award band.
 */
import { H } from "@/lib/ui/tokens";
import { Mark } from "./icons";

/** Colour ramp for award bands: top band magenta, neutral ramp down. */
export function awardRamp(index: number, total: number): string {
  const ramp = [H.pink, "#6b7780", "#9aa4ac", "#c2cad0", "#dfe4e9"];
  if (index === 0) return ramp[0]!;
  const span = Math.max(1, total - 1);
  const pos = Math.min(ramp.length - 1, 1 + Math.round(((index - 1) / span) * (ramp.length - 2)));
  return ramp[pos]!;
}

export function Spark({
  pts,
  w = 116,
  h = 32,
  color = H.pink,
  highlight,
}: {
  pts: number[];
  w?: number;
  h?: number;
  color?: string;
  /** Index of the point to mark (defaults to the last). */
  highlight?: number;
}) {
  if (pts.length === 0) return <svg width={w} height={h} />;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const nx = (i: number) => (i / Math.max(1, pts.length - 1)) * (w - 4) + 2;
  const ny = (v: number) => h - ((v - min) / (max - min || 1)) * (h - 6) - 3;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${nx(i).toFixed(1)} ${ny(v).toFixed(1)}`).join(" ");
  const hi = highlight ?? pts.length - 1;
  const hv = pts[hi] ?? pts[pts.length - 1]!;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={nx(hi)} cy={ny(hv)} r="3" fill="#fff" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export function AwardStack({ dist, levels, h = 150, w = 30 }: { dist: Record<string, number>; levels: string[]; h?: number; w?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: w, height: h, borderRadius: 4, overflow: "hidden", flex: "0 0 auto" }}>
      {levels.map((lvl, i) => (
        <div key={lvl} style={{ height: `${dist[lvl] ?? 0}%`, background: awardRamp(i, levels.length) }} title={`${lvl} ${dist[lvl] ?? 0}%`} />
      ))}
    </div>
  );
}

export function MockBanner({ text }: { text?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: H.warnSoft, border: `1px solid ${H.warn}33`, borderRadius: 10 }}>
      <Mark kind="warn" size={15} />
      <span style={{ fontSize: 12, color: H.ink }}>
        {text ?? "Prior cycles are illustrative mock data — there's no real cross-cycle history yet. Only the latest cycle's figures are computed from real results."}
      </span>
      <span style={{ marginLeft: "auto", fontSize: 8.5, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 5px", letterSpacing: 0.5 }}>MOCK PRIORS</span>
    </div>
  );
}
