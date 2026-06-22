"use client";

/**
 * Small analytics visualisations (sparkline, stacked award column) and the
 * mock-priors banner, ported from design/hfAnalytics.jsx. Data viz stays neutral
 * apart from the top award band.
 */
import type { ReactNode } from "react";
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

/** Compact award-level label (drops the trailing "award"/"achievement award"). */
export function awardShortLabel(level: string): string {
  return level.replace(/ (award|achievement award)$/i, "");
}

const PLOT_H = 168;
const Y_TICKS = [100, 75, 50, 25, 0];

/** Y-axis (0–100%) with gridlines behind a plot area. Shared by both charts. */
function PlotArea({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {/* y-axis tick labels */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: PLOT_H, paddingBottom: 1 }}>
        {Y_TICKS.map((t) => (
          <span key={t} className="hf-mono" style={{ fontSize: 9, color: H.ink3, lineHeight: 1 }}>{t}%</span>
        ))}
      </div>
      <div style={{ position: "relative", flex: 1, height: PLOT_H }}>
        {/* gridlines */}
        {Y_TICKS.map((t) => (
          <div key={t} style={{ position: "absolute", left: 0, right: 0, top: `${100 - t}%`, height: 1, background: t === 0 ? H.line2 : H.line }} />
        ))}
        {children}
      </div>
    </div>
  );
}

/** A small swatch + label legend row, mapping each award level to its colour. */
function AwardLegend({ levels }: { levels: string[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12, justifyContent: "center" }}>
      {levels.map((lvl, i) => (
        <span key={lvl} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: H.ink2 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: awardRamp(i, levels.length) }} />
          {awardShortLabel(lvl)}
        </span>
      ))}
    </div>
  );
}

/**
 * Award mix OVER TIME — one stacked %-column per cycle, coloured by award level.
 * Y-axis 0–100%, x-axis = cycle names, legend maps colour → award level. The
 * selected/current cycle is highlighted on the x-axis.
 */
export function AwardOverTimeChart({
  series,
  levels,
  highlightIndex,
}: {
  series: { label: string; dist: Record<string, number> }[];
  levels: string[];
  highlightIndex?: number;
}) {
  return (
    <div>
      <PlotArea>
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "space-around", alignItems: "flex-end" }}>
          {series.map((s, si) => (
            <div key={s.label + si} style={{ display: "flex", flexDirection: "column", height: "100%", width: 36, justifyContent: "flex-end" }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  borderRadius: 4,
                  overflow: "hidden",
                  outline: si === highlightIndex ? `2px solid ${H.pink}` : "none",
                  outlineOffset: 1,
                }}
              >
                {levels.map((lvl, i) => (
                  <div key={lvl} style={{ height: `${s.dist[lvl] ?? 0}%`, background: awardRamp(i, levels.length) }} title={`${s.label} · ${lvl}: ${s.dist[lvl] ?? 0}%`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </PlotArea>
      {/* x-axis: cycle names */}
      <div style={{ display: "flex", justifyContent: "space-around", marginTop: 6, marginLeft: 30 }}>
        {series.map((s, si) => (
          <span key={s.label + si} className="hf-mono" style={{ width: 36, textAlign: "center", fontSize: 9.5, fontWeight: si === highlightIndex ? 700 : 500, color: si === highlightIndex ? H.pink : H.ink2 }}>
            {s.label}
          </span>
        ))}
      </div>
      <AwardLegend levels={levels} />
    </div>
  );
}

/**
 * Award mix for TWO cycles side by side — grouped bars per award level, coloured
 * by award level (consistent with the over-time chart); the two cycles are
 * distinguished by fill (solid = first/current, hatched = second/prior).
 * Y-axis 0–100%, x-axis = award levels, legend explains the two cycles.
 */
export function AwardCompareChart({
  levels,
  primary,
  secondary,
}: {
  levels: string[];
  primary: { name: string; dist: Record<string, number> };
  secondary: { name: string; dist: Record<string, number> };
}) {
  return (
    <div>
      <PlotArea>
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "space-around", alignItems: "flex-end" }}>
          {levels.map((lvl, i) => {
            const c = awardRamp(i, levels.length);
            const pv = primary.dist[lvl] ?? 0;
            const sv = secondary.dist[lvl] ?? 0;
            return (
              <div key={lvl} style={{ display: "flex", alignItems: "flex-end", gap: 4, height: "100%" }}>
                <div style={{ width: 17, height: `${pv}%`, background: c, borderRadius: "2px 2px 0 0" }} title={`${primary.name} · ${lvl}: ${pv}%`} />
                <div
                  style={{
                    width: 17,
                    height: `${sv}%`,
                    borderRadius: "2px 2px 0 0",
                    border: `1.5px solid ${c}`,
                    background: `repeating-linear-gradient(45deg, ${c}22 0 3px, transparent 3px 6px)`,
                  }}
                  title={`${secondary.name} · ${lvl}: ${sv}%`}
                />
              </div>
            );
          })}
        </div>
      </PlotArea>
      {/* x-axis: award levels */}
      <div style={{ display: "flex", justifyContent: "space-around", marginTop: 6, marginLeft: 30 }}>
        {levels.map((lvl) => (
          <span key={lvl} style={{ flex: 1, textAlign: "center", fontSize: 9, fontWeight: 700, color: H.ink2, lineHeight: 1.05, maxWidth: 60 }}>
            {awardShortLabel(lvl)}
          </span>
        ))}
      </div>
      {/* legend: which fill is which cycle */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12, justifyContent: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: H.ink2 }}>
          <span style={{ width: 11, height: 11, borderRadius: 2, background: H.ink3 }} />{primary.name} <b style={{ color: H.ink }}>(solid)</b>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: H.ink2 }}>
          <span style={{ width: 11, height: 11, borderRadius: 2, border: `1.5px solid ${H.ink3}`, background: `repeating-linear-gradient(45deg, ${H.ink3}22 0 3px, transparent 3px 6px)` }} />{secondary.name} <b style={{ color: H.ink }}>(hatched)</b>
        </span>
      </div>
    </div>
  );
}

export function MockBanner({ text }: { text?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: H.warnSoft, border: `1px solid ${H.warn}33`, borderRadius: 10 }}>
      <Mark kind="warn" size={15} />
      <span style={{ fontSize: 12, color: H.ink }}>
        {text ?? "Prior sittings are illustrative mock data — there's no real cross-sitting history yet. Only the latest sitting's figures are computed from real results."}
      </span>
      <span style={{ marginLeft: "auto", fontSize: 8.5, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 5px", letterSpacing: 0.5 }}>MOCK PRIORS</span>
    </div>
  );
}
