"use client";

/**
 * Screen 04 — Question review & scoring (the hero). Human gate 1: review item
 * quality and decide exclusions; the KPIs recompute live (through the provider →
 * engine) on every exclusion.
 *
 * Layout:
 *  - the question table is the full-width dominant element under a single slim
 *    control band (compact stats + filters + search + zoom);
 *  - each question row is expandable — clicking a row reveals its per-question
 *    deep-dive (compact statistics, discrimination groups, response outcome)
 *    inline beneath the row; clicking again collapses it. One row at a time.
 *  - true whole-table zoom: − / + (and trackpad pinch) scale the entire table —
 *    columns, text and rows together — so zooming out genuinely fits more rows.
 *
 * The cohort-level summary (overall score distribution / by-element rollup) is
 * deliberately absent here — it lives on the Diagnostics tab.
 */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import type { ItemRow, ItemDetailModel } from "@/lib/data/types";
import { H, ratingColor } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { CycleShell } from "@/components/shell/CycleShell";
import { AssessmentTabs } from "@/components/shell/AssessmentTabs";
import { Button, Chip, Pill, QualityBar } from "@/components/ui/primitives";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { downloadCsv, downloadWorkbook, fileStem } from "@/lib/ui/export";
import type { DataProvider } from "@/lib/data/provider";
import { Icon } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/infotip";
import { ReliabilityPanel } from "@/components/ui/reliability";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";

const REASONS = [
  "Negative discrimination",
  "Low point-biserial",
  "Too easy / too hard",
  "Ambiguous wording",
  "Off-syllabus",
];

/**
 * Inline plain-language definition of the item-quality score. Kept accurate to
 * the real implementation: the engine rates four psychometric statistics
 * Good/Review/Flag (thresholds from ScoringConfig.quality — see
 * lib/engine/config.ts), those four ratings are averaged into the 0–100 index
 * (Good=1, Review=0.55, Flag=0.12; see qualityIndexOf in the provider /
 * scripts/build-seed.mts), and the bar colours come from qualityTier
 * (lib/ui/tokens.ts). "Overall review" is the worst of the four.
 */
function QualityInfo() {
  const Stat = ({ name, good }: { name: string; good: string }) => (
    <li style={{ marginBottom: 3 }}>
      <b style={{ color: H.ink }}>{name}</b> — {good}
    </li>
  );
  return (
    <InfoTip label="What does the item Quality score mean?" width={320}>
      <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 700, color: H.ink, fontSize: 12, marginBottom: 4 }}>Item quality (0–100)</div>
        <p style={{ margin: "0 0 7px" }}>
          A composite indicator of how well this question performed across the whole cohort — a higher score means a
          more reliable question.
        </p>
        <div style={{ fontWeight: 600, color: H.ink, marginBottom: 3 }}>Built from four checks</div>
        <ul style={{ margin: "0 0 7px", paddingLeft: 16 }}>
          <Stat name="Difficulty (p-value)" good="average score; good 0.30–0.85, flagged below 0.20 or above 0.90" />
          <Stat name="Item-total correlation" good="agreement with the rest of the test; good ≥ 0.30, flagged below 0.10" />
          <Stat name="Point-biserial" good="good ≥ 0.30, flagged below 0.10" />
          <Stat name="Discrimination" good="top third vs bottom third; good ≥ 0.30, flagged below 0.10" />
        </ul>
        <p style={{ margin: "0 0 7px" }}>
          Each check is rated <b style={{ color: H.good }}>Good</b> (1.0), <b style={{ color: H.warn }}>Review</b> (0.55)
          or <b style={{ color: H.bad }}>Flag</b> (0.12); the four are averaged into the 0–100 score. The “Overall
          review” is the worst of the four.
        </p>
        <div style={{ fontWeight: 600, color: H.ink, marginBottom: 3 }}>Reading the bar</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Dot c={H.good} /> 65–100 good</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Dot c={H.warn} /> 30–64 review</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Dot c={H.bad} /> under 30 poor</span>
        </div>
        <p style={{ margin: "7px 0 0", color: H.ink3, fontSize: 10.5 }}>Thresholds are configurable in Settings → Configuration.</p>
      </div>
    </InfoTip>
  );
}
function Dot({ c }: { c: string }) {
  return <span style={{ width: 8, height: 8, borderRadius: 999, background: c, flex: "0 0 auto" }} />;
}

type QualityFilter = "all" | "review" | "poor";
type SortKey = "q" | "pValue" | "itemTotal" | "pointBiserial" | "discrimination" | "quality";

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
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Cycle";

  const [search, setSearch] = useState("");
  const [quality, setQuality] = useState<QualityFilter>("all");
  const [element, setElement] = useState<string>("");
  const [demand, setDemand] = useState<string>("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "discrimination", dir: 1 });
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  // Selection drives the inline per-question deep-dive (one row at a time);
  // zoom scales the whole table.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { zoom, setZoom, scrollRef: tableScrollRef, zoomWrapStyle } = useTableZoom();

  const detail = useProviderData(
    (p) => (selectedId ? p.getItemDetail(cycleId, assessmentId, selectedId) : null),
    [cycleId, assessmentId, selectedId],
  );
  const reliability = useProviderData((p) => p.getReliability(cycleId), [cycleId]);

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
  // Clicking a row toggles its inline deep-dive; one row expanded at a time.
  const select = (itemId: string) => setSelectedId((cur) => (cur === itemId ? null : itemId));

  const Num = ({ v }: { v: number | null }) => (
    <span className="hf-mono" style={{ fontSize: 12.5, color: v !== null && v < 0.2 ? H.bad : H.ink }}>
      {fmtStat(v)}
    </span>
  );

  const SortableTh = ({ label, k, align = "right", info }: { label: string; k: SortKey; align?: "left" | "right"; info?: ReactNode }) => (
    <th className="hf-th" style={{ textAlign: align, cursor: "pointer" }} onClick={() => toggleSort(k)} title="Sort">
      {label}
      {sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      {info ? <span style={{ marginLeft: 5 }}>{info}</span> : null}
    </th>
  );

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Question review & scoring"
      stageIndex={4}
      actions={
        <ExportButtons
          onCsv={async () => { await exportItemAnalysisCsv(provider, cycleId); provider.recordExport(cycleId, "Item analysis (CSV)"); }}
          onXlsx={async () => { await exportItemAnalysisXlsx(provider, cycleId); provider.recordExport(cycleId, "Item analysis (Excel)"); }}
        />
      }
      primary={
        <Link href={`/cycles/${cycleId}/adjustments`}>
          <Button variant="pri">
            Continue to adjustments
            <Icon name="arrow" color="#fff" />
          </Button>
        </Link>
      }
      subjectTabs={
        <AssessmentTabs
          activeId={assessmentId}
          tabs={model.assessments.map((a) => ({
            id: a.id,
            label: a.shortName,
            rtl: a.rtl,
            href: `/cycles/${cycleId}/review/${encodeURIComponent(a.id)}`,
          }))}
        />
      }
    >
      {/* slim single control band: compact stats + filters + search + zoom */}
      <div className="hf-pad" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 24px", borderBottom: `1px solid ${H.line}`, background: H.paper, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <MiniStat n={String(model.kpis.items)} label="items" />
          <MiniStat n={String(model.kpis.excluded)} label="excluded" />
          <MiniStat n={fmtStat(model.kpis.medianDifficulty)} label="median" />
          <MiniStat n={`${model.kpis.cohortMean}%`} label="cohort" />
        </span>
        <span style={{ width: 1, height: 18, background: H.line2 }} />
        <Chip on={quality === "all"} onClick={() => setQuality("all")}>All</Chip>
        <Chip on={quality === "review"} onClick={() => setQuality("review")}>Review</Chip>
        <Chip on={quality === "poor"} onClick={() => setQuality("poor")}>Poor</Chip>
        <Dropdown label="Element" value={element} onChange={setElement} options={elements} />
        <Dropdown label="Demand" value={demand} onChange={setDemand} options={["D1", "D2", "D3"]} />
        <div style={{ flex: 1, minWidth: 8 }} />
        <label className="hf-field" style={{ width: 190, maxWidth: "100%", padding: "5px 9px" }}>
          <Icon name="search" color={H.ink3} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search question" style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12, color: H.ink }} aria-label="Search question text" />
        </label>
        <ZoomControl zoom={zoom} onZoom={setZoom} />
      </div>

      {/* full-width question table; rows expand inline to their deep-dive */}
      <div style={{ display: "flex", flex: 1, alignItems: "stretch", minHeight: 0 }}>
        <div ref={tableScrollRef} style={{ flex: 1, overflow: "auto", background: H.paper, minWidth: 0 }}>
          {/* whole-table zoom: scale the table (columns + text + rows) together */}
          <div style={zoomWrapStyle}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <SortableTh label="Question" k="q" align="left" />
                  <th className="hf-th">Curriculum</th>
                  <th className="hf-th">Demand</th>
                  <SortableTh label="Quality" k="quality" align="left" info={<QualityInfo />} />
                  <SortableTh label="p-val" k="pValue" />
                  <SortableTh label="it-r" k="itemTotal" />
                  <SortableTh label="pt-bis" k="pointBiserial" />
                  <SortableTh label="disc" k="discrimination" />
                  <th className="hf-th" />
                </tr>
              </thead>
              <tbody>
                {view.map((it) => (
                  <Fragment key={it.id}>
                    <ItemRowView
                      it={it}
                      qLabel={qIndex.get(it.id) ?? ""}
                      selected={selectedId === it.id}
                      expanded={expanded.has(it.id)}
                      onSelect={() => select(it.id)}
                      onToggleExpand={() => toggleExpand(it.id)}
                      reasonOpen={reasonFor === it.id}
                      onAskReason={() => setReasonFor(it.id)}
                      onCancelReason={() => setReasonFor(null)}
                      onExclude={(reason) => exclude(it.id, reason)}
                      onRestore={() => restore(it.id)}
                      Num={Num}
                    />
                    {selectedId === it.id && (
                      <tr>
                        <td colSpan={9} style={{ padding: 0, background: H.pinkSoft2, borderBottom: `1px solid ${H.line}`, boxShadow: `inset 3px 0 0 ${H.pink}` }}>
                          <div style={{ padding: "18px 24px 22px", maxWidth: 760 }}>
                            {detail ? (
                              <DetailBody detail={detail} onExclude={exclude} onRestore={restore} />
                            ) : (
                              <div className="hf-sub" style={{ padding: 8 }}>Loading…</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <div className="hf-sub" style={{ padding: "13px 26px" }}>
              Showing {view.length} of {model.items.length} questions · click a row to expand its deep-dive
            </div>
            {/* read-only Cronbach's α (reliability) for this subject */}
            {reliability && (
              <div style={{ padding: "0 26px 28px" }}>
                <ReliabilityPanel model={reliability} assessmentId={assessmentId} />
              </div>
            )}
          </div>
        </div>
      </div>
    </CycleShell>
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

/** Compact inline stat for the slim control band: bold number + small label. */
function MiniStat({ n, label }: { n: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, whiteSpace: "nowrap" }}>
      <span className="hf-mono" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1, color: H.ink }}>{n}</span>
      <span className="hf-lbl" style={{ fontSize: 9 }}>{label}</span>
    </span>
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
  onSelect: () => void;
  onToggleExpand: () => void;
  reasonOpen: boolean;
  onAskReason: () => void;
  onCancelReason: () => void;
  onExclude: (reason: string) => void;
  onRestore: () => void;
  Num: (p: { v: number | null }) => JSX.Element;
}) {
  // Fixed normal density — whole-table zoom (scale transform) handles sizing.
  const td = { padding: "9px 12px", borderBottom: `1px solid ${H.line}`, verticalAlign: "middle" as const };
  const FONT = 12.5;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <tr
      onClick={onSelect}
      className={it.excluded ? "" : "hf-hover"}
      style={{ background: selected ? H.pinkSoft2 : it.excluded ? H.tint : "transparent", opacity: it.excluded ? 0.62 : 1, cursor: "pointer", boxShadow: selected ? `inset 3px 0 0 ${H.pink}` : "none" }}
    >
      <td style={{ ...td, verticalAlign: "top", maxWidth: 360 }}>
        <div style={{ display: "flex", gap: 8, alignItems: expanded ? "flex-start" : "center" }}>
          <span style={{ display: "flex", flexDirection: "column", flex: "0 0 auto", marginTop: expanded ? 1 : 0 }}>
            <span className="hf-mono" style={{ fontWeight: 700, fontSize: FONT, lineHeight: 1.1 }}>{qLabel}</span>
            <span className="hf-mono hf-sub" style={{ fontSize: 9.5, lineHeight: 1.2 }} title="Question ID (from the Questionmark export)">{it.id}</span>
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: FONT, textDecoration: it.excluded ? "line-through" : "none", ...(expanded ? { whiteSpace: "normal" } : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }) }}>
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
        <div title={it.major ?? undefined} style={{ fontSize: FONT - 0.5, fontWeight: 600, maxWidth: 138, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.major ?? "—"}</div>
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

/** Compact statistic row: name · value · rating chip (reason on hover). */
function StatRow({ label, value, rating, reason }: { label: string; value: string; rating: "Good" | "Review" | "Flag"; reason: string }) {
  return (
    <div title={reason} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${H.line}` }}>
      <span style={{ flex: 1, fontSize: 12, color: H.ink2 }}>{label}</span>
      <span className="hf-mono" style={{ fontSize: 13.5, fontWeight: 600, minWidth: 38, textAlign: "right" }}>{value}</span>
      <RatingChip rating={rating} />
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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* header — statistics only, no question wording */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="hf-mono" style={{ fontWeight: 700, fontSize: 15 }}>{detail.qLabel}</span>
        <span className="hf-mono hf-sub" style={{ fontSize: 11 }} title="Question ID (from the Questionmark export)">ID {detail.id}</span>
        {detail.demand && <Pill>{detail.demand}</Pill>}
        {detail.major && <span className="hf-sub" style={{ fontSize: 11 }}>{detail.major}</span>}
        <div style={{ flex: 1 }} />
        <RatingChip rating={detail.overallReview} />
        {detail.excluded && <span className="hf-mono" style={{ fontSize: 10, color: H.bad, fontWeight: 700 }}>EXCLUDED</span>}
      </div>

      {/* the four statistics — compact rows (reason on hover) */}
      <div>
        <StatRow label="p-value (difficulty)" value={fmtStat(detail.pValue)} rating={detail.pRating} reason={detail.reasons.p} />
        <StatRow label="Item-total correlation" value={fmtStat(detail.itemTotal)} rating={detail.itRating} reason={detail.reasons.it} />
        <StatRow label="Point-biserial" value={fmtStat(detail.pointBiserial)} rating={detail.pbRating} reason={detail.reasons.pb} />
        <StatRow label="Discrimination" value={fmtStat(detail.discrimination)} rating={detail.discRating} reason={detail.reasons.disc} />
      </div>

      {/* discrimination groups — compact */}
      <div>
        <div className="hf-lbl" style={{ marginBottom: 6 }}>Discrimination groups · top/bottom {detail.groups.size}</div>
        {[
          { k: "Upper", v: detail.groups.upperMean, c: H.good },
          { k: "Lower", v: detail.groups.lowerMean, c: H.bad },
        ].map((g) => (
          <div key={g.k} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 5 }}>
            <span style={{ width: 44, fontSize: 11.5, color: H.ink2 }}>{g.k}</span>
            <div style={{ flex: 1, height: 8, background: H.tint2, borderRadius: 4 }}>
              <div style={{ width: `${(g.v / gmax) * 100}%`, height: "100%", background: g.c, borderRadius: 4 }} />
            </div>
            <span className="hf-mono" style={{ width: 34, textAlign: "right", fontSize: 11.5 }}>{(g.v * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>

      {/* response outcome — compact bar + inline legend */}
      <div>
        <div className="hf-lbl" style={{ marginBottom: 6 }}>Response outcome · {detail.answered}/{detail.presented} answered</div>
        <div style={{ display: "flex", height: 12, borderRadius: 5, overflow: "hidden", border: `1px solid ${H.line2}` }}>
          {seg.map((s) => (s.n > 0 ? <div key={s.k} title={`${s.k}: ${s.n}`} style={{ width: `${pct(s.n)}%`, background: s.c }} /> : null))}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
          {seg.map((s) => (
            <span key={s.k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.c }} />
              <span style={{ color: H.ink2 }}>{s.k}</span>
              <span className="hf-mono" style={{ color: H.ink }}>{s.n}</span>
            </span>
          ))}
        </div>
      </div>

      {/* exclude / restore */}
      <div style={{ borderTop: `1px solid ${H.line}`, paddingTop: 12 }}>
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

// ── exports (item analysis) ────────────────────────────────────────────────
// CSV = the per-item psychometrics (the primary table); XLSX = the canonical
// README & Summary + one-sheet-per-subject workbook (MCQ_Item_Analysis shape).
async function exportItemAnalysisCsv(provider: DataProvider, cycleId: string) {
  const data = provider.getItemAnalysisData(cycleId);
  if (!data) return;
  const exp = await import("@/lib/export");
  const input = exp.assembleItemAnalysis(data);
  const headers = [
    "Assessment", "QuestionId", "P-Value", "Item-Total", "Point-Biserial",
    "Discrimination", "Overall Review", "Participants Presented", "Participants Answered",
    "Avg Response Time (s)", "Remove Item?", "Reason for removing item",
  ];
  const rows = input.blocks.flatMap((b) =>
    b.rows.map((r) => [
      b.name, r.stat.itemId, r.stat.pValue, r.stat.itemTotal, r.stat.pointBiserial,
      r.stat.discrimination, r.stat.overallReview, r.participantsPresented, r.participantsAnswered,
      r.avgResponseTime ?? "", r.exclude ? "Yes" : "No", r.removeReason ?? "",
    ]),
  );
  downloadCsv(`${fileStem("item_analysis", data.cycleName)}.csv`, headers, rows);
}

async function exportItemAnalysisXlsx(provider: DataProvider, cycleId: string) {
  const data = provider.getItemAnalysisData(cycleId);
  if (!data) return;
  const exp = await import("@/lib/export");
  const wb = exp.buildItemAnalysisWorkbook(exp.assembleItemAnalysis(data));
  await downloadWorkbook(`${fileStem("item_analysis", data.cycleName)}.xlsx`, wb);
}
