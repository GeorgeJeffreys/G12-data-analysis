"use client";

/**
 * Overall analytics kit — chart primitives + the slice model, ported from the
 * finalised design (design/ovKit.jsx) to TSX. The mock DATA constants from the
 * original kit are gone: every figure now comes from `getOverallAnalytics()`
 * (the `OverallAnalytics` read-model), which the page threads in as props.
 *
 * Locked methodology (unchanged from the read-model): Combined = best-of-two
 * AWARD; improvement = performance-LEVEL movement; pass = any award above the
 * lowest band. Data viz stays neutral; pink is an accent only.
 */
import { Fragment, type ReactNode } from "react";
import { H } from "@/lib/ui/tokens";
import type { AwardBand, OverallAnalytics, PLevel } from "@/lib/data/types";

// ── ordinal ramps, best → worst — colours keyed by band, names from the model ──
const AWARD_C: Record<AwardBand["key"], string> = { dist: "#b02a5f", adv: "#d67ba0", sec: "#93a0a8", rol: "#ccd4da" };
const PLEVEL_C: Record<PLevel["key"], string> = { out: "#b02a5f", exc: "#d67ba0", meet: "#93a0a8", not: "#ccd4da" };

export interface RampBand {
  key: string;
  name: string;
  short: string;
  c: string;
}
/** Attach the design's ordinal colour to each award/level band from the model. */
export function awardRamp(awards: AwardBand[]): RampBand[] {
  return awards.map((a) => ({ key: a.key, name: a.name, short: a.short, c: AWARD_C[a.key] ?? H.bar }));
}
export function plevelRamp(plevels: PLevel[]): RampBand[] {
  return plevels.map((p) => ({ key: p.key, name: p.name, short: p.short, c: PLEVEL_C[p.key] ?? H.bar }));
}

/** % at/above the lowest band (Meets or above) for a level distribution. */
export const levelPass = (d: Record<"out" | "exc" | "meet" | "not", number>): number => d.out + d.exc + d.meet;
/** February | May → the sitting key used to read single-sitting score stats. */
export const examSitting = (exam: string): "feb" | "may" => (exam === "February" ? "feb" : "may");

// ════ SLICE MODEL ════════════════════════════════════════════════════════════
// The four-dropdown checkbox slice (FinalSlice) is adapted, via finalToLegacy in
// the slicer, into the LegacySlice shape the sections consume.

export interface CentreSel {
  mode: "all" | "single" | "subset" | "exclude";
  sel: string[];
}
export interface LegacySlice {
  exam: string;
  year: number | "trend";
  centre: CentreSel;
  subject: string | null;
  /** Sorted selected LIVE years — threaded so sections pick cur/prev dynamically. */
  years: number[];
}

export function centreLabel(c: CentreSel, total: number): string {
  if (c.mode === "single") return c.sel[0] || "One centre";
  if (c.mode === "subset") return `${c.sel.length || 0} centres`;
  if (c.mode === "exclude") return `All except ${c.sel.length}`;
  return `All ${total} centres`;
}
export function activeCentreCount(c: CentreSel, total: number): number {
  if (c.mode === "single") return 1;
  if (c.mode === "subset") return c.sel.length;
  if (c.mode === "exclude") return total - c.sel.length;
  return total;
}

export interface SliceEffects {
  s2Levels: boolean;
  s4Enabled: boolean;
  s4Count: number;
  trend: boolean;
  singleCentre: boolean;
  examSitting: "feb" | "may";
}
/** What each section can do under a slice (degeneracy handling lives here). */
export function sliceEffects(slice: LegacySlice, analytics: OverallAnalytics): SliceEffects {
  const n = activeCentreCount(slice.centre, analytics.centres.length);
  return {
    s2Levels: slice.exam === "Combined", // Combined → performance levels, not score
    s4Enabled: n >= 2, // cross-centre comparison needs 2+
    s4Count: n,
    trend: slice.years.length >= 2, // a trend needs ≥2 selected live years
    singleCentre: n === 1,
    examSitting: examSitting(slice.exam),
  };
}

// ════ CHART PRIMITIVES ═══════════════════════════════════════════════════════
export function ovTicks(min: number, max: number, n = 4): number[] {
  const step = (max - min) / n;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(min + step * i);
  return out;
}

export interface OVSeries {
  key?: string;
  pts: number[];
  color: string;
  width?: number;
  dashed?: boolean;
  dim?: boolean;
  tag?: boolean;
}

export function OVLine({
  series,
  xLabels,
  yMin = 0,
  yMax = 100,
  fmt = (v: number) => String(v),
  w = 520,
  h = 190,
  pad = { t: 14, r: 16, b: 26, l: 34 },
  ticks = 4,
  dots = true,
  lastTag = true,
  band,
  yUnit = "",
  bars,
}: {
  series?: OVSeries[];
  xLabels: string[];
  yMin?: number;
  yMax?: number;
  fmt?: (v: number) => string;
  w?: number;
  h?: number;
  pad?: { t: number; r: number; b: number; l: number };
  ticks?: number;
  dots?: boolean;
  lastTag?: boolean;
  band?: { hi: number[]; lo: number[]; color?: string };
  yUnit?: string;
  bars?: number[];
}) {
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const n = xLabels.length;
  const sx = (i: number) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const sy = (v: number) => pad.t + ih - ((v - yMin) / ((yMax - yMin) || 1)) * ih;
  const line = (pts: number[]) => pts.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible", maxWidth: "100%" }} viewBox={`0 0 ${w} ${h}`}>
      {ovTicks(yMin, yMax, ticks).map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} stroke={H.line} strokeWidth="1" />
          <text x={pad.l - 7} y={sy(t) + 3.5} textAnchor="end" fontFamily="var(--font-mono)" fontSize="9.5" fill={H.ink3}>{fmt(Math.round(t))}</text>
        </g>
      ))}
      {xLabels.map((lb, i) => (
        <text key={i} x={sx(i)} y={h - pad.b + 15} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill={H.ink2}>{lb}</text>
      ))}
      {band && (
        <path
          d={`${band.hi.map((v, i) => `${i ? "L" : "M"}${sx(i)} ${sy(v)}`).join(" ")} ${band.lo
            .map((_, i) => `L${sx(band.lo.length - 1 - i)} ${sy(band.lo[band.lo.length - 1 - i]!)}`)
            .join(" ")} Z`}
          fill={band.color || H.tint2}
          opacity="0.6"
        />
      )}
      {bars &&
        bars.map((b, i) => {
          const bw = Math.min(46, (iw / bars.length) * 0.5);
          return (
            <g key={i}>
              <rect x={sx(i) - bw / 2} y={sy(b)} width={bw} height={sy(yMin) - sy(b)} rx="4" fill={H.pink} />
              <text x={sx(i)} y={sy(b) - 6} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="11" fontWeight="700" fill={H.pink}>{fmt(b)}{yUnit}</text>
            </g>
          );
        })}
      {series &&
        series.map((s, si) => (
          <g key={si}>
            <path d={line(s.pts)} fill="none" stroke={s.color} strokeWidth={s.width || 2.4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.dashed ? "4 4" : "none"} opacity={s.dim ? 0.5 : 1} />
            {dots && s.pts.map((v, i) => <circle key={i} cx={sx(i)} cy={sy(v)} r={i === s.pts.length - 1 ? 3.4 : 2.6} fill={s.color} opacity={s.dim ? 0.5 : 1} />)}
            {lastTag && s.tag !== false && s.pts.length > 0 && (
              <text x={sx(s.pts.length - 1) + 7} y={sy(s.pts[s.pts.length - 1]!) + 3.5} fontFamily="var(--font-mono)" fontSize="11" fontWeight="700" fill={s.color}>{fmt(s.pts[s.pts.length - 1]!)}{yUnit}</text>
            )}
          </g>
        ))}
    </svg>
  );
}

export function OVSpark({ pts, w = 92, h = 34, color = H.pink }: { pts: number[]; w?: number; h?: number; color?: string }) {
  if (pts.length === 0) return <svg width={w} height={h} />;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const nx = (i: number) => (i / Math.max(1, pts.length - 1)) * (w - 4) + 2;
  const ny = (v: number) => h - ((v - min) / ((max - min) || 1)) * (h - 8) - 4;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${nx(i).toFixed(1)} ${ny(v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <path d={`${d} L${nx(pts.length - 1)} ${h} L${nx(0)} ${h} Z`} fill={color} opacity="0.08" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={nx(pts.length - 1)} cy={ny(pts[pts.length - 1]!)} r="2.8" fill={color} />
    </svg>
  );
}

export function OVKpi({
  label,
  value,
  unit = "",
  delta,
  deltaGood = true,
  pts,
  accent,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: string | null;
  deltaGood?: boolean;
  pts?: number[];
  accent?: boolean;
}) {
  const up = delta != null && delta[0] !== "−";
  const good = delta == null ? null : up === deltaGood;
  return (
    <div className="hf-card" style={{ flex: 1, padding: "15px 17px", minWidth: 0 }}>
      <div className="hf-lbl" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div className="hf-row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginTop: 9, gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="hf-mono" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1, color: accent ? H.pink : H.ink }}>{value}<span style={{ fontSize: 14, color: H.ink3 }}>{unit}</span></div>
          {delta != null && (
            <div className="hf-row" style={{ gap: 5, marginTop: 7 }}>
              <span className="hf-mono" style={{ fontSize: 11, fontWeight: 700, color: good ? H.good : H.bad }}>{delta}</span>
              <span className="hf-sub" style={{ fontSize: 10.5 }}>vs prev</span>
            </div>
          )}
        </div>
        {pts && <OVSpark pts={pts} color={accent ? H.pink : H.ink2} />}
      </div>
    </div>
  );
}

/** Participation funnel: sat Feb → sat May → completed both; attrition off Feb. */
export function OVFunnel({ steps }: { steps: { k: string; v: number }[] }) {
  const max = steps[0]?.v || 1;
  return (
    <div className="hf-col" style={{ gap: 0, width: "100%" }}>
      {steps.map((s, i) => {
        const w = (s.v / max) * 100;
        const prev = steps[i - 1]?.v;
        const drop = i > 0 && prev ? Math.round((1 - s.v / prev) * 100) : null;
        return (
          <div key={i} className="hf-row" style={{ gap: 14, alignItems: "center", padding: "6px 0" }}>
            <span style={{ width: 118, flex: "0 0 auto", fontSize: 12, color: H.ink, textAlign: "right", fontWeight: 500 }}>{s.k}</span>
            <div style={{ flex: 1, position: "relative", height: 30 }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: H.tint }} />
              <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${w}%`, borderRadius: 6, background: i === steps.length - 1 ? H.pink : H.slate, opacity: i === steps.length - 1 ? 1 : 1 - i * 0.14, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 10 }}>
                <span className="hf-mono" style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>{s.v}</span>
              </div>
            </div>
            <span className="hf-mono" style={{ width: 84, flex: "0 0 auto", fontSize: 10.5, color: drop == null ? "transparent" : H.ink3 }}>{drop != null ? `−${drop}% vs Feb` : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 100% stacked columns over an axis of years OR centres. */
export function OVStackCols<T extends string | number>({
  years,
  data,
  ramp,
  h = 200,
  colW = 46,
  gap = "space-around",
  labelYear = (y: T) => String(y),
}: {
  years: T[];
  data: Record<string, Record<string, number>> | ((y: T, i: number) => Record<string, number>);
  ramp: RampBand[];
  h?: number;
  colW?: number;
  gap?: string;
  labelYear?: (y: T) => string;
}) {
  return (
    <div className="hf-row" style={{ justifyContent: gap, alignItems: "flex-end", height: h + 24, flexWrap: "wrap", gap: 6 }}>
      {years.map((y, yi) => {
        const d = (typeof data === "function" ? data(y, yi) : data[String(y)]) ?? {};
        return (
          <div key={String(y)} className="hf-col" style={{ alignItems: "center", gap: 8 }}>
            <div className="hf-col" style={{ width: colW, height: h, borderRadius: 6, overflow: "hidden", boxShadow: "0 1px 2px rgba(44,55,57,.06)" }}>
              {ramp.map((r) => (
                <div key={r.key} style={{ height: `${d[r.key] ?? 0}%`, background: r.c, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {(d[r.key] ?? 0) >= 12 && <span className="hf-mono" style={{ fontSize: 10, fontWeight: 700, color: r.key === "rol" || r.key === "not" ? H.ink2 : "#fff" }}>{d[r.key]}</span>}
                </div>
              ))}
            </div>
            <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink2, maxWidth: colW + 30, textAlign: "center", lineHeight: 1.2 }}>{labelYear(y)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Single horizontal stacked bar (level / award distribution). */
export function OVStackBar({ dist, ramp, h = 18, radius = 4, labels = false }: { dist: Record<string, number>; ramp: RampBand[]; h?: number; radius?: number; labels?: boolean }) {
  return (
    <div className="hf-col" style={{ gap: 5, width: "100%" }}>
      <div className="hf-row" style={{ height: h, borderRadius: radius, overflow: "hidden", width: "100%" }}>
        {ramp.map((r) => (
          <div key={r.key} style={{ width: `${dist[r.key] ?? 0}%`, background: r.c, display: "flex", alignItems: "center", justifyContent: "center" }} title={`${r.name} ${dist[r.key] ?? 0}%`}>
            {labels && (dist[r.key] ?? 0) >= 10 && <span className="hf-mono" style={{ fontSize: 9.5, fontWeight: 700, color: r.key === "rol" || r.key === "not" ? H.ink2 : "#fff" }}>{dist[r.key]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function OVRangeBand({
  years,
  best,
  worst,
  mean,
  w = 520,
  h = 200,
  yMin = 20,
  yMax = 80,
  fmt = (v: number) => `${v}%`,
}: {
  years: (string | number)[];
  best: number[];
  worst: number[];
  mean: number[];
  w?: number;
  h?: number;
  yMin?: number;
  yMax?: number;
  fmt?: (v: number) => string;
}) {
  return (
    <OVLine
      w={w}
      h={h}
      yMin={yMin}
      yMax={yMax}
      xLabels={years.map(String)}
      fmt={fmt}
      dots
      band={{ hi: best, lo: worst, color: H.tint2 }}
      series={[
        { pts: best, color: H.slate, width: 2, tag: true },
        { pts: worst, color: H.bar, width: 2, tag: true },
        { pts: mean, color: H.pink, width: 2.6, tag: false, dashed: true },
      ]}
    />
  );
}

export function OVDumbbell({ rows, min = 0, max = 100, fmt = (v: number) => `${v}%` }: { rows: { k: string; v: number; hi?: boolean; lo?: boolean }[]; min?: number; max?: number; fmt?: (v: number) => string }) {
  return (
    <div className="hf-col" style={{ gap: 9, width: "100%" }}>
      {rows.map((r, i) => {
        const x = ((r.v - min) / ((max - min) || 1)) * 100;
        return (
          <div key={i} className="hf-row" style={{ gap: 12 }}>
            <span style={{ width: 96, flex: "0 0 auto", fontSize: 11.5, color: H.ink, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.k}</span>
            <div style={{ flex: 1, position: "relative", height: 16 }}>
              <div style={{ position: "absolute", top: 7, left: 0, right: 0, height: 2, background: H.line }} />
              <div style={{ position: "absolute", top: 5, left: `${x}%`, width: 12, height: 12, marginLeft: -6, borderRadius: 999, background: r.hi ? H.pink : r.lo ? H.ink3 : H.slate, border: "2px solid #fff", boxShadow: "0 1px 2px rgba(0,0,0,.15)" }} />
            </div>
            <span className="hf-mono" style={{ width: 40, flex: "0 0 auto", fontSize: 11.5, fontWeight: 600, color: H.ink, textAlign: "right" }}>{fmt(r.v)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function OVDelta({ v, unit = "", good = "up", size = 11 }: { v: number; unit?: string; good?: "up" | "down" | "flat"; size?: number }) {
  const up = v > 0;
  const isGood = good === "up" ? up : good === "down" ? !up : true;
  if (v === 0) return <span className="hf-mono" style={{ fontSize: size, color: H.ink3 }}>±0</span>;
  return <span className="hf-mono" style={{ fontSize: size, fontWeight: 700, color: isGood ? H.good : H.bad }}>{up ? "+" : "−"}{Math.abs(v)}{unit}</span>;
}

export function OVRampLegend({ ramp, style = {} }: { ramp: RampBand[]; style?: React.CSSProperties }) {
  return (
    <div className="hf-row" style={{ gap: 14, flexWrap: "wrap", ...style }}>
      {ramp.map((r) => (
        <span key={r.key} className="hf-row" style={{ gap: 6, fontSize: 11, color: H.ink2 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: r.c, flex: "0 0 auto" }} />
          {r.name}
        </span>
      ))}
    </div>
  );
}

/** Year track for the time control (live years + ghosted future). */
export function OVYearTrack({ years, ghost }: { years: number[]; ghost: number[] }) {
  return (
    <div className="hf-row" style={{ gap: 0, alignItems: "center" }}>
      {years.map((y, i) => (
        <Fragment key={y}>
          {i > 0 && <div style={{ width: 22, height: 2, background: H.pink }} />}
          <div className="hf-col" style={{ alignItems: "center", gap: 4 }}>
            <span style={{ width: 11, height: 11, borderRadius: 999, background: H.pink, border: "2px solid #fff", boxShadow: `0 0 0 1.5px ${H.pink}` }} />
            <span className="hf-mono" style={{ fontSize: 10.5, fontWeight: 700, color: H.pink }}>{y}</span>
          </div>
        </Fragment>
      ))}
      {ghost.map((y) => (
        <Fragment key={y}>
          <div style={{ width: 22, height: 2, background: H.line2, opacity: 0.8 }} />
          <div className="hf-col" style={{ alignItems: "center", gap: 4, opacity: 0.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: H.paper, border: `1.5px dashed ${H.line2}` }} />
            <span className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>{y}</span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
