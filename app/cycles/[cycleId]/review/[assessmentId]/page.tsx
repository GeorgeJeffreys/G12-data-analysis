"use client";

/**
 * Screen 04 — Item review & scoring (the hero). Human gate 1: review item
 * quality and decide exclusions; the KPIs, score distribution and breakdowns
 * recompute live (through the provider → engine) on every exclusion.
 *
 * Layout (prompt 2 · B):
 *  - the cohort summary (distribution / by-element / by-demand) lives in a
 *    collapsible strip across the top, above the table;
 *  - the table is zoomable (density control) and each question shows only its
 *    first line, truncated, with an expand control;
 *  - the right panel is blank until a row is clicked, then shows that item's full
 *    statistical deep-dive; it is collapsible and drag-resizable.
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import type { ItemRow, ItemDetailModel, ReviewModel } from "@/lib/data/types";
import { H, ratingColor } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { LockBanner } from "@/components/shell/LockBanner";
import { Button, Chip, Pill, QualityBar } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { Histogram } from "@/components/ui/charts";

const REASONS = [
  "Negative discrimination",
  "Low point-biserial",
  "Too easy / too hard",
  "Ambiguous wording",
  "Off-syllabus",
];

type QualityFilter = "all" | "review" | "poor";
type SortKey = "q" | "pValue" | "itemTotal" | "pointBiserial" | "discrimination" | "quality";
type Zoom = "compact" | "normal" | "comfortable";

const ZOOM: Record<Zoom, { pad: string; font: number }> = {
  compact: { pad: "5px 12px", font: 12 },
  normal: { pad: "11px 12px", font: 12.5 },
  comfortable: { pad: "16px 12px", font: 13.5 },
};

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

  // B: selection, cohort strip, zoom, expand, resizable panel
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cohortOpen, setCohortOpen] = useState(true);
  const [zoom, setZoom] = useState<Zoom>("normal");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [panelWidth, setPanelWidth] = useState(360);
  const [panelOpen, setPanelOpen] = useState(true);

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
  const select = (itemId: string) => {
    setSelectedId(itemId);
    setPanelOpen(true);
  };

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

  const z = ZOOM[zoom];

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
        <Link href={`/cycles/${cycleId}/student-review`}>
          <Button variant="pri">
            Continue to student review
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

      {/* cohort summary strip — collapsible, across the top */}
      <CohortStrip open={cohortOpen} onToggle={() => setCohortOpen((v) => !v)} model={model} />

      {/* filter + zoom row */}
      <div className="hf-pad" style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 26px", borderBottom: `1px solid ${H.line}`, flexWrap: "wrap", background: H.paper }}>
        <span className="hf-lbl" style={{ marginRight: 2 }}>Filter</span>
        <Chip on={quality === "all"} onClick={() => setQuality("all")}>All quality</Chip>
        <Chip on={quality === "review"} onClick={() => setQuality("review")}>Review</Chip>
        <Chip on={quality === "poor"} onClick={() => setQuality("poor")}>Poor</Chip>
        <span style={{ width: 1, height: 18, background: H.line2, margin: "0 4px" }} />
        <Dropdown label="Element" value={element} onChange={setElement} options={elements} />
        <Dropdown label="Demand" value={demand} onChange={setDemand} options={["D1", "D2", "D3"]} />
        <div style={{ flex: 1, minWidth: 8 }} />
        <ZoomControl zoom={zoom} onZoom={setZoom} />
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

        {/* right deep-dive — collapsible + drag-resizable */}
        {panelOpen ? (
          <DeepDivePanel
            width={panelWidth}
            onResize={setPanelWidth}
            onCollapse={() => setPanelOpen(false)}
            detail={detail}
            onExclude={exclude}
            onRestore={restore}
          />
        ) : (
          <button
            onClick={() => setPanelOpen(true)}
            title="Show item deep-dive"
            style={{ flex: "0 0 auto", width: 34, border: "none", borderLeft: `1px solid ${H.line2}`, background: H.tint, cursor: "pointer", color: H.ink2, writingMode: "vertical-rl", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, padding: "10px 0" }}
          >
            ‹ Item deep-dive
          </button>
        )}
      </div>
    </Shell>
  );
}

// ── cohort summary strip (slim, inline) ─────────────────────────────────────
function CohortStrip({ open, onToggle, model }: { open: boolean; onToggle: () => void; model: ReviewModel }) {
  return (
    <div
      className="hf-pad"
      style={{ flex: "0 0 auto", borderBottom: `1px solid ${H.line}`, background: H.canvas, display: "flex", alignItems: "center", gap: 18, padding: "7px 26px", flexWrap: "wrap", minHeight: 40 }}
    >
      <button
        onClick={onToggle}
        title={open ? "Collapse cohort summary" : "Expand cohort summary"}
        style={{ display: "flex", alignItems: "center", gap: 7, border: "none", background: "transparent", cursor: "pointer", color: H.ink2, padding: 0, flex: "0 0 auto" }}
      >
        <Chevron open={open} />
        <span className="hf-lbl">Cohort summary</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, color: H.pink, fontWeight: 700, marginLeft: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: H.pink }} /> LIVE
        </span>
      </button>

      {open && (
        <>
          {/* condensed distribution */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "0 0 auto" }}>
            <div style={{ width: 132 }}><Histogram data={model.distribution} height={34} /></div>
            <span className="hf-sub" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
              mean <b style={{ color: H.ink }}>{model.cohortMean}%</b> · σ {model.cohortSd}
            </span>
          </div>
          <Sep />
          <CompactGroup label="Element" items={model.byElement} />
          <Sep />
          <CompactGroup label="Demand" items={model.byDemand} />
        </>
      )}
    </div>
  );
}

function Sep() {
  return <span style={{ width: 1, height: 22, background: H.line2, flex: "0 0 auto" }} />;
}

/** Condensed inline summary: label + small "key n" chips with a thin fill bar. */
function CompactGroup({ label, items }: { label: string; items: { k: string; v: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.v));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", minWidth: 0 }}>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{label}</span>
      {items.map((it) => (
        <span key={it.k} title={`${it.k}: ${it.v}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: H.ink2, background: H.paper, border: `1px solid ${H.line2}`, borderRadius: 999, padding: "1px 7px", maxWidth: 150 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.k}</span>
          <span style={{ width: 22, height: 4, background: H.tint2, borderRadius: 2, flex: "0 0 auto" }}>
            <span style={{ display: "block", width: `${(it.v / max) * 100}%`, height: "100%", background: H.bar, borderRadius: 2 }} />
          </span>
          <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink }}>{it.v}</span>
        </span>
      ))}
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

function ZoomControl({ zoom, onZoom }: { zoom: Zoom; onZoom: (z: Zoom) => void }) {
  const opts: { k: Zoom; label: string }[] = [
    { k: "compact", label: "Compact" },
    { k: "normal", label: "Normal" },
    { k: "comfortable", label: "Roomy" },
  ];
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>Density</span>
      <span style={{ display: "flex", border: `1px solid ${H.line2}`, borderRadius: 7, overflow: "hidden" }}>
        {opts.map((o, i) => (
          <button
            key={o.k}
            onClick={() => onZoom(o.k)}
            style={{ padding: "5px 10px", fontSize: 11.5, fontWeight: zoom === o.k ? 700 : 500, background: zoom === o.k ? H.pinkSoft : H.paper, color: zoom === o.k ? H.pink : H.ink2, border: "none", borderLeft: i > 0 ? `1px solid ${H.line2}` : "none", cursor: "pointer" }}
          >
            {o.label}
          </button>
        ))}
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
      <td style={td}>
        <div style={{ fontSize: zoom.font - 0.5, fontWeight: 600 }}>{it.major ?? "—"}</div>
        <div className="hf-sub" style={{ fontSize: 11 }}>{it.sub ?? ""}</div>
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

// ── deep-dive panel ─────────────────────────────────────────────────────────
function DeepDivePanel({
  width,
  onResize,
  onCollapse,
  detail,
  onExclude,
  onRestore,
}: {
  width: number;
  onResize: (w: number) => void;
  onCollapse: () => void;
  detail: ItemDetailModel | null | undefined;
  onExclude: (itemId: string, reason: string) => void;
  onRestore: (itemId: string) => void;
}) {
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => {
      const next = Math.max(280, Math.min(640, startW + (startX - ev.clientX)));
      onResize(next);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  return (
    <aside style={{ width, flex: "0 0 auto", borderLeft: `1px solid ${H.line2}`, background: H.paper, boxShadow: "-12px 0 28px -18px rgba(31,42,49,.20)", display: "flex", position: "relative", minWidth: 0 }}>
      {/* drag handle */}
      <div onPointerDown={startResize} title="Drag to resize" style={{ position: "absolute", left: -3, top: 0, bottom: 0, width: 6, cursor: "ew-resize", zIndex: 2 }} />
      <div style={{ flex: 1, overflow: "auto", padding: 20, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <span className="hf-lbl">Item deep-dive</span>
          <div style={{ flex: 1 }} />
          <button onClick={onCollapse} title="Collapse panel" className="hf-btn ghost" style={{ padding: "2px 7px", fontSize: 14 }}>›</button>
        </div>
        {!detail ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "60px 16px", textAlign: "center", color: H.ink3 }}>
            <div style={{ width: 46, height: 46, borderRadius: 999, border: `1.5px dashed ${H.line2}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="search" color={H.ink3} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: H.ink2 }}>Select a question</div>
            <div className="hf-sub" style={{ fontSize: 12 }}>Click any row to see its full statistical deep-dive — difficulty, discrimination groups, the rating reasoning and the response breakdown.</div>
          </div>
        ) : (
          <DetailBody detail={detail} onExclude={onExclude} onRestore={onRestore} />
        )}
      </div>
    </aside>
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
