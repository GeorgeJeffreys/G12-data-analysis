"use client";

/**
 * Compare-cycles visualisations (Analytics › Compare cycles), ported from the
 * finished design (hfCompareCycles / hfCompareKit). Data viz stays neutral per
 * the brand — the magenta accent marks the most recent cycle and the award
 * top band. Charts are generalised to 2+ cycles without layout breakage: the
 * newest cycle is magenta, older cycles step down a neutral grey ramp.
 *
 * Every component is presentational — the page supplies already-computed,
 * cycle-parallel arrays read from the provider (no recompute here).
 */
import type { ReactNode } from "react";
import { H } from "@/lib/ui/tokens";
import { Icon } from "./icons";
import { InfoTip } from "./infotip";
import { awardRamp, awardShortLabel } from "./analytics";

export interface CycleMeta {
  name: string;
  mock: boolean;
}

/** Newest cycle = magenta; older cycles step down a neutral grey ramp. */
export function cycleColor(i: number, total: number): string {
  if (i === total - 1) return H.pink;
  const ramp = ["#aeb6bd", "#8b959d", "#6b7780"];
  // oldest gets the lightest; map [0..total-2] onto the ramp
  const span = Math.max(1, total - 1);
  const pos = Math.min(ramp.length - 1, Math.round((i / span) * (ramp.length - 1)));
  return ramp[pos]!;
}

const num = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const PLOT_H = 176;

// ── KPI tile: headline metric across cycles, with delta vs the previous ──────
export function KpiTile({
  label,
  cycles,
  values,
  fmt,
  good,
  info,
}: {
  label: string;
  cycles: CycleMeta[];
  values: (number | null)[];
  fmt: (v: number) => string;
  /** true = up is good, false = down is good, null/undefined = neutral. */
  good?: boolean | null;
  info?: ReactNode;
}) {
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  const delta = num(last) && num(prev) ? Math.round((last - prev) * 100) / 100 : null;
  const up = (delta ?? 0) > 0;
  const col = good == null || delta == null ? H.ink2 : good === up ? H.good : H.bad;
  return (
    <div className="hf-card" style={{ flex: "1 1 210px", maxWidth: 360, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="hf-row" style={{ gap: 6, alignItems: "center" }}>
        <span className="hf-lbl">{label}</span>
        {info != null && <InfoTip label={`About ${label}`}>{info}</InfoTip>}
      </div>
      <div className="hf-row" style={{ gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
        {values.map((v, i) => {
          const isLast = i === values.length - 1;
          return (
            <span key={i} className="hf-row" style={{ gap: 9, alignItems: "baseline" }}>
              {i > 0 && <Icon name="arrow" size={12} color={H.ink3} />}
              <span
                className="hf-mono"
                style={{ fontSize: isLast ? 22 : 15, color: isLast ? H.pink : H.ink2, fontWeight: isLast ? 600 : 500, lineHeight: 1 }}
              >
                {num(v) ? fmt(v) : "—"}
              </span>
            </span>
          );
        })}
      </div>
      <div className="hf-row" style={{ gap: 6, fontSize: 11, alignItems: "center" }}>
        {delta == null ? (
          <span className="hf-sub" style={{ fontSize: 11 }}>no prior to compare</span>
        ) : (
          <>
            <span className="hf-mono" style={{ color: col, fontWeight: 700 }}>
              {up ? "▲" : delta < 0 ? "▼" : "–"} {delta > 0 ? "+" : ""}{delta}
            </span>
            <span className="hf-sub" style={{ fontSize: 11 }}>
              {cycles[0]?.name} → {cycles[cycles.length - 1]?.name}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ── section header: groups the screen into Exam info / Question stats / … ────
export function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="hf-col" style={{ gap: 4, marginTop: 10 }}>
      <div className="hf-row" style={{ gap: 14, alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".9px", textTransform: "uppercase", color: H.pink, whiteSpace: "nowrap" }}>{title}</span>
        <div style={{ flex: 1, height: 1, background: H.line2 }} />
      </div>
      {sub && <span className="hf-sub" style={{ fontSize: 12 }}>{sub}</span>}
    </div>
  );
}

export interface LegendItem {
  c: string;
  label: string;
  /** hollow ring marker (e.g. an older cycle on a slope chart). */
  ring?: boolean;
  /** lighter/hatched fill. */
  light?: boolean;
}

// ── chart card: title + caption + note + legend + optional InfoTip ───────────
export function ChartCard({
  title,
  cycles,
  note,
  legend,
  info,
  style,
  children,
}: {
  title: string;
  cycles: string;
  note?: string;
  legend?: LegendItem[];
  info?: ReactNode;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="hf-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0, ...style }}>
      <div className="hf-col" style={{ gap: 3 }}>
        <div className="hf-row" style={{ gap: 7, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-.2px" }}>{title}</span>
          {info != null && <InfoTip label={`About ${title}`}>{info}</InfoTip>}
        </div>
        <span className="hf-sub" style={{ fontSize: 11 }}>{cycles}</span>
      </div>
      {legend && legend.length > 0 && (
        <div className="hf-row" style={{ gap: 14, flexWrap: "wrap" }}>
          {legend.map((l, i) => (
            <span key={i} className="hf-row" style={{ gap: 5, alignItems: "center", fontSize: 10.5, color: H.ink2 }}>
              <span
                style={{
                  width: 11,
                  height: l.ring ? 11 : 11,
                  borderRadius: l.ring ? 999 : 2,
                  background: l.ring ? H.paper : l.light ? `${l.c}55` : l.c,
                  border: l.ring ? `1.5px solid ${l.c}` : "none",
                }}
              />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {children}
      {note && <span className="hf-sub" style={{ fontSize: 11, lineHeight: 1.5 }}>{note}</span>}
    </div>
  );
}

// ── shared vertical-bar plot frame (y-axis ticks + gridlines + optional ref) ──
function VPlot({
  max,
  ticks,
  fmt,
  refLine,
  children,
}: {
  max: number;
  ticks: number[];
  fmt: (v: number) => string;
  refLine?: number;
  children: ReactNode;
}) {
  const sorted = [...ticks].sort((a, b) => b - a); // top → bottom
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: PLOT_H, paddingBottom: 1 }}>
        {sorted.map((t) => (
          <span key={t} className="hf-mono" style={{ fontSize: 9, color: H.ink3, lineHeight: 1 }}>{fmt(t)}</span>
        ))}
      </div>
      <div style={{ position: "relative", flex: 1, height: PLOT_H }}>
        {sorted.map((t) => (
          <div key={t} style={{ position: "absolute", left: 0, right: 0, top: `${(1 - t / max) * 100}%`, height: 1, background: t === 0 ? H.line2 : H.line }} />
        ))}
        {refLine != null && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${(1 - refLine / max) * 100}%`,
              height: 0,
              borderTop: `1.5px dashed ${H.pink}`,
              zIndex: 2,
            }}
          />
        )}
        {children}
      </div>
    </div>
  );
}

/** x-axis subject/category labels under a plot. */
function XLabels({ labels }: { labels: string[] }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-around", marginTop: 6, marginLeft: 30 }}>
      {labels.map((l, i) => (
        <span key={i} style={{ flex: 1, textAlign: "center", fontSize: 9.5, fontWeight: 600, color: H.ink2, lineHeight: 1.1, maxWidth: 90 }}>{l}</span>
      ))}
    </div>
  );
}

export interface BarGroup {
  label: string;
  values: (number | null)[]; // parallel to cycles
}

// ── grouped bars: one group per subject, one bar per cycle ───────────────────
export function GroupedBars({
  groups,
  cycles,
  max,
  ticks,
  fmt,
  refLine,
}: {
  groups: BarGroup[];
  cycles: CycleMeta[];
  max: number;
  ticks: number[];
  fmt: (v: number) => string;
  refLine?: number;
}) {
  return (
    <div>
      <VPlot max={max} ticks={ticks} fmt={fmt} refLine={refLine}>
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "space-around", alignItems: "flex-end" }}>
          {groups.map((g) => (
            <div key={g.label} style={{ display: "flex", alignItems: "flex-end", gap: 4, height: "100%" }}>
              {g.values.map((v, ci) => (
                <div key={ci} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }} title={`${cycles[ci]?.name} · ${g.label}: ${num(v) ? fmt(v) : "—"}`}>
                  <span className="hf-mono" style={{ fontSize: 8.5, color: H.ink3, marginBottom: 2 }}>{num(v) ? fmt(v) : "—"}</span>
                  <div style={{ width: 16, height: num(v) ? `${(v / max) * 100}%` : 0, background: cycleColor(ci, cycles.length), borderRadius: "2px 2px 0 0", opacity: cycles[ci]?.mock ? 0.85 : 1 }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </VPlot>
      <XLabels labels={groups.map((g) => g.label)} />
    </div>
  );
}

export interface ScoreGroup {
  label: string;
  mean: (number | null)[];
  median: (number | null)[];
}

// ── mean bars + median tick line, per subject per cycle ──────────────────────
export function ScoreBars({
  groups,
  cycles,
  max,
  ticks,
  fmt,
}: {
  groups: ScoreGroup[];
  cycles: CycleMeta[];
  max: number;
  ticks: number[];
  fmt: (v: number) => string;
}) {
  return (
    <div>
      <VPlot max={max} ticks={ticks} fmt={fmt}>
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "space-around", alignItems: "flex-end" }}>
          {groups.map((g) => (
            <div key={g.label} style={{ display: "flex", alignItems: "flex-end", gap: 4, height: "100%" }}>
              {g.mean.map((mv, ci) => {
                const med = g.median[ci];
                return (
                  <div key={ci} style={{ position: "relative", width: 16, height: "100%", display: "flex", alignItems: "flex-end" }} title={`${cycles[ci]?.name} · ${g.label} — mean ${num(mv) ? fmt(mv) : "—"}, median ${num(med) ? fmt(med) : "—"}`}>
                    <div style={{ width: "100%", height: num(mv) ? `${(mv / max) * 100}%` : 0, background: cycleColor(ci, cycles.length), borderRadius: "2px 2px 0 0", opacity: cycles[ci]?.mock ? 0.85 : 1 }} />
                    {num(med) && (
                      <div style={{ position: "absolute", left: -1, right: -1, bottom: `${(med / max) * 100}%`, height: 2, background: H.ink, borderRadius: 1 }} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </VPlot>
      <XLabels labels={groups.map((g) => g.label)} />
    </div>
  );
}

// ── overall award distribution: per award level, one bar per cycle ───────────
export function AwardDist({
  levels,
  cycles,
  counts,
  max,
  ticks,
}: {
  levels: string[];
  cycles: CycleMeta[];
  counts: number[][]; // [levelIdx][cycleIdx]
  max: number;
  ticks: number[];
}) {
  return (
    <div>
      <VPlot max={max} ticks={ticks} fmt={(v) => String(v)}>
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "space-around", alignItems: "flex-end" }}>
          {levels.map((lvl, li) => {
            const c = awardRamp(li, levels.length);
            return (
              <div key={lvl} style={{ display: "flex", alignItems: "flex-end", gap: 4, height: "100%" }}>
                {cycles.map((cy, ci) => {
                  const v = counts[li]?.[ci] ?? 0;
                  const newest = ci === cycles.length - 1;
                  return (
                    <div key={ci} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }} title={`${cy.name} · ${lvl}: ${v}`}>
                      <span className="hf-mono" style={{ fontSize: 8.5, color: H.ink3, marginBottom: 2 }}>{v}</span>
                      <div
                        style={{
                          width: 15,
                          height: `${(v / max) * 100}%`,
                          borderRadius: "2px 2px 0 0",
                          background: newest ? c : `${c}66`,
                          border: newest ? "none" : `1.5px solid ${c}`,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </VPlot>
      <XLabels labels={levels.map(awardShortLabel)} />
    </div>
  );
}

// ── slope/line chart: one line per subject across cycle x-positions ──────────
export function SlopeChart({
  groups,
  cycles,
  min,
  max,
  ticks,
  fmt,
}: {
  groups: BarGroup[];
  cycles: CycleMeta[];
  min: number;
  max: number;
  ticks: number[];
  fmt: (v: number) => string;
}) {
  const sorted = [...ticks].sort((a, b) => b - a);
  const ny = (v: number) => (1 - (v - min) / (max - min || 1)) * 100;
  const nx = (i: number) => (cycles.length === 1 ? 50 : (i / (cycles.length - 1)) * 100);
  return (
    <div>
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: PLOT_H, paddingBottom: 1 }}>
          {sorted.map((t) => (
            <span key={t} className="hf-mono" style={{ fontSize: 9, color: H.ink3, lineHeight: 1 }}>{fmt(t)}</span>
          ))}
        </div>
        <div style={{ position: "relative", flex: 1, height: PLOT_H }}>
          {sorted.map((t) => (
            <div key={t} style={{ position: "absolute", left: 0, right: 0, top: `${ny(t)}%`, height: 1, background: H.line }} />
          ))}
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
            {groups.map((g) => {
              const pts = g.values.map((v, i) => (num(v) ? `${nx(i)},${ny(v)}` : null)).filter(Boolean) as string[];
              if (pts.length < 2) return null;
              return <polyline key={g.label} points={pts.join(" ")} fill="none" stroke={H.bar} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />;
            })}
          </svg>
          {/* markers + labels (non-scaling, so use an overlay of absolutely-placed dots) */}
          {groups.map((g) =>
            g.values.map((v, i) =>
              num(v) ? (
                <div
                  key={`${g.label}-${i}`}
                  title={`${cycles[i]?.name} · ${g.label}: ${fmt(v)}`}
                  style={{
                    position: "absolute",
                    left: `${nx(i)}%`,
                    top: `${ny(v)}%`,
                    width: 8,
                    height: 8,
                    marginLeft: -4,
                    marginTop: -4,
                    borderRadius: 999,
                    background: i === cycles.length - 1 ? H.pink : H.paper,
                    border: `1.5px solid ${i === cycles.length - 1 ? H.pink : H.bar}`,
                  }}
                />
              ) : null,
            ),
          )}
          {/* right-edge subject labels at the newest value */}
          {groups.map((g) => {
            const v = g.values[g.values.length - 1];
            return num(v) ? (
              <span key={`lbl-${g.label}`} className="hf-mono" style={{ position: "absolute", right: 2, top: `${ny(v)}%`, marginTop: -7, fontSize: 8.5, color: H.ink2, background: `${H.paper}cc`, padding: "0 2px", borderRadius: 2 }}>{g.label}</span>
            ) : null;
          })}
        </div>
      </div>
      <XLabels labels={cycles.map((c) => c.name)} />
    </div>
  );
}

export interface ItemGroup {
  label: string;
  usable: (number | null)[];
  removed: (number | null)[];
}

// ── usable vs removed items: stacked, one stack per cycle per subject ────────
export function StackedItems({
  groups,
  cycles,
  max,
  ticks,
}: {
  groups: ItemGroup[];
  cycles: CycleMeta[];
  max: number;
  ticks: number[];
}) {
  return (
    <div>
      <VPlot max={max} ticks={ticks} fmt={(v) => String(v)}>
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "space-around", alignItems: "flex-end" }}>
          {groups.map((g) => (
            <div key={g.label} style={{ display: "flex", alignItems: "flex-end", gap: 4, height: "100%" }}>
              {cycles.map((cy, ci) => {
                const u = g.usable[ci] ?? 0;
                const r = g.removed[ci] ?? 0;
                const total = u + r;
                return (
                  <div key={ci} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }} title={`${cy.name} · ${g.label}: ${u} usable, ${r} removed`}>
                    <span className="hf-mono" style={{ fontSize: 8.5, color: H.ink3, marginBottom: 2 }}>{total}</span>
                    <div style={{ width: 16, height: `${(total / max) * 100}%`, display: "flex", flexDirection: "column", justifyContent: "flex-end", borderRadius: "2px 2px 0 0", overflow: "hidden" }}>
                      <div style={{ height: total ? `${(r / total) * 100}%` : 0, background: H.warn }} />
                      <div style={{ height: total ? `${(u / total) * 100}%` : 0, background: cycleColor(ci, cycles.length), opacity: cy.mock ? 0.85 : 1 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </VPlot>
      <XLabels labels={groups.map((g) => g.label)} />
    </div>
  );
}

// ── single-subject focus: 100%-stacked performance levels, one col per cycle ──
export function PerfLevels({
  levels,
  cycles,
  counts,
}: {
  levels: string[];
  cycles: CycleMeta[];
  counts: number[][]; // [levelIdx][cycleIdx]
}) {
  const totals = cycles.map((_, ci) => levels.reduce((s, _l, li) => s + (counts[li]?.[ci] ?? 0), 0));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "flex-end", height: PLOT_H, gap: 18 }}>
        {cycles.map((cy, ci) => {
          const total = totals[ci] ?? 0;
          return (
            <div key={ci} style={{ display: "flex", flexDirection: "column", alignItems: "center", height: "100%", width: 64 }}>
              <div style={{ flex: 1, width: 40, display: "flex", flexDirection: "column", borderRadius: 4, overflow: "hidden", border: `1px solid ${H.line2}` }}>
                {levels.map((lvl, li) => {
                  const c = counts[li]?.[ci] ?? 0;
                  const pct = total ? (c / total) * 100 : 0;
                  return <div key={lvl} style={{ height: `${pct}%`, background: awardRamp(li, levels.length) }} title={`${cy.name} · ${lvl}: ${c}`} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-around", marginTop: 6, gap: 18 }}>
        {cycles.map((cy, ci) => (
          <span key={ci} className="hf-mono" style={{ width: 64, textAlign: "center", fontSize: 9.5, fontWeight: ci === cycles.length - 1 ? 700 : 500, color: ci === cycles.length - 1 ? H.pink : H.ink2 }}>{cy.name}</span>
        ))}
      </div>
      <div className="hf-row" style={{ flexWrap: "wrap", gap: 12, marginTop: 12, justifyContent: "center" }}>
        {levels.map((lvl, li) => (
          <span key={lvl} className="hf-row" style={{ gap: 5, alignItems: "center", fontSize: 10, color: H.ink2 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: awardRamp(li, levels.length) }} />
            {lvl}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface CutRow {
  name: string;
  values: (number | null)[]; // raw cut per cycle
}

// ── single-subject focus: cut-scores moving across cycles, on a raw-score axis ─
export function CutScores({
  cuts,
  cycles,
  scoreMax,
}: {
  cuts: CutRow[];
  cycles: CycleMeta[];
  scoreMax: number;
}) {
  return (
    <div className="hf-col" style={{ gap: 14 }}>
      {cuts.map((cut) => (
        <div key={cut.name} className="hf-col" style={{ gap: 5 }}>
          <span className="hf-sub" style={{ fontSize: 11, fontWeight: 600, color: H.ink2 }}>{cut.name}</span>
          <div style={{ position: "relative", height: 18, background: H.tint2, borderRadius: 5 }}>
            {[0.25, 0.5, 0.75].map((t) => (
              <div key={t} style={{ position: "absolute", left: `${t * 100}%`, top: 0, bottom: 0, width: 1, background: H.line }} />
            ))}
            {cut.values.map((v, ci) =>
              num(v) ? (
                <div
                  key={ci}
                  title={`${cycles[ci]?.name}: ${v} / ${scoreMax}`}
                  style={{
                    position: "absolute",
                    left: `${(v / Math.max(1, scoreMax)) * 100}%`,
                    top: -3,
                    bottom: -3,
                    width: 11,
                    height: 24,
                    marginLeft: -5.5,
                    borderRadius: 999,
                    background: ci === cycles.length - 1 ? H.pink : H.paper,
                    border: `2px solid ${ci === cycles.length - 1 ? H.pink : H.bar}`,
                  }}
                />
              ) : null,
            )}
          </div>
        </div>
      ))}
      <div className="hf-row" style={{ justifyContent: "space-between" }}>
        <span className="hf-mono" style={{ fontSize: 9, color: H.ink3 }}>0</span>
        <span className="hf-mono" style={{ fontSize: 9, color: H.ink3 }}>{scoreMax} marks</span>
      </div>
    </div>
  );
}
