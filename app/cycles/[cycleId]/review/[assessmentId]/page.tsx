"use client";

/**
 * Screen 04 — Item review & scoring (the hero). Human gate 1: review item
 * quality and decide exclusions; the KPIs, score distribution and breakdowns
 * recompute live (through the provider → engine) on every exclusion.
 *
 * Layout (realigned to the original design proportions):
 *  - the table is the full-height dominant element (slim stats row + one filter
 *    row above it, nothing else stacked);
 *  - the compact right panel is DUAL-MODE — the cohort summary (distribution /
 *    by-element / by-demand) by default, switching to the selected item's
 *    deep-dive (with "← Back to cohort") when a row is clicked;
 *  - the table is zoomable with explicit − / + density controls.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import type { ItemRow, ItemDetailModel, ReviewModel } from "@/lib/data/types";
import { H, ratingColor } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { LockBanner } from "@/components/shell/LockBanner";
import { Button, Chip, Pill, QualityBar } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { Histogram, BreakdownBars } from "@/components/ui/charts";

const REASONS = [
  "Negative discrimination",
  "Low point-biserial",
  "Too easy / too hard",
  "Ambiguous wording",
  "Off-syllabus",
];

type QualityFilter = "all" | "review" | "poor";
type SortKey = "q" | "pValue" | "itemTotal" | "pointBiserial" | "discrimination" | "quality";

/** Row-density / text-size steps, controlled by the + / − zoom buttons. */
const ZOOM_STEPS: { pad: string; font: number }[] = [
  { pad: "3px 12px", font: 11 },
  { pad: "5px 12px", font: 11.5 },
  { pad: "9px 12px", font: 12.5 },
  { pad: "13px 12px", font: 13.5 },
  { pad: "17px 12px", font: 14.5 },
];
const ZOOM_DEFAULT = 2;

function fmtStat(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  const s = v.toFixed(2);
  return s.replace(/^(-?)0\./, "$1.");
}

function firstLine(text: string | null): string {
  if (!text) return "—";
  return text.split(/\r?\n/)[0] ?? text;
}

export default function ReviewPage({
  params,
}: {
  params: { cycleId: string; assessmentId: string };
}) {
  const cycleId = params.cycleId;
  const assessmentId = decodeURIComponent(params.assessmentId);
  const provider = useProvider();
  const model = useProviderData((p) => p.getReview(cycleId, assessmentId), [cycleId, assessmentId]);

  const [search, setSearch] = useState("");
  const [quality, setQuality] = useState<QualityFilter>("all");
  const [element, setElement] = useState<string>("");
  const [demand, setDemand] = useState<string>("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "discrimination", dir: 1 });
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  // Selection drives the dual-mode right panel; zoom controls table density.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(ZOOM_DEFAULT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [panelWidth, setPanelWidth] = useState(322);

  const detail = useProviderData(
    (p) => (selectedId ? p.getItemDetail(cycleId, assessmentId, selectedId) : null),
    [cycleId, assessmentId, selectedId],
  );

  const elements = useMemo(
    () => (model ? [...new Set(model.items.map((i) => i.major).filter(Boolean) as string[])].sort() : []),
    [model],
  );

  const view = useMemo(() => {
    if (!model) return [];
    let rows = model.items.slice();
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => (r.wording ?? "").toLowerCase().includes(q));
    if (quality === "review") rows = rows.filter((r) => r.overallReview === "Review");
    if (quality === "poor") rows = rows.filter((r) => r.overallReview === "Flag");
    if (element) rows = rows.filter((r) => r.major === element);
    if (demand) rows = rows.filter((r) => r.demand === demand);
    const key = sort.key;
    rows.sort((a, b) => {
      if (key === "q") return 0;
      const av = key === "quality" ? a.qualityIndex : (a[key] ?? -Infinity);
      const bv = key === "quality" ? b.qualityIndex : (b[key] ?? -Infinity);
      return (Number(av) - Number(bv)) * sort.dir;
    });
    return rows;
  }, [model, search, quality, element, demand, sort]);

  if (!model) {
    return (
      <Shell crumb={[{ label: "Cycles", href: "/" }, { label: "Not found" }]}>
        <div style={{ padding: 32 }} className="hf-sub">
          That assessment isn’t in this cycle.
        </div>
      </Shell>
    );
  }

  const qIndex = new Map(model.items.map((it, i) => [it.id, `Q${String(i + 1).padStart(2, "0")}`]));

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const exclude = (itemId: string, reason: string) => {
    provider.setItemExcluded(cycleId, assessmentId, itemId, true, reason);
    setReasonFor(null);
  };
  const restore = (itemId: string) => provider.setItemExcluded(cycleId, assessmentId, itemId, false);
  const select = (itemId: string) => setSelectedId((cur) => (cur === itemId ? null : itemId));

  const Num = ({ v }: { v: number | null }) => (
    <span className="hf-mono" style={{ fontSize: 12.5, color: v !== null && v < 0.2 ? H.bad : H.ink }}>
      {fmtStat(v)}
    </span>
  );

  const SortableTh = ({ label, k, align = "right" }: { label: string; k: SortKey; align?: "left" | "right" }) => (
    <th className="hf-th" style={{ textAlign: align, cursor: "pointer" }} onClick={() => toggleSort(k)} title="Sort">
      {label}
      {sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  const z = ZOOM_STEPS[zoom] ?? ZOOM_STEPS[ZOOM_DEFAULT]!;

  return (
    <Shell
      crumb={[
        { label: "Cycles", href: "/" },
        { label: "May 2026", href: `/cycles/${cycleId}` },
        { label: "Item review & scoring" },
      ]}
      stageIndex={2}
      cycleId={cycleId}
      stageAction={
        <Link href={`/cycles/${cycleId}/adjustments`}>
          <Button variant="pri">
            Continue to adjustments
            <Icon name="arrow" color="#fff" />
          </Button>
        </Link>
      }
    >
      <LockBanner cycleId={cycleId} />
      {/* assessment tabs */}
      <div style={{ display: "flex", flex: "0 0 auto", borderBottom: `1px solid ${H.line}`, padding: "0 24px", gap: 4, background: H.paper, overflowX: "auto" }}>
        {model.assessments.map((a) => {
          const on = a.id === assessmentId;
          return (
            <Link
              key={a.id}
              href={`/cycles/${cycleId}/review/${encodeURIComponent(a.id)}`}
              style={{ padding: "13px 15px", fontSize: 13, fontWeight: on ? 700 : 500, color: on ? H.pink : H.ink2, borderBottom: `3px solid ${on ? H.pink : "transparent"}`, textDecoration: "none", whiteSpace: "nowrap" }}
            >
              {a.shortName}
              {a.rtl && <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 6 }}>RTL</span>}
            </Link>
          );
        })}
      </div>

      {/* KPI strip */}
      <div className="hf-pad" style={{ display: "flex", alignItems: "center", gap: 30, padding: "11px 26px", borderBottom: `1px solid ${H.line}`, background: H.paper, flexWrap: "wrap" }}>
        <Kpi n={String(model.kpis.items)} label="Items" />
        <Kpi n={String(model.kpis.excluded)} label="Excluded" sub="recompute on" />
        <Kpi n={fmtStat(model.kpis.medianDifficulty)} label="Median difficulty" />
        <Kpi n={`${model.kpis.cohortMean}%`} label="Cohort mean" />
        <div style={{ flex: 1, minWidth: 12 }} />
        <label className="hf-field" style={{ width: 240, maxWidth: "100%" }}>
          <Icon name="search" color={H.ink3} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search question text" style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12.5, color: H.ink }} aria-label="Search question text" />
        </label>
      </div>

      {/* single filter + zoom row (cohort summary now lives in the right panel) */}
      <div className="hf-pad" style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 26px", borderBottom: `1px solid ${H.line}`, flexWrap: "wrap", background: H.paper }}>
        <span className="hf-lbl" style={{ marginRight: 2 }}>Filter</span>
        <Chip on={quality === "all"} onClick={() => setQuality("all")}>All quality</Chip>
        <Chip on={quality === "review"} onClick={() => setQuality("review")}>Review</Chip>
        <Chip on={quality === "poor"} onClick={() => setQuality("poor")}>Poor</Chip>
        <span style={{ width: 1, height: 18, background: H.line2, margin: "0 4px" }} />
        <Dropdown label="Element" value={element} onChange={setElement} options={elements} />
        <Dropdown label="Demand" value={demand} onChange={setDemand} options={["D1", "D2", "D3"]} />
        <div style={{ flex: 1, minWidth: 8 }} />
        <ZoomControl zoom={zoom} onZoom={setZoom} max={ZOOM_STEPS.length - 1} />
      </div>

      {/* table + deep-dive */}
      <div style={{ display: "flex", flex: 1, alignItems: "stretch", minHeight: 0 }}>
        <div style={{ flex: 1, overflow: "auto", background: H.paper, minWidth: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <SortableTh label="Item" k="q" align="left" />
                <th className="hf-th">Curriculum</th>
                <th className="hf-th">Demand</th>
                <SortableTh label="Quality" k="quality" align="left" />
                <SortableTh label="p-val" k="pValue" />
                <SortableTh label="it-r" k="itemTotal" />
                <SortableTh label="pt-bis" k="pointBiserial" />
                <SortableTh label="disc" k="discrimination" />
                <th className="hf-th" />
              </tr>
            </thead>
            <tbody>
              {view.map((it) => (
                <ItemRowView
                  key={it.id}
                  it={it}
                  qLabel={qIndex.get(it.id) ?? ""}
                  selected={selectedId === it.id}
                  expanded={expanded.has(it.id)}
                  zoom={z}
                  onSelect={() => select(it.id)}
                  onToggleExpand={() => toggleExpand(it.id)}
                  reasonOpen={reasonFor === it.id}
                  onAskReason={() => setReasonFor(it.id)}
                  onCancelReason={() => setReasonFor(null)}
                  onExclude={(reason) => exclude(it.id, reason)}
                  onRestore={() => restore(it.id)}
                  Num={Num}
                />
              ))}
            </tbody>
          </table>
          <div className="hf-sub" style={{ padding: "13px 26px" }}>
            Showing {view.length} of {model.items.length} items · click a row for its deep-dive
          </div>
        </div>

        {/* right panel — dual-mode: cohort summary by default, deep-dive when a row is selected */}
        <RightPanel
          width={panelWidth}
          onResize={setPanelWidth}
          selected={!!selectedId}
          onBack={() => setSelectedId(null)}
          detail={detail}
          model={model}
          onExclude={exclude}
          onRestore={restore}
        />
      </div>
    </Shell>
  );
}

// ── right panel: dual-mode (cohort summary ⇄ item deep-dive) ────────────────
function RightPanel({
  width,
  onResize,
  selected,
  onBack,
  detail,
  model,
  onExclude,
  onRestore,
}: {
  width: number;
  onResize: (w: number) => void;
  selected: boolean;
  onBack: () => void;
  detail: ItemDetailModel | null | undefined;
  model: ReviewModel;
  onExclude: (itemId: string, reason: string) => void;
  onRestore: (itemId: string) => void;
}) {
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => onResize(Math.max(280, Math.min(560, startW + (startX - ev.clientX))));
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  return (
    <aside style={{ width, flex: "0 0 auto", borderLeft: `1px solid ${H.line2}`, background: H.paper, boxShadow: "-12px 0 28px -18px rgba(31,42,49,.20)", display: "flex", position: "relative", minWidth: 0 }}>
      <div onPointerDown={startResize} title="Drag to resize" style={{ position: "absolute", left: -3, top: 0, bottom: 0, width: 6, cursor: "ew-resize", zIndex: 2 }} />
      <div style={{ flex: 1, overflow: "auto", padding: 20, minWidth: 0 }}>
        {selected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <button onClick={onBack} className="hf-btn ghost" style={{ alignSelf: "flex-start", fontSize: 12 }}>
              ← Back to cohort
            </button>
            {detail ? <DetailBody detail={detail} onExclude={onExclude} onRestore={onRestore} /> : (
              <div className="hf-sub" style={{ padding: 20 }}>Loading…</div>
            )}
          </div>
        ) : (
          <CohortPanel model={model} />
        )}
      </div>
    </aside>
  );
}

/** The default right-panel content: the cohort summary (the original right rail). */
function CohortPanel({ model }: { model: ReviewModel }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 11 }}>
          <span className="hf-lbl">Score distribution</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: H.pink, fontWeight: 700 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: H.pink }} /> LIVE
          </span>
        </div>
        <Histogram data={model.distribution} height={94} />
        <div className="hf-sub" style={{ marginTop: 7 }}>Cohort mean {model.cohortMean}% · σ {model.cohortSd}</div>
      </div>
      <div>
        <div className="hf-lbl" style={{ marginBottom: 11 }}>By curriculum element</div>
        <BreakdownBars items={model.byElement} />
      </div>
      <div>
        <div className="hf-lbl" style={{ marginBottom: 11 }}>By demand level</div>
        <BreakdownBars items={model.byDemand} />
      </div>
    </div>
  );
}

/** Subtle, conventional expand chevron (rotates when open). */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", flex: "0 0 auto" }} aria-hidden="true">
      <path d="M4 2.5L8 6l-4 3.5" fill="none" stroke={H.ink3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Row-density / text-size zoom: explicit − / + controls so more rows fit on demand. */
function ZoomControl({ zoom, onZoom, max }: { zoom: number; onZoom: (z: number) => void; max: number }) {
  const step = (d: -1 | 1) => onZoom(Math.max(0, Math.min(max, zoom + d)));
  const btn = (label: string, d: -1 | 1, disabled: boolean) => (
    <button
      onClick={() => step(d)}
      disabled={disabled}
      aria-label={d < 0 ? "Smaller rows" : "Larger rows"}
      title={d < 0 ? "Denser rows" : "Roomier rows"}
      style={{ width: 26, height: 24, fontSize: 14, fontWeight: 700, background: H.paper, color: disabled ? H.ink3 : H.ink2, border: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}
    >
      {label}
    </button>
  );
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>Density</span>
      <span style={{ display: "flex", alignItems: "center", border: `1px solid ${H.line2}`, borderRadius: 7, overflow: "hidden" }}>
        {btn("−", -1, zoom <= 0)}
        <span style={{ width: 1, height: 16, background: H.line2 }} />
        {btn("+", 1, zoom >= max)}
      </span>
    </span>
  );
}

function Kpi({ n, label, sub }: { n: string; label: string; sub?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="hf-mono" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1 }}>{n}</span>
      <span className="hf-lbl" style={{ marginTop: 3 }}>{label}</span>
      {sub && <span className="hf-sub" style={{ fontSize: 10.5 }}>{sub}</span>}
    </div>
  );
}

function Dropdown({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <span className={`hf-chip ${value ? "on" : ""}`} style={{ padding: 0, overflow: "hidden" }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} style={{ border: "none", background: "transparent", font: "inherit", color: "inherit", padding: "4px 11px", cursor: "pointer", outline: "none" }}>
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </span>
  );
}

function ItemRowView({
  it,
  qLabel,
  selected,
  expanded,
  zoom,
  onSelect,
  onToggleExpand,
  reasonOpen,
  onAskReason,
  onCancelReason,
  onExclude,
  onRestore,
  Num,
}: {
  it: ItemRow;
  qLabel: string;
  selected: boolean;
  expanded: boolean;
  zoom: { pad: string; font: number };
  onSelect: () => void;
  onToggleExpand: () => void;
  reasonOpen: boolean;
  onAskReason: () => void;
  onCancelReason: () => void;
  onExclude: (reason: string) => void;
  onRestore: () => void;
  Num: (p: { v: number | null }) => JSX.Element;
}) {
  const td = { padding: zoom.pad, borderBottom: `1px solid ${H.line}`, verticalAlign: "middle" as const };
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <tr
      onClick={onSelect}
      className={it.excluded ? "" : "hf-hover"}
      style={{ background: selected ? H.pinkSoft2 : it.excluded ? H.tint : "transparent", opacity: it.excluded ? 0.62 : 1, cursor: "pointer", boxShadow: selected ? `inset 3px 0 0 ${H.pink}` : "none" }}
    >
      <td style={{ ...td, verticalAlign: "top", maxWidth: 360 }}>
        <div style={{ display: "flex", gap: 8, alignItems: expanded ? "flex-start" : "center" }}>
          <span className="hf-mono" style={{ fontWeight: 700, fontSize: zoom.font, flex: "0 0 auto", marginTop: expanded ? 1 : 0 }}>{qLabel}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: zoom.font, textDecoration: it.excluded ? "line-through" : "none", ...(expanded ? { whiteSpace: "normal" } : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }) }}>
            {expanded ? (it.wording ?? "—") : firstLine(it.wording)}
          </span>
          {(it.wording ?? "").length > 40 ? (
            <button
              onClick={(e) => { stop(e); onToggleExpand(); }}
              aria-label={expanded ? "Collapse question text" : "Expand full question text"}
              aria-expanded={expanded}
              title={expanded ? "Collapse" : "Show full text"}
              style={{ border: "none", background: "transparent", cursor: "pointer", flex: "0 0 auto", display: "inline-flex", alignItems: "center", padding: 2, marginTop: expanded ? 1 : 0, borderRadius: 4 }}
            >
              <Chevron open={expanded} />
            </button>
          ) : (
            <span style={{ width: 15, flex: "0 0 auto" }} />
          )}
        </div>
      </td>
      <td style={{ ...td, maxWidth: 150, width: 150 }}>
        <div title={it.major ?? undefined} style={{ fontSize: zoom.font - 0.5, fontWeight: 600, maxWidth: 138, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.major ?? "—"}</div>
        <div title={it.sub ?? undefined} className="hf-sub" style={{ fontSize: 11, maxWidth: 138, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sub ?? ""}</div>
      </td>
      <td style={td}>{it.demand ? <Pill>{it.demand}</Pill> : null}</td>
      <td style={td}><QualityBar v={it.qualityIndex} width={70} /></td>
      <td style={{ ...td, textAlign: "right" }}><Num v={it.pValue} /></td>
      <td style={{ ...td, textAlign: "right" }}><Num v={it.itemTotal} /></td>
      <td style={{ ...td, textAlign: "right" }}><Num v={it.pointBiserial} /></td>
      <td style={{ ...td, textAlign: "right" }}><Num v={it.discrimination} /></td>
      <td style={{ ...td, textAlign: "right", position: "relative", minWidth: 96 }} onClick={stop}>
        {it.excluded ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
            <span className="hf-mono" style={{ fontSize: 10, color: ratingColor("Flag"), fontWeight: 700 }}>EXCLUDED</span>
            <span className="hf-sub" style={{ fontSize: 10 }}>{it.reason ?? "—"}</span>
            <button className="hf-btn ghost" style={{ fontSize: 10.5, padding: "2px 4px" }} onClick={onRestore}>Restore</button>
          </div>
        ) : reasonOpen ? (
          <div style={{ position: "absolute", right: 8, top: 6, zIndex: 5, background: H.paper, border: `1px solid ${H.line2}`, borderRadius: 8, boxShadow: "0 8px 28px rgba(31,42,49,.18)", padding: 4, width: 190, textAlign: "left" }}>
            <div className="hf-lbl" style={{ padding: "4px 8px" }}>Reason to exclude</div>
            {REASONS.map((r) => (
              <button key={r} className="hf-btn ghost" style={{ display: "block", width: "100%", textAlign: "left", fontSize: 12, padding: "6px 8px" }} onClick={() => onExclude(r)}>{r}</button>
            ))}
            <button className="hf-btn ghost" style={{ fontSize: 11, padding: "6px 8px", color: H.ink3 }} onClick={onCancelReason}>Cancel</button>
          </div>
        ) : (
          <Button variant="ghost" style={{ fontSize: 11.5, color: H.bad }} onClick={onAskReason}>Exclude…</Button>
        )}
      </td>
    </tr>
  );
}

function RatingChip({ rating }: { rating: "Good" | "Review" | "Flag" }) {
  const c = ratingColor(rating);
  const bg = rating === "Good" ? H.goodSoft : rating === "Review" ? H.warnSoft : H.badSoft;
  return <span style={{ fontSize: 10.5, fontWeight: 700, color: c, background: bg, padding: "2px 8px", borderRadius: 999 }}>{rating}</span>;
}

function StatBox({ label, value, rating, reason }: { label: string; value: string; rating: "Good" | "Review" | "Flag"; reason: string }) {
  return (
    <div style={{ border: `1px solid ${H.line}`, borderRadius: 10, padding: "11px 13px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="hf-lbl" style={{ flex: 1 }}>{label}</span>
        <RatingChip rating={rating} />
      </div>
      <div className="hf-mono" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{value}</div>
      <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.4 }}>{reason}</div>
    </div>
  );
}

function DetailBody({ detail, onExclude, onRestore }: { detail: ItemDetailModel; onExclude: (id: string, r: string) => void; onRestore: (id: string) => void }) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const total = Math.max(1, detail.outcome.correct + detail.outcome.incorrect + detail.outcome.notAnswered);
  const pct = (n: number) => Math.round((n / total) * 100);
  const seg = [
    { k: "Correct", n: detail.outcome.correct, c: H.good },
    { k: "Incorrect", n: detail.outcome.incorrect, c: H.bad },
    { k: "Not answered", n: detail.outcome.notAnswered, c: H.ink3 },
  ];
  const gmax = Math.max(detail.groups.upperMean, detail.groups.lowerMean, 0.001);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* header */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="hf-mono" style={{ fontWeight: 700, fontSize: 15 }}>{detail.qLabel}</span>
          {detail.demand && <Pill>{detail.demand}</Pill>}
          <RatingChip rating={detail.overallReview} />
          {detail.excluded && <span className="hf-mono" style={{ fontSize: 10, color: H.bad, fontWeight: 700 }}>EXCLUDED</span>}
        </div>
        <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.45 }}>{detail.wording ?? "—"}</div>
        <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 6 }}>
          {detail.major ?? "—"}{detail.sub ? ` · ${detail.sub}` : ""}
        </div>
      </div>

      {/* outcome distribution (honest: correct/incorrect/not-answered) */}
      <div>
        <div className="hf-lbl" style={{ marginBottom: 8 }}>Response outcome · {detail.answered} of {detail.presented} answered</div>
        <div style={{ display: "flex", height: 14, borderRadius: 5, overflow: "hidden", border: `1px solid ${H.line2}` }}>
          {seg.map((s) => (s.n > 0 ? <div key={s.k} title={`${s.k}: ${s.n}`} style={{ width: `${pct(s.n)}%`, background: s.c }} /> : null))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 9 }}>
          {seg.map((s) => (
            <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: s.c }} />
              <span style={{ flex: 1, color: H.ink2 }}>{s.k}</span>
              <span className="hf-mono">{s.n}</span>
              <span className="hf-mono" style={{ color: H.ink3, width: 34, textAlign: "right" }}>{pct(s.n)}%</span>
            </div>
          ))}
        </div>
        <div className="hf-sub" style={{ fontSize: 10.5, marginTop: 7, color: H.ink3 }}>
          The score export records correct/incorrect, not the chosen option — so this is the response outcome, not a per-option split.
        </div>
      </div>

      {/* the four statistics with reasoning */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <StatBox label="p-value (difficulty)" value={fmtStat(detail.pValue)} rating={detail.pRating} reason={detail.reasons.p} />
        <StatBox label="Item-total correlation" value={fmtStat(detail.itemTotal)} rating={detail.itRating} reason={detail.reasons.it} />
        <StatBox label="Point-biserial" value={fmtStat(detail.pointBiserial)} rating={detail.pbRating} reason={detail.reasons.pb} />
        <StatBox label="Discrimination" value={fmtStat(detail.discrimination)} rating={detail.discRating} reason={detail.reasons.disc} />
      </div>

      {/* discrimination groups */}
      <div style={{ border: `1px solid ${H.line}`, borderRadius: 10, padding: "12px 13px" }}>
        <div className="hf-lbl" style={{ marginBottom: 9 }}>Discrimination groups · top/bottom {detail.groups.size}</div>
        {[
          { k: "Upper group", v: detail.groups.upperMean, c: H.good },
          { k: "Lower group", v: detail.groups.lowerMean, c: H.bad },
        ].map((g) => (
          <div key={g.k} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7 }}>
            <span style={{ width: 80, fontSize: 11.5, color: H.ink2 }}>{g.k}</span>
            <div style={{ flex: 1, height: 10, background: H.tint2, borderRadius: 5 }}>
              <div style={{ width: `${(g.v / gmax) * 100}%`, height: "100%", background: g.c, borderRadius: 5 }} />
            </div>
            <span className="hf-mono" style={{ width: 38, textAlign: "right", fontSize: 11.5 }}>{(g.v * 100).toFixed(0)}%</span>
          </div>
        ))}
        <div className="hf-sub" style={{ fontSize: 11, marginTop: 4 }}>
          Upper − lower = <span className="hf-mono">{fmtStat(detail.discrimination)}</span>. Strong items are answered correctly more often by the upper group.
        </div>
      </div>

      {/* exclude / restore */}
      <div style={{ borderTop: `1px solid ${H.line}`, paddingTop: 14 }}>
        {detail.excluded ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="hf-sub" style={{ flex: 1, fontSize: 11.5 }}>Excluded — {detail.reason ?? "flagged in review"}</span>
            <Button variant="ghost" onClick={() => onRestore(detail.id)}>Restore item</Button>
          </div>
        ) : reasonOpen ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="hf-lbl">Reason to exclude</span>
            {REASONS.map((r) => (
              <button key={r} className="hf-btn ghost" style={{ textAlign: "left", fontSize: 12, padding: "7px 9px" }} onClick={() => { onExclude(detail.id, r); setReasonOpen(false); }}>{r}</button>
            ))}
            <Button variant="ghost" style={{ color: H.ink3 }} onClick={() => setReasonOpen(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="danger" style={{ width: "100%", justifyContent: "center" }} onClick={() => setReasonOpen(true)}>Exclude this item…</Button>
        )}
      </div>
    </div>
  );
}
