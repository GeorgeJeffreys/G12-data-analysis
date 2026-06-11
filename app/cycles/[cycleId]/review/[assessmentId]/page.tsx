"use client";

/**
 * Screen 04 — Item review & scoring (the hero). Human gate 1: review item
 * quality and decide exclusions; the KPIs, score distribution and breakdowns
 * recompute live (through the provider → engine) on every exclusion.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import type { ItemRow } from "@/lib/data/types";
import { H, ratingColor } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
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

function fmtStat(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  const s = v.toFixed(2);
  return s.replace(/^(-?)0\./, "$1.");
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

  const exclude = (itemId: string, reason: string) => {
    provider.setItemExcluded(cycleId, assessmentId, itemId, true, reason);
    setReasonFor(null);
  };
  const restore = (itemId: string) => provider.setItemExcluded(cycleId, assessmentId, itemId, false);

  const Num = ({ v }: { v: number | null }) => (
    <span className="hf-mono" style={{ fontSize: 12.5, color: v !== null && v < 0.2 ? H.bad : H.ink }}>
      {fmtStat(v)}
    </span>
  );

  const SortableTh = ({ label, k, align = "right" }: { label: string; k: SortKey; align?: "left" | "right" }) => (
    <th
      className="hf-th"
      style={{ textAlign: align, cursor: "pointer" }}
      onClick={() => toggleSort(k)}
      title="Sort"
    >
      {label}
      {sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

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
      {/* assessment tabs */}
      <div
        style={{
          display: "flex",
          flex: "0 0 auto",
          borderBottom: `1px solid ${H.line}`,
          padding: "0 24px",
          gap: 4,
          background: H.paper,
        }}
      >
        {model.assessments.map((a) => {
          const on = a.id === assessmentId;
          return (
            <Link
              key={a.id}
              href={`/cycles/${cycleId}/review/${encodeURIComponent(a.id)}`}
              style={{
                padding: "13px 15px",
                fontSize: 13,
                fontWeight: on ? 700 : 500,
                color: on ? H.pink : H.ink2,
                borderBottom: `3px solid ${on ? H.pink : "transparent"}`,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              {a.shortName}
              {a.rtl && <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 6 }}>RTL</span>}
            </Link>
          );
        })}
      </div>

      <div style={{ display: "flex", flex: 1, alignItems: "stretch", minHeight: 0 }}>
        {/* main column */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          {/* KPI strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 36,
              padding: "18px 26px",
              borderBottom: `1px solid ${H.line}`,
              background: H.paper,
            }}
          >
            <Kpi n={String(model.kpis.items)} label="Items" />
            <Kpi n={String(model.kpis.excluded)} label="Excluded" sub="recompute on" />
            <Kpi n={fmtStat(model.kpis.medianDifficulty)} label="Median difficulty" />
            <Kpi n={`${model.kpis.cohortMean}%`} label="Cohort mean" />
            <div style={{ flex: 1 }} />
            <label className="hf-field" style={{ width: 240 }}>
              <Icon name="search" color={H.ink3} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="search question text"
                style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12.5, color: H.ink }}
                aria-label="Search question text"
              />
            </label>
          </div>

          {/* filter row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "12px 26px",
              borderBottom: `1px solid ${H.line}`,
              flexWrap: "wrap",
              background: H.paper,
            }}
          >
            <span className="hf-lbl" style={{ marginRight: 2 }}>Filter</span>
            <Chip on={quality === "all"} onClick={() => setQuality("all")}>All quality</Chip>
            <Chip on={quality === "review"} onClick={() => setQuality("review")}>Review</Chip>
            <Chip on={quality === "poor"} onClick={() => setQuality("poor")}>Poor</Chip>
            <span style={{ width: 1, height: 18, background: H.line2, margin: "0 4px" }} />
            <Dropdown label="Element" value={element} onChange={setElement} options={elements} />
            <Dropdown label="Demand" value={demand} onChange={setDemand} options={["D1", "D2", "D3"]} />
            <div style={{ flex: 1 }} />
            <span className="hf-sub">
              Sort: <span style={{ fontWeight: 700, color: H.ink }}>{sortLabel(sort.key)} {sort.dir === 1 ? "↑" : "↓"}</span>
            </span>
          </div>

          {/* table */}
          <div style={{ flex: 1, overflow: "auto", background: H.paper }}>
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
              Showing {view.length} of {model.items.length} items
            </div>
          </div>
        </div>

        {/* right rail */}
        <aside
          style={{
            width: 322,
            flex: "0 0 auto",
            borderLeft: `1px solid ${H.line2}`,
            background: H.paper,
            boxShadow: "-12px 0 28px -18px rgba(31,42,49,.20)",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 22,
            overflow: "auto",
          }}
        >
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 11 }}>
              <span className="hf-lbl">Score distribution</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: H.pink, fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: H.pink }} />
                LIVE
              </span>
            </div>
            <Histogram data={model.distribution} height={94} />
            <div className="hf-sub" style={{ marginTop: 7 }}>
              Cohort mean {model.cohortMean}% · σ {model.cohortSd}
            </div>
          </div>
          <div>
            <div className="hf-lbl" style={{ marginBottom: 11 }}>By curriculum element</div>
            <BreakdownBars items={model.byElement} />
          </div>
          <div>
            <div className="hf-lbl" style={{ marginBottom: 11 }}>By demand level</div>
            <BreakdownBars items={model.byDemand} />
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Kpi({ n, label, sub }: { n: string; label: string; sub?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span className="hf-mono" style={{ fontSize: 25, fontWeight: 600, lineHeight: 1 }}>{n}</span>
      <span className="hf-lbl" style={{ marginTop: 4 }}>{label}</span>
      {sub && <span className="hf-sub" style={{ fontSize: 11 }}>{sub}</span>}
    </div>
  );
}

function Dropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <span className={`hf-chip ${value ? "on" : ""}`} style={{ padding: 0, overflow: "hidden" }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        style={{
          border: "none",
          background: "transparent",
          font: "inherit",
          color: "inherit",
          padding: "4px 11px",
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </span>
  );
}

function sortLabel(k: SortKey): string {
  return (
    { q: "item", pValue: "p-value", itemTotal: "item-total", pointBiserial: "point-biserial", discrimination: "discrimination", quality: "quality" } as Record<SortKey, string>
  )[k];
}

function ItemRowView({
  it,
  qLabel,
  reasonOpen,
  onAskReason,
  onCancelReason,
  onExclude,
  onRestore,
  Num,
}: {
  it: ItemRow;
  qLabel: string;
  reasonOpen: boolean;
  onAskReason: () => void;
  onCancelReason: () => void;
  onExclude: (reason: string) => void;
  onRestore: () => void;
  Num: (p: { v: number | null }) => JSX.Element;
}) {
  return (
    <tr className={it.excluded ? "" : "hf-hover"} style={{ background: it.excluded ? H.tint : "transparent", opacity: it.excluded ? 0.62 : 1 }}>
      <td className="hf-td" style={{ verticalAlign: "top", maxWidth: 310 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span className="hf-mono" style={{ fontWeight: 700, fontSize: 12 }}>{qLabel}</span>
          <span style={{ fontSize: 12.5, textDecoration: it.excluded ? "line-through" : "none" }}>
            {it.wording ?? "—"}
          </span>
        </div>
      </td>
      <td className="hf-td">
        <div style={{ fontSize: 12, fontWeight: 600 }}>{it.major ?? "—"}</div>
        <div className="hf-sub" style={{ fontSize: 11 }}>{it.sub ?? ""}</div>
      </td>
      <td className="hf-td">{it.demand ? <Pill>{it.demand}</Pill> : null}</td>
      <td className="hf-td"><QualityBar v={it.qualityIndex} width={70} /></td>
      <td className="hf-td" style={{ textAlign: "right" }}><Num v={it.pValue} /></td>
      <td className="hf-td" style={{ textAlign: "right" }}><Num v={it.itemTotal} /></td>
      <td className="hf-td" style={{ textAlign: "right" }}><Num v={it.pointBiserial} /></td>
      <td className="hf-td" style={{ textAlign: "right" }}><Num v={it.discrimination} /></td>
      <td className="hf-td" style={{ textAlign: "right", position: "relative", minWidth: 96 }}>
        {it.excluded ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
            <span className="hf-mono" style={{ fontSize: 10, color: ratingColor("Flag"), fontWeight: 700 }}>EXCLUDED</span>
            <span className="hf-sub" style={{ fontSize: 10 }}>{it.reason ?? "—"}</span>
            <button className="hf-btn ghost" style={{ fontSize: 10.5, padding: "2px 4px" }} onClick={onRestore}>
              Restore
            </button>
          </div>
        ) : reasonOpen ? (
          <div
            style={{
              position: "absolute",
              right: 8,
              top: 6,
              zIndex: 5,
              background: H.paper,
              border: `1px solid ${H.line2}`,
              borderRadius: 8,
              boxShadow: "0 8px 28px rgba(31,42,49,.18)",
              padding: 4,
              width: 190,
              textAlign: "left",
            }}
          >
            <div className="hf-lbl" style={{ padding: "4px 8px" }}>Reason to exclude</div>
            {REASONS.map((r) => (
              <button
                key={r}
                className="hf-btn ghost"
                style={{ display: "block", width: "100%", textAlign: "left", fontSize: 12, padding: "6px 8px" }}
                onClick={() => onExclude(r)}
              >
                {r}
              </button>
            ))}
            <button className="hf-btn ghost" style={{ fontSize: 11, padding: "6px 8px", color: H.ink3 }} onClick={onCancelReason}>
              Cancel
            </button>
          </div>
        ) : (
          <Button variant="ghost" style={{ fontSize: 11.5, color: H.bad }} onClick={onAskReason}>
            Exclude…
          </Button>
        )}
      </td>
    </tr>
  );
}
