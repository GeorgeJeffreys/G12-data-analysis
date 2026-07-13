"use client";

/**
 * The four Overall sections, each led by its focused question and adapting to the
 * active slice. Ported from design/hfOverallSections.jsx to TSX; the mock
 * constants are replaced by the `OverallAnalytics` read-model threaded in as
 * props. Locked variants preserved: §2 = subject selector (Combined → levels,
 * single sitting → score stats), §3 = 100% stacked columns, §4 = cross-centre
 * comparison (disabled under a single centre).
 */
import { useEffect, useState, type ReactNode } from "react";
import { H } from "@/lib/ui/tokens";
import { Icon } from "@/components/ui/icons";
import type { AwardDistYear, OverallAnalytics, ParticipationYear, SubjectYear } from "@/lib/data/types";
import {
  awardRamp,
  centreLabel,
  levelPass,
  OVDelta,
  OVDumbbell,
  OVFunnel,
  OVKpi,
  OVLine,
  OVRampLegend,
  OVRangeBand,
  OVSpark,
  OVStackBar,
  OVStackCols,
  plevelRamp,
  sliceEffects,
  activeCentreCount,
  type LegacySlice,
} from "./kit";

// ── small shared helpers ─────────────────────────────────────────────────────
const ZERO_PART: ParticipationYear = { centres: 0, satFeb: 0, satMay: 0, both: 0, passFeb: 0, passMay: 0, passComb: 0 };
const deltaStr = (n: number): string => (n >= 0 ? `+${round(n)}` : `−${Math.abs(round(n))}`);
const round = (n: number): number => Math.round(n * 10) / 10;

/** Resolve the selected live years to a sorted list + cur/prev pointers. */
function resolveYears(slice: LegacySlice, analytics: OverallAnalytics): { ys: number[]; cur: number; prev: number | null } {
  const ys = (slice.years.length ? [...slice.years] : [...analytics.years]).sort((a, b) => a - b);
  const cur = ys[ys.length - 1] ?? analytics.years[analytics.years.length - 1] ?? 0;
  const prev = ys.length >= 2 ? ys[ys.length - 2]! : null;
  return { ys, cur, prev };
}

/** A padded, clamped 0–100 range that frames the given values with headroom. */
function niceRange(values: number[], pad = 5): { min: number; max: number } {
  const vs = values.filter((v) => Number.isFinite(v));
  if (!vs.length) return { min: 0, max: 100 };
  const lo = Math.max(0, Math.floor((Math.min(...vs) - pad) / 5) * 5);
  const hi = Math.min(100, Math.ceil((Math.max(...vs) + pad) / 5) * 5);
  return { min: lo, max: hi === lo ? Math.min(100, lo + 5) : hi };
}

/** Which centres a slice actively selects (mirrors the read-model's grouping). */
function activeCentres(slice: LegacySlice, analytics: OverallAnalytics): string[] {
  const c = slice.centre;
  let names = analytics.centres;
  if (c.mode === "single") names = c.sel.slice(0, 1);
  else if (c.mode === "subset") names = c.sel;
  else if (c.mode === "exclude") names = analytics.centres.filter((x) => !c.sel.includes(x));
  return names.length ? names.filter((n) => analytics.centres.includes(n)) : analytics.centres;
}

export function OVCard({
  title,
  sub,
  children,
  style,
  pad = "17px 19px",
  flex,
  right,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  style?: React.CSSProperties;
  pad?: string;
  flex?: number;
  right?: ReactNode;
}) {
  return (
    <div className="hf-card" style={{ padding: pad, flex, minWidth: 0, ...style }}>
      {(title || right) && (
        <div className="hf-row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: sub ? 3 : 12, gap: 10 }}>
          {title && <div className="hf-lbl">{title}</div>}
          {right}
        </div>
      )}
      {sub && <div className="hf-sub" style={{ fontSize: 11.5, marginBottom: 13 }}>{sub}</div>}
      {children}
    </div>
  );
}

/** Slice-adaptation note chip (adapt / disable / annotate). */
export function OVNote({ tone = "info", children }: { tone?: "info" | "warn" | "accent"; children: ReactNode }) {
  const c = tone === "warn" ? [H.warn, H.warnSoft] : tone === "accent" ? [H.pink, H.pinkSoft] : [H.ink2, H.tint2];
  return (
    <span className="hf-row" style={{ gap: 6, fontSize: 10.5, fontWeight: 700, color: c[0], background: c[1], padding: "4px 9px", borderRadius: 6, letterSpacing: ".2px", whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: c[0] }} />
      {children}
    </span>
  );
}

// ════ SECTION 1 · Participation ═══════════════════════════════════════════════
export function S1Participation({ analytics, slice }: { analytics: OverallAnalytics; slice: LegacySlice }) {
  const eff = sliceEffects(slice, analytics);
  const { ys, cur, prev } = resolveYears(slice, analytics);
  const p = analytics.participation[cur] ?? ZERO_PART;
  const p0 = prev != null ? analytics.participation[prev] ?? null : null;
  const funnel = [
    { k: "Sat February", v: p.satFeb },
    { k: "Sat May", v: p.satMay },
    { k: "Completed both", v: p.both },
  ];
  const passKey: keyof ParticipationYear = slice.exam === "February" ? "passFeb" : slice.exam === "May" ? "passMay" : "passComb";
  const passLabel = slice.exam === "Combined" ? "Combined pass rate" : `${slice.exam} pass rate`;
  const centreCount = eff.singleCentre ? 1 : activeCentreCount(slice.centre, analytics.centres.length);
  const bothPct = p.satFeb ? Math.round((p.both / p.satFeb) * 100) : 0;
  const bothPct0 = p0 && p0.satFeb ? Math.round((p0.both / p0.satFeb) * 100) : null;

  // Trend series across all selected years, for each sitting.
  const passSeriesKeys: [string, keyof ParticipationYear, string][] = [
    ["February", "passFeb", H.bar],
    ["May", "passMay", H.slate],
    ["Combined", "passComb", H.pink],
  ];
  const trendPts = passSeriesKeys.flatMap(([, k]) => ys.map((y) => analytics.participation[y]?.[k] ?? 0));
  const range = niceRange(trendPts);

  return (
    <div className="hf-col" style={{ gap: 16 }}>
      <div className="hf-row" style={{ gap: 14, flexWrap: "wrap" }}>
        <OVKpi label="Partner centres" value={centreCount} delta={p0 && !eff.singleCentre ? deltaStr(p.centres - p0.centres) : null} pts={[p0?.centres ?? p.centres, p.centres]} accent />
        <OVKpi label="Candidates who sat" value={p.satFeb} delta={p0 ? deltaStr(p.satFeb - p0.satFeb) : null} pts={[p0?.satFeb ?? p.satFeb, p.satFeb]} />
        <OVKpi label="Completed both sittings" value={p.both} delta={p0 ? deltaStr(p.both - p0.both) : null} pts={[p0?.both ?? p.both, p.both]} />
        <OVKpi label={passLabel} value={p[passKey]} unit="%" delta={p0 ? deltaStr(p[passKey] - p0[passKey]) : null} pts={[p0?.[passKey] ?? p[passKey], p[passKey]]} accent />
      </div>
      <div className="hf-row" style={{ gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
        <OVCard title={`The progression — ${cur}`} sub="Sat February → sat May → completed both. Attrition measured off sat February." flex={1.25} style={{ minWidth: 320 }}>
          <OVFunnel steps={funnel} />
          <div className="hf-sub" style={{ fontSize: 11, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${H.line}` }}>
            <span className="hf-mono" style={{ color: H.ink }}>{bothPct}%</span> of February sitters completed both sittings
            {bothPct0 != null && (
              <>
                {" "}— {bothPct >= bothPct0 ? "up" : "down"} from <span className="hf-mono">{bothPct0}%</span> in {prev}.
              </>
            )}
          </div>
        </OVCard>
        <OVCard title="Pass rate over time" sub={`Pass = any award above Record of Learning. ${slice.exam} highlighted.`} flex={1} style={{ minWidth: 320 }} right={!eff.trend ? <OVNote tone="warn">single year · {cur}</OVNote> : undefined}>
          {eff.trend ? (
            <OVLine
              w={430}
              h={186}
              yMin={range.min}
              yMax={range.max}
              xLabels={ys.map(String)}
              fmt={(v) => `${v}%`}
              series={passSeriesKeys.map(([k, key, color]) => ({
                key: k,
                pts: ys.map((y) => analytics.participation[y]?.[key] ?? 0),
                color,
                width: k === slice.exam ? 3 : 2,
                dim: k !== slice.exam,
              }))}
            />
          ) : (
            <OVLine w={430} h={186} yMin={0} yMax={100} xLabels={["February", "May", "Combined"]} fmt={(v) => `${v}%`} bars={[p.passFeb, p.passMay, p.passComb]} dots={false} />
          )}
          <div className="hf-row" style={{ gap: 16, marginTop: 8, justifyContent: "center", flexWrap: "wrap" }}>
            {passSeriesKeys.map(([k, , c]) => (
              <span key={k} className="hf-row" style={{ gap: 5, fontSize: 11, color: H.ink2, opacity: eff.trend && k !== slice.exam ? 0.5 : 1 }}>
                <span style={{ width: 14, height: 3, borderRadius: 2, background: c }} />
                {k}
              </span>
            ))}
          </div>
        </OVCard>
      </div>
    </div>
  );
}

// ════ SECTION 2 · Performance by subject (LOCKED: subject selector) ═══════════
export function S2Performance({ analytics, slice }: { analytics: OverallAnalytics; slice: LegacySlice }) {
  const eff = sliceEffects(slice, analytics);
  const { ys, cur, prev } = resolveYears(slice, analytics);
  // Only the SELECTED subjects are shown / focusable (the slicer's multi-select).
  const subjects = analytics.subjects.filter((s) => slice.subjects.includes(s.key));
  const first = subjects[0]?.key ?? "";
  const [localSubj, setLocalSubj] = useState<string>(slice.subject || first);
  useEffect(() => {
    if (slice.subject) setLocalSubj(slice.subject);
  }, [slice.subject]);
  const sel = subjects.some((s) => s.key === localSubj) ? localSubj : first;
  const su = subjects.find((s) => s.key === sel);
  const yr: Record<number, SubjectYear> = analytics.perf[sel] ?? {};
  const a = prev != null ? yr[prev] ?? null : null;
  const b = yr[cur] ?? null;
  const sitting = eff.examSitting;
  const showLevels = eff.s2Levels;
  const emptyLevels = { out: 0, exc: 0, meet: 0, not: 0 };
  const plRamp = plevelRamp(analytics.plevels);

  if (!su || !b) {
    return <div className="hf-sub">No performance data for the current slice.</div>;
  }
  const sb = b[sitting];
  const sa = a ? a[sitting] : null;

  return (
    <div className="hf-col" style={{ gap: 16 }}>
      <div className="hf-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {subjects.map((s) => (
          <span key={s.key} className={`hf-chip ${s.key === sel ? "on" : ""}`} onClick={() => setLocalSubj(s.key)} style={{ cursor: "pointer" }}>
            {s.short}
          </span>
        ))}
        <div style={{ flex: 1 }} />
        {showLevels ? <OVNote tone="accent">Combined · best-of-two performance levels (no combined score exists)</OVNote> : <OVNote>{slice.exam} sitting · score statistics</OVNote>}
      </div>
      <div className="hf-row" style={{ gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
        {showLevels ? (
          <OVCard title={`${su.name} · best-of-two levels`} sub="Distribution of each student's higher level across the two sittings." flex={1} style={{ minWidth: 300 }}>
            <div className="hf-col" style={{ gap: 14 }}>
              {[...(a ? [[String(prev), a.levels] as const] : []), [String(cur), b.levels] as const].map(([yl, d]) => (
                <div key={yl} className="hf-col" style={{ gap: 6 }}>
                  <div className="hf-row" style={{ justifyContent: "space-between" }}>
                    <span className="hf-mono" style={{ fontSize: 11, color: H.ink2 }}>{yl}</span>
                    <span className="hf-mono" style={{ fontSize: 11, color: H.pink, fontWeight: 700 }}>{levelPass(d)}% Meets+</span>
                  </div>
                  <OVStackBar dist={d} ramp={plRamp} h={26} labels />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${H.line}` }}>
              <OVRampLegend ramp={plRamp} />
            </div>
          </OVCard>
        ) : sb ? (
          <OVCard title={`${su.name} · snapshot`} sub={`${slice.exam} sitting, ${cur}${prev != null ? ` (Δ vs ${prev})` : ""}`} flex={1} style={{ minWidth: 300 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {([
                ["Mean", sb.mean, sa ? sb.mean - sa.mean : 0, "up"],
                ["Median", sb.median, sa ? sb.median - sa.median : 0, "up"],
                ["Highest", sb.high, sa ? sb.high - sa.high : 0, "up"],
                ["Lowest", sb.low, sa ? sb.low - sa.low : 0, "up"],
                ["Std. dev", sb.sd, sa ? +(sb.sd - sa.sd).toFixed(1) : 0, "down"],
                ["Pass rate", `${sb.pass}%`, sa ? sb.pass - sa.pass : 0, "up"],
              ] as [string, ReactNode, number, "up" | "down"][]).map(([k, v, d, g]) => (
                <div key={k} className="hf-col" style={{ gap: 3 }}>
                  <span className="hf-lbl" style={{ fontSize: 8.5 }}>{k}</span>
                  <span className="hf-mono" style={{ fontSize: 21, fontWeight: 600, color: H.ink }}>{v}</span>
                  <OVDelta v={d} good={g} size={10} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${H.line}` }}>
              <span className="hf-lbl" style={{ fontSize: 8.5 }}>Range, lowest → highest</span>
              <div style={{ position: "relative", height: 30, marginTop: 8 }}>
                <div style={{ position: "absolute", top: 13, left: 0, right: 0, height: 4, borderRadius: 3, background: H.tint2 }} />
                <div style={{ position: "absolute", top: 13, left: `${sb.low}%`, width: `${Math.max(0, sb.high - sb.low)}%`, height: 4, borderRadius: 3, background: H.slate }} />
                <div style={{ position: "absolute", top: 8, left: `${sb.mean}%`, width: 3, height: 14, marginLeft: -1.5, background: H.pink }} title="mean" />
                {[sb.low, sb.high].map((x, i) => (
                  <span key={i} className="hf-mono" style={{ position: "absolute", top: 0, left: `${x}%`, transform: "translateX(-50%)", fontSize: 10, color: H.ink2 }}>{x}</span>
                ))}
              </div>
            </div>
          </OVCard>
        ) : (
          <OVCard title={`${su.name} · snapshot`} flex={1} style={{ minWidth: 300 }}>
            <OVNote tone="warn">No {slice.exam} sitting recorded for {cur}</OVNote>
          </OVCard>
        )}

        {/* trend */}
        <OVCard title={showLevels ? "Meets+ over time" : "Mean over time"} sub={showLevels ? "share at Meets or above" : "band = lowest–highest cohort range"} flex={1} style={{ minWidth: 300 }}>
          {showLevels ? (
            <OVLine
              w={340}
              h={200}
              yMin={40}
              yMax={100}
              xLabels={ys.map(String)}
              fmt={(v) => `${v}%`}
              series={[{ pts: ys.map((y) => levelPass(yr[y]?.levels ?? emptyLevels)), color: H.pink, width: 2.6 }]}
            />
          ) : (
            <OVLine
              w={340}
              h={200}
              yMin={15}
              yMax={100}
              xLabels={ys.map(String)}
              band={{ hi: ys.map((y) => yr[y]?.[sitting]?.high ?? 0), lo: ys.map((y) => yr[y]?.[sitting]?.low ?? 0), color: H.tint2 }}
              series={[
                { pts: ys.map((y) => yr[y]?.[sitting]?.mean ?? 0), color: H.pink, width: 2.6 },
                { pts: ys.map((y) => yr[y]?.[sitting]?.median ?? 0), color: H.slate, width: 2, dashed: true },
              ]}
            />
          )}
          {!showLevels && (
            <div className="hf-row" style={{ gap: 16, justifyContent: "center", marginTop: 6 }}>
              <span className="hf-row" style={{ gap: 5, fontSize: 11, color: H.ink2 }}><span style={{ width: 14, height: 3, background: H.pink, borderRadius: 2 }} />Mean</span>
              <span className="hf-row" style={{ gap: 5, fontSize: 11, color: H.ink2 }}><span style={{ width: 14, height: 3, background: H.slate, borderRadius: 2 }} />Median</span>
            </div>
          )}
        </OVCard>

        {/* CHANGE — level movement, not points */}
        <OVCard title="Movement Feb → May" sub={`same students, within ${cur}`} flex={0.85} style={{ background: H.pinkSoft2, borderColor: H.pinkSoft, minWidth: 220 }}>
          {b.change ? (
            <div className="hf-col" style={{ gap: 18, marginTop: 4 }}>
              <div className="hf-col" style={{ gap: 3 }}>
                <span className="hf-mono" style={{ fontSize: 32, fontWeight: 600, color: H.pink, lineHeight: 1 }}>+{b.change.gain}</span>
                <span className="hf-lbl">avg performance levels</span>
                {a?.change && <span className="hf-sub" style={{ fontSize: 11 }}>up from +{a.change.gain} in {prev}</span>}
              </div>
              <div className="hf-col" style={{ gap: 6 }}>
                <div className="hf-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="hf-mono" style={{ fontSize: 32, fontWeight: 600, color: H.ink, lineHeight: 1 }}>{b.change.up}%</span>
                  {a?.change && <OVDelta v={b.change.up - a.change.up} good="up" size={11} />}
                </div>
                <span className="hf-lbl">moved up ≥1 level</span>
                <div style={{ height: 8, borderRadius: 4, background: H.paper, overflow: "hidden", marginTop: 2 }}>
                  <div style={{ width: `${b.change.up}%`, height: "100%", background: H.pink }} />
                </div>
              </div>
            </div>
          ) : (
            <OVNote tone="warn">needs both sittings</OVNote>
          )}
        </OVCard>
      </div>
    </div>
  );
}

// ════ SECTION 3 · Award distribution (LOCKED: 100% stacked columns) ═══════════
export function S3Award({ analytics, slice }: { analytics: OverallAnalytics; slice: LegacySlice }) {
  const eff = sliceEffects(slice, analytics);
  const { ys, cur, prev } = resolveYears(slice, analytics);
  const centreNames = activeCentres(slice, analytics);
  const ramp = awardRamp(analytics.awards);
  const asRec = (d: AwardDistYear | undefined): Record<string, number> => (d ? { dist: d.dist, adv: d.adv, sec: d.sec, rol: d.rol } : {});

  // Cohort shape over time. Single centre: per-centre history isn't available, so
  // the current year comes from awardByCentre and the prior from all-centre dist.
  const singleName = centreNames[0];
  const overTimeYears = eff.singleCentre ? (prev != null ? [prev, cur] : [cur]) : ys;
  const overTimeData: Record<string, Record<string, number>> = {};
  for (const y of overTimeYears) {
    if (eff.singleCentre && y === cur) overTimeData[String(y)] = asRec((singleName && analytics.awardByCentre[singleName]) || analytics.awardDist[y]);
    else overTimeData[String(y)] = asRec(analytics.awardDist[y]);
  }

  return (
    <div className="hf-row" style={{ gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
      <OVCard
        title="Cohort shape over time"
        sub="Share of candidates in each award band — 100% stacked, one column per year."
        flex={0.7}
        style={{ minWidth: 260 }}
        right={eff.singleCentre ? <OVNote tone="warn">single centre</OVNote> : undefined}
      >
        <OVStackCols years={overTimeYears} data={overTimeData} ramp={ramp} h={220} colW={60} labelYear={(y) => String(y)} />
        {eff.singleCentre && <div className="hf-sub" style={{ fontSize: 10.5, marginTop: 8 }}>{singleName} only — {cur} shown; per-centre history builds as cycles accumulate.</div>}
      </OVCard>
      <OVCard
        title={`By centre · ${cur}`}
        sub={eff.singleCentre ? "One centre selected." : `${centreNames.length} centre${centreNames.length > 1 ? "s" : ""}, one stacked column each.`}
        flex={1.6}
        style={{ minWidth: 320 }}
        right={<OVRampLegend ramp={ramp} />}
      >
        <OVStackCols years={centreNames} data={(name) => asRec(analytics.awardByCentre[name as string] || analytics.awardDist[cur])} ramp={ramp} h={220} colW={centreNames.length > 4 ? 52 : 66} labelYear={(name) => (String(name).length > 10 ? String(name).slice(0, 10) + "…" : String(name))} />
      </OVCard>
    </div>
  );
}

// ════ SECTION 4 · Partner-centre comparison ═══════════════════════════════════
export function S4Centres({ analytics, slice }: { analytics: OverallAnalytics; slice: LegacySlice }) {
  const eff = sliceEffects(slice, analytics);
  const { cur, prev } = resolveYears(slice, analytics);
  if (!eff.s4Enabled) {
    return (
      <div className="hf-card" style={{ padding: "34px 30px", display: "flex", gap: 18, alignItems: "center", background: H.tint, flexWrap: "wrap" }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: H.tint2, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
          <Icon name="filter" size={22} color={H.ink3} />
        </div>
        <div className="hf-col" style={{ gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: H.ink }}>Cross-centre comparison needs at least two centres.</span>
          <span className="hf-sub">
            Your slice selects <span style={{ fontWeight: 700, color: H.ink2 }}>{centreLabel(slice.centre, analytics.centres.length)}</span>. Widen the centre filter to compare spread and convergence.
          </span>
        </div>
      </div>
    );
  }
  const spread = analytics.centreAwardSpread;
  const s1 = spread[cur] ?? { best: 0, worst: 0, mean: 0 };
  const s0 = prev != null ? spread[prev] ?? null : null;
  const range1 = round(s1.best - s1.worst);
  const range0 = s0 ? round(s0.best - s0.worst) : null;
  const bandYears = prev != null ? [prev, cur] : [cur];

  // Per-centre "Advanced+" (Distinction + Advanced) for the current year.
  const centres = activeCentres(slice, analytics);
  const advVals = centres.map((c) => {
    const d = analytics.awardByCentre[c];
    return { c, v: (d?.dist ?? 0) + (d?.adv ?? 0) };
  });
  const maxAdv = Math.max(...advVals.map((r) => r.v));
  const minAdv = Math.min(...advVals.map((r) => r.v));
  const dumbRows = advVals.map((r) => ({ k: r.c, v: r.v, hi: r.v === maxAdv, lo: r.v === minAdv }));

  const rows = analytics.subjects
    .filter((su) => slice.subjects.includes(su.key))
    .map((su) => {
      const d = analytics.centreSubjectSpread[su.key] ?? {};
      return { su, a: prev != null ? d[prev] ?? null : null, b: d[cur] ?? { mean: 0, best: 0, worst: 0, sd: 0 } };
    });
  const allVals = rows.flatMap((r) => [r.b.worst, r.b.best]);
  const gmin = Math.max(0, Math.floor((Math.min(...allVals, 100) - 5) / 5) * 5);
  const gmax = Math.min(100, Math.ceil((Math.max(...allVals, 0) + 5) / 5) * 5);
  const pos = (v: number) => ((v - gmin) / ((gmax - gmin) || 1)) * 100;

  return (
    <div className="hf-row" style={{ gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
      {/* View A */}
      <OVCard title="View A · by award level" sub="% reaching Advanced Achievement or above, across centres." flex={1} style={{ minWidth: 340 }} right={eff.s4Count < analytics.centres.length ? <OVNote>{eff.s4Count} centres</OVNote> : undefined}>
        <div className="hf-row" style={{ gap: 18, alignItems: "stretch", flexWrap: "wrap" }}>
          <div className="hf-col" style={{ flex: 1, minWidth: 260 }}>
            <OVRangeBand years={bandYears} best={bandYears.map((y) => (spread[y]?.best ?? 0))} worst={bandYears.map((y) => (spread[y]?.worst ?? 0))} mean={bandYears.map((y) => (spread[y]?.mean ?? 0))} w={330} h={196} yMin={Math.max(0, gmin - 10)} yMax={Math.min(100, gmax)} />
            <div className="hf-row" style={{ gap: 12, justifyContent: "center", marginTop: 4, flexWrap: "wrap" }}>
              {[["Best centre", H.slate], ["Worst centre", H.bar], ["Mean", H.pink]].map(([k, c]) => (
                <span key={k} className="hf-row" style={{ gap: 5, fontSize: 10.5, color: H.ink2 }}><span style={{ width: 14, height: 3, background: c, borderRadius: 2 }} />{k}</span>
              ))}
            </div>
          </div>
          <div className="hf-col" style={{ flex: 1, gap: 12, borderLeft: `1px solid ${H.line}`, paddingLeft: 18, minWidth: 240 }}>
            <div className="hf-row" style={{ gap: 12, alignItems: "baseline" }}>
              <div className="hf-col" style={{ gap: 2 }}>
                <span className="hf-mono" style={{ fontSize: 30, fontWeight: 600, color: H.good }}>{range1}<span style={{ fontSize: 15 }}>pts</span></span>
                <span className="hf-lbl" style={{ fontSize: 8.5 }}>best–worst gap, {cur}</span>
              </div>
              {range0 != null && <span className="hf-mono" style={{ fontSize: 12, color: range1 <= range0 ? H.good : H.bad }}>{range1 <= range0 ? "▼" : "▲"} from {range0}pts</span>}
            </div>
            {range0 != null && (
              <div className="hf-sub" style={{ fontSize: 11.5 }}>
                The gap {range1 <= range0 ? "narrowed" : "widened"} <span className="hf-mono" style={{ color: H.ink }}>{range0} → {range1}</span> points{range1 <= range0 ? " — convergence" : ""}, with the weakest centre {s0 && s1.worst >= s0.worst ? "rising" : "moving"} ({s0?.worst ?? "—"}% → {s1.worst}%).
              </div>
            )}
            <span className="hf-lbl" style={{ fontSize: 8.5, marginTop: 2 }}>Centres, {cur} (Advanced+)</span>
            <OVDumbbell rows={dumbRows} min={Math.max(0, minAdv - 10)} max={Math.min(100, maxAdv + 10)} />
          </div>
        </div>
      </OVCard>
      {/* View B */}
      <OVCard title="View B · by subject" sub={`Mean centre score, best & worst centre, spread (σ across centres) — ${cur}${prev != null ? ` vs ${prev}` : ""}.`} flex={1} style={{ minWidth: 340 }}>
        <div className="hf-col" style={{ gap: 0 }}>
          <div className="hf-row" style={{ gap: 12, padding: "0 0 8px", borderBottom: `1px solid ${H.line2}` }}>
            <span style={{ width: 96, flex: "0 0 auto" }} />
            <span className="hf-lbl" style={{ flex: 1, fontSize: 8.5 }}>worst ——— mean ● ——— best</span>
            <span className="hf-lbl" style={{ width: 116, flex: "0 0 auto", fontSize: 8.5, textAlign: "right" }}>σ across centres</span>
          </div>
          {rows.map(({ su, a, b }, i) => (
            <div key={su.key} className="hf-row" style={{ gap: 12, padding: "12px 0", borderBottom: i < rows.length - 1 ? `1px solid ${H.line}` : "none" }}>
              <span style={{ width: 96, flex: "0 0 auto", fontSize: 12, fontWeight: 600, color: H.ink }}>{su.short}</span>
              <div style={{ flex: 1, position: "relative", height: 26 }}>
                {a && <div style={{ position: "absolute", top: 6, left: `${pos(a.worst)}%`, width: `${Math.max(0, pos(a.best) - pos(a.worst))}%`, height: 3, borderRadius: 2, background: H.line2 }} />}
                <div style={{ position: "absolute", top: 15, left: `${pos(b.worst)}%`, width: `${Math.max(0, pos(b.best) - pos(b.worst))}%`, height: 5, borderRadius: 3, background: H.tint2 }} />
                <div style={{ position: "absolute", top: 14.5, left: `${pos(b.worst)}%`, width: 3, height: 6, background: H.bar }} />
                <div style={{ position: "absolute", top: 14.5, left: `${pos(b.best)}%`, width: 3, height: 6, background: H.slate }} />
                <div style={{ position: "absolute", top: 12, left: `${pos(b.mean)}%`, width: 10, height: 10, marginLeft: -5, borderRadius: 999, background: H.pink, border: "2px solid #fff", boxShadow: "0 1px 2px rgba(0,0,0,.15)" }} title={`mean ${b.mean}`} />
                <span className="hf-mono" style={{ position: "absolute", top: 0, left: `${pos(b.worst)}%`, transform: "translateX(-50%)", fontSize: 9.5, color: H.ink3 }}>{b.worst}</span>
                <span className="hf-mono" style={{ position: "absolute", top: 0, left: `${pos(b.best)}%`, transform: "translateX(-50%)", fontSize: 9.5, color: H.ink3 }}>{b.best}</span>
              </div>
              <div className="hf-row" style={{ width: 116, flex: "0 0 auto", gap: 8, justifyContent: "flex-end", alignItems: "baseline" }}>
                <span className="hf-mono" style={{ fontSize: 15, fontWeight: 600, color: H.ink }}>{b.sd}</span>
                {a && <OVDelta v={+(b.sd - a.sd).toFixed(1)} good="down" size={10.5} />}
              </div>
            </div>
          ))}
        </div>
      </OVCard>
    </div>
  );
}

// ── headlines for collapsed states (answer the question at a glance) ──────────
export interface Headline {
  value: string;
  label: string;
  delta?: string | null;
  deltaGood?: boolean;
  spark?: number[];
  good?: boolean;
  disabled?: boolean;
}

export function partHeadline(analytics: OverallAnalytics, slice: LegacySlice): Headline {
  const { cur, prev } = resolveYears(slice, analytics);
  const p = analytics.participation[cur] ?? ZERO_PART;
  const p0 = prev != null ? analytics.participation[prev] ?? null : null;
  const c = p.satFeb ? Math.round((p.both / p.satFeb) * 100) : 0;
  const c0 = p0 && p0.satFeb ? Math.round((p0.both / p0.satFeb) * 100) : null;
  return { value: `${c}%`, label: "completed both", delta: c0 != null ? deltaStr(c - c0) : null, deltaGood: true, spark: [c0 ?? c, c] };
}

export function perfHeadline(analytics: OverallAnalytics, slice: LegacySlice): Headline {
  const eff = sliceEffects(slice, analytics);
  const { cur, prev } = resolveYears(slice, analytics);
  // Aggregate over the SELECTED subjects only (falls back to all if none match).
  const subs = analytics.subjects.filter((s) => slice.subjects.includes(s.key));
  const used = subs.length ? subs : analytics.subjects;
  const n = Math.max(1, used.length);
  if (eff.s2Levels) {
    const curV = Math.round(used.reduce((acc, s) => acc + levelPass(analytics.perf[s.key]?.[cur]?.levels ?? { out: 0, exc: 0, meet: 0, not: 0 }), 0) / n);
    const prevV = prev != null ? Math.round(used.reduce((acc, s) => acc + levelPass(analytics.perf[s.key]?.[prev]?.levels ?? { out: 0, exc: 0, meet: 0, not: 0 }), 0) / n) : null;
    return { value: `${curV}%`, label: "at Meets or above", delta: prevV != null ? deltaStr(curV - prevV) : null, deltaGood: true, spark: [prevV ?? curV, curV] };
  }
  const sit = eff.examSitting;
  const curV = Math.round(used.reduce((acc, s) => acc + (analytics.perf[s.key]?.[cur]?.[sit]?.mean ?? 0), 0) / n);
  const prevV = prev != null ? Math.round(used.reduce((acc, s) => acc + (analytics.perf[s.key]?.[prev]?.[sit]?.mean ?? 0), 0) / n) : null;
  return { value: `${curV}%`, label: "average subject mean", delta: prevV != null ? deltaStr(curV - prevV) : null, deltaGood: true, spark: [prevV ?? curV, curV] };
}

export function awardHeadline(analytics: OverallAnalytics, slice: LegacySlice): Headline {
  const { cur, prev } = resolveYears(slice, analytics);
  const d = analytics.awardDist[cur] ?? { dist: 0, adv: 0, sec: 0, rol: 0 };
  const d0 = prev != null ? analytics.awardDist[prev] ?? null : null;
  const t = Math.round(d.dist + d.adv);
  const t0 = d0 ? Math.round(d0.dist + d0.adv) : null;
  return { value: `${t}%`, label: "in the top two bands", delta: t0 != null ? deltaStr(t - t0) : null, deltaGood: true, spark: [t0 ?? t, t] };
}

export function centreHeadline(analytics: OverallAnalytics, slice: LegacySlice): Headline {
  const eff = sliceEffects(slice, analytics);
  const { cur, prev } = resolveYears(slice, analytics);
  if (!eff.s4Enabled) return { value: "—", label: "needs 2+ centres", delta: null, spark: [0, 0], disabled: true };
  const s = analytics.centreAwardSpread;
  const g = round((s[cur]?.best ?? 0) - (s[cur]?.worst ?? 0));
  const g0 = prev != null && s[prev] ? round(s[prev]!.best - s[prev]!.worst) : null;
  return { value: `${g}pts`, label: "best–worst gap", delta: g0 != null ? (g <= g0 ? `−${round(g0 - g)}` : `+${round(g - g0)}`) : null, deltaGood: false, spark: [g0 ?? g, g], good: true };
}

export interface OverallSection {
  id: "part" | "perf" | "award" | "centre";
  n: string;
  kpi: string;
  q: string;
  Body: (props: { analytics: OverallAnalytics; slice: LegacySlice }) => ReactNode;
  headline: (analytics: OverallAnalytics, slice: LegacySlice) => Headline;
}

export const OV_SECTIONS: OverallSection[] = [
  { id: "part", n: "01", kpi: "Participation · Reach & progression", q: "Are we growing, and are more students getting through?", Body: S1Participation, headline: partHeadline },
  { id: "perf", n: "02", kpi: "Candidate performance by subject · Score distributions", q: "Are students scoring better, are the weakest coming up, and are individuals improving between sittings?", Body: S2Performance, headline: perfHeadline },
  { id: "award", n: "03", kpi: "Award distribution · The shape of the cohort", q: "Is the shape of the cohort shifting toward higher awards over time?", Body: S3Award, headline: awardHeadline },
  { id: "centre", n: "04", kpi: "Partner-centre comparison · Consistency", q: "Are outcomes becoming more consistent across centres, or is the gap between best and worst widening?", Body: S4Centres, headline: centreHeadline },
];
