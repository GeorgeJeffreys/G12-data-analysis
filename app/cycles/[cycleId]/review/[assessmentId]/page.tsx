"use client";

/**
 * Screen 04 — Question review & scoring (the hero). Human gate 1: review item
 * quality and decide exclusions; the KPIs recompute live (through the provider →
 * engine) on every exclusion.
 *
 * Layout:
 *  - a scannable question list is the dominant element under a single slim control
 *    band (compact stats + filters + search + zoom). One row per question — no
 *    expandable stat rows; light at-a-glance columns only.
 *  - selecting a question opens a RIGHT-HAND SIDEBAR: its full content (stem,
 *    stimulus/parent passage, options with the correct answer marked, max score,
 *    demand level) and its item statistics (P-Value, Point-Biserial, Discrimination
 *    with Good/Review/Flag ratings), plus a "What these mean" panel. Selecting the
 *    same row again closes the sidebar.
 *  - true whole-table zoom: − / + (and trackpad pinch) scale the entire table —
 *    columns, text and rows together — so zooming out genuinely fits more rows.
 *
 * Statistics are read from the analyst's validated computation (P-B), never
 * recomputed here. Item-Total correlation (IT-R) is still computed by P-B but is
 * NOT shown in this user view — the displayed item-total correlation is the
 * Point-Biserial (PT-BIS). The cohort-level summary lives on the Diagnostics tab.
 */
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import type { ItemRow, ItemDetailModel, AnswerOption } from "@/lib/data/types";
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
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";
import { StepIntro } from "@/components/ui/StepIntro";

const REASONS = [
  "Negative discrimination",
  "Low point-biserial",
  "Too easy / too hard",
  "Ambiguous wording",
  "Off-syllabus",
];

/**
 * Inline plain-language definition of the item-quality score. Kept accurate to
 * the real implementation: the engine rates the item's psychometric statistics
 * Good/Review/Flag (thresholds from ScoringConfig.quality — see
 * lib/engine/config.ts), those ratings are averaged into the 0–100 index
 * (Good=1, Review=0.55, Flag=0.12; see qualityIndexOf in the provider /
 * scripts/build-seed.mts), and the bar colours come from qualityTier
 * (lib/ui/tokens.ts). "Overall review" is the worst rating. The item-total
 * (IT-R) check is part of P-B's internal composite but is not surfaced to users
 * here — the displayed item-total correlation is the Point-Biserial.
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
        <div style={{ fontWeight: 600, color: H.ink, marginBottom: 3 }}>Built from the item checks</div>
        <ul style={{ margin: "0 0 7px", paddingLeft: 16 }}>
          <Stat name="Difficulty (p-value)" good="average score; good 0.30–0.85, flagged below 0.20 or above 0.90" />
          <Stat name="Point-biserial" good="tracks overall performance; good ≥ 0.30, flagged below 0.10" />
          <Stat name="Discrimination" good="top third vs bottom third; good ≥ 0.30, flagged below 0.10" />
        </ul>
        <p style={{ margin: "0 0 7px" }}>
          Each check is rated <b style={{ color: H.good }}>Good</b>, <b style={{ color: H.warn }}>Review</b> or{" "}
          <b style={{ color: H.bad }}>Flag</b>, and the item’s <b>Overall review</b> is the worst of them.
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
// IT-R is not a user-facing column, so it is not a sort key here.
type SortKey = "q" | "pValue" | "pointBiserial" | "discrimination" | "quality";

/**
 * Format an item statistic to 3 decimal places, matching P-B's stored precision.
 * Undefined (null / NaN — e.g. zero-variance correlations) renders as blank,
 * never 0.
 */
function fmt3(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "";
  return v.toFixed(3);
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
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";

  const [search, setSearch] = useState("");
  const [quality, setQuality] = useState<QualityFilter>("all");
  const [element, setElement] = useState<string>("");
  const [demand, setDemand] = useState<string>("");
  // Default: ascending by question number (Q1…Qn), not driven by any statistic.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "q", dir: 1 });

  // Selection drives the right-hand deep-dive sidebar (one question at a time);
  // zoom scales the whole table.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { zoom, setZoom, scrollRef: tableScrollRef, zoomWrapStyle } = useTableZoom();

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
    // Question number is positional: Q1, Q2, … follow the item order in the
    // model, so sort on that index numerically (Q10 after Q9, never after Q1).
    const order = new Map(model.items.map((it, i) => [it.id, i]));
    rows.sort((a, b) => {
      if (key === "q") return ((order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) * sort.dir;
      const av = key === "quality" ? a.qualityIndex : (a[key] ?? -Infinity);
      const bv = key === "quality" ? b.qualityIndex : (b[key] ?? -Infinity);
      return (Number(av) - Number(bv)) * sort.dir;
    });
    return rows;
  }, [model, search, quality, element, demand, sort]);

  if (!model) {
    return (
      <Shell crumb={[{ label: "Sittings", href: "/" }, { label: "Not found" }]}>
        <div style={{ padding: 32 }} className="hf-sub">
          That assessment isn’t in this sitting.
        </div>
      </Shell>
    );
  }

  const qIndex = new Map(model.items.map((it, i) => [it.id, `Q${String(i + 1).padStart(2, "0")}`]));

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  const exclude = (itemId: string, reason: string) =>
    provider.setItemExcluded(cycleId, assessmentId, itemId, true, reason);
  const restore = (itemId: string) => provider.setItemExcluded(cycleId, assessmentId, itemId, false);
  // Clicking a row opens its sidebar; clicking the selected row again closes it.
  const select = (itemId: string) => setSelectedId((cur) => (cur === itemId ? null : itemId));

  const Num = ({ v }: { v: number | null }) => (
    <span className="hf-mono" style={{ fontSize: 12.5, color: v !== null && v < 0.2 ? H.bad : H.ink }}>
      {fmt3(v)}
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
      stageIndex={3}
      actions={
        <ExportButtons
          onCsv={async () => { await exportItemAnalysisCsv(provider, cycleId); provider.recordExport(cycleId, "Item analysis (CSV)"); }}
          onXlsx={async () => { await exportItemAnalysisXlsx(provider, cycleId); provider.recordExport(cycleId, "Item analysis (Excel)"); }}
        />
      }
      primary={
        <Link href={`/cycles/${cycleId}/diagnostics`}>
          <Button variant="pri" title="Continue to assessment health">
            Continue
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
      intro={
        <StepIntro>
          This step checks that each question behaved as intended. We review item-level statistics and content to
          spot questions that were too easy, too hard, ambiguous or mis-keyed, so no student is unfairly helped or
          penalised by a faulty item before we score.
        </StepIntro>
      }
    >
      {/* slim single control band: compact stats + filters + search + zoom */}
      <div className="hf-pad" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 24px", borderBottom: `1px solid ${H.line}`, background: H.paper, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <MiniStat n={String(model.kpis.items)} label="items" />
          <MiniStat n={String(model.kpis.excluded)} label="excluded" />
          <MiniStat n={fmt3(model.kpis.medianDifficulty)} label="median" />
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

      {/* question list (left) + deep-dive sidebar (right, opens on selection) */}
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
                    onSelect={() => select(it.id)}
                    Num={Num}
                  />
                ))}
              </tbody>
            </table>
            <div className="hf-sub" style={{ padding: "13px 26px" }}>
              Showing {view.length} of {model.items.length} questions · click a row to open its deep-dive
            </div>
            {/* Cronbach's α moved off the Question-review step — reliability now
                lives on the Assessment Health step (the shared computation is untouched). */}
          </div>
        </div>

        {/* right-hand deep-dive sidebar */}
        {selectedId && (
          <aside style={{ width: 400, flex: "0 0 auto", borderLeft: `1px solid ${H.line2}`, background: H.paper, overflow: "auto", boxShadow: `inset 3px 0 0 ${H.pink}` }}>
            {detail ? (
              <QuestionSidebar
                detail={detail}
                onExclude={exclude}
                onRestore={restore}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <div className="hf-sub" style={{ padding: 20 }}>Loading…</div>
            )}
          </aside>
        )}
      </div>
    </CycleShell>
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

/**
 * One question row — scannable, non-expandable. Clicking it opens the right-hand
 * deep-dive sidebar. Light at-a-glance columns only (IT-R is not shown here).
 */
function ItemRowView({
  it,
  qLabel,
  selected,
  onSelect,
  Num,
}: {
  it: ItemRow;
  qLabel: string;
  selected: boolean;
  onSelect: () => void;
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
      aria-selected={selected}
      style={{ background: selected ? H.pinkSoft2 : it.excluded ? H.tint : "transparent", opacity: it.excluded ? 0.62 : 1, cursor: "pointer", boxShadow: selected ? `inset 3px 0 0 ${H.pink}` : "none" }}
    >
      <td style={{ ...td, maxWidth: 420 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Clean question number (exam order). The internal Questionmark item
              ID is kept only as a hover tooltip, not shown as a raw long number. */}
          <span className="hf-mono" style={{ fontWeight: 700, fontSize: FONT, lineHeight: 1.1, flex: "0 0 auto" }} title={`Question ID (Questionmark): ${it.id}`}>{qLabel}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: FONT, textDecoration: it.excluded ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
            {firstLine(it.wording)}
          </span>
        </div>
      </td>
      <td style={{ ...td, maxWidth: 150, width: 150 }}>
        <div title={it.major ?? undefined} style={{ fontSize: FONT - 0.5, fontWeight: 600, maxWidth: 138, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.major ?? "—"}</div>
        <div title={it.sub ?? undefined} className="hf-sub" style={{ fontSize: 11, maxWidth: 138, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sub ?? ""}</div>
      </td>
      <td style={td}>{it.demand ? <Pill>{it.demand}</Pill> : null}</td>
      <td style={td}><QualityBar v={it.qualityIndex} width={70} /></td>
      <td style={{ ...td, textAlign: "right" }}><Num v={it.pValue} /></td>
      <td style={{ ...td, textAlign: "right" }}><Num v={it.pointBiserial} /></td>
      <td style={{ ...td, textAlign: "right" }}><Num v={it.discrimination} /></td>
      <td style={{ ...td, textAlign: "right", minWidth: 88 }} onClick={stop}>
        {it.excluded ? (
          <span className="hf-mono" style={{ fontSize: 10, color: ratingColor("Flag"), fontWeight: 700 }}>EXCLUDED</span>
        ) : (
          <Button variant="ghost" style={{ fontSize: 11.5, color: H.ink3 }} onClick={onSelect}>Open ›</Button>
        )}
      </td>
    </tr>
  );
}

/**
 * The question's multiple-choice answer options (from the Questionmark export),
 * lettered A–D in presented order. The correct option is marked with a check and
 * green tint; options with no correct answer recorded simply omit the marker.
 */
function AnswerOptions({ options }: { options: AnswerOption[] }) {
  return (
    <div style={{ marginTop: 9 }}>
      <div className="hf-lbl" style={{ marginBottom: 5 }}>Answer options</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {options.map((o) => (
          <div
            key={o.label}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              fontSize: 12,
              padding: "3px 8px",
              borderRadius: 6,
              background: o.correct ? H.goodSoft : "transparent",
              border: `1px solid ${o.correct ? H.good : H.line}`,
            }}
          >
            <span className="hf-mono" style={{ fontWeight: 700, color: o.correct ? H.good : H.ink2, flex: "0 0 auto" }}>{o.label}</span>
            <span style={{ flex: 1, color: H.ink }}>{o.text}</span>
            {o.correct && <span style={{ fontSize: 10.5, fontWeight: 700, color: H.good, flex: "0 0 auto" }}>✓ correct</span>}
          </div>
        ))}
      </div>
    </div>
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
    <div title={reason} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${H.line}` }}>
      <span style={{ flex: 1, fontSize: 12, color: H.ink2 }}>{label}</span>
      {/* undefined statistics (zero-variance correlations) render blank, never 0 */}
      <span className="hf-mono" style={{ fontSize: 13.5, fontWeight: 600, minWidth: 52, textAlign: "right", color: H.ink }}>{value}</span>
      <RatingChip rating={rating} />
    </div>
  );
}

/** A labelled content attribute (max score, demand, description). */
function Attr({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{label}</span>
      <span style={{ fontSize: 12, color: H.ink, fontWeight: 600 }}>{children}</span>
    </div>
  );
}

/**
 * Right-hand deep-dive for the selected question.
 *   Content  — stem, stimulus/parent passage, options (correct marked),
 *              max score, demand level, description.
 *   Statistics — P-Value, Point-Biserial (PT-BIS), Discrimination + ratings and
 *              the overall rating. IT-R is deliberately absent from this view.
 *   What these mean — plain-language definitions of each displayed statistic.
 *   Exclude / restore controls.
 *
 * Every statistic is read straight from P-B's computed output (ItemDetailModel);
 * nothing is recomputed here. Correlations/discrimination show to 3 dp; undefined
 * values render blank.
 */
function QuestionSidebar({
  detail,
  onExclude,
  onRestore,
  onClose,
}: {
  detail: ItemDetailModel;
  onExclude: (id: string, r: string) => void;
  onRestore: (id: string) => void;
  onClose: () => void;
}) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [showDefs, setShowDefs] = useState(false);

  const total = Math.max(1, detail.outcome.correct + detail.outcome.incorrect + detail.outcome.notAnswered);
  const pct = (n: number) => Math.round((n / total) * 100);
  const seg = [
    { k: "Correct", n: detail.outcome.correct, c: H.good },
    { k: "Incorrect", n: detail.outcome.incorrect, c: H.bad },
    { k: "Not answered", n: detail.outcome.notAnswered, c: H.ink3 },
  ];
  const gmax = Math.max(detail.groups.upperMean, detail.groups.lowerMean, 0.001);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* sticky header — question id, demand, overall rating, close */}
      <div style={{ position: "sticky", top: 0, zIndex: 2, background: H.paper, borderBottom: `1px solid ${H.line2}`, padding: "14px 18px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="hf-mono" style={{ fontWeight: 700, fontSize: 15 }} title={`Question ID (Questionmark): ${detail.id}`}>{detail.qLabel}</span>
        {detail.demand && <Pill>{detail.demand}</Pill>}
        <RatingChip rating={detail.overallReview} />
        {detail.excluded && <span className="hf-mono" style={{ fontSize: 10, color: H.bad, fontWeight: 700 }}>EXCLUDED</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} aria-label="Close" title="Close" style={{ border: "none", background: "transparent", cursor: "pointer", padding: 4, display: "inline-flex", borderRadius: 6, color: H.ink3 }}>
          <Icon name="x" size={14} color={H.ink3} />
        </button>
      </div>

      <div style={{ padding: "16px 18px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* ── Content ─────────────────────────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="hf-lbl">Content</span>

          {/* stimulus / parent passage (English reading/listening context), when present */}
          {detail.parentWording && (
            <div style={{ padding: "9px 11px", borderRadius: 8, background: H.canvas, border: `1px solid ${H.line}` }}>
              <div className="hf-lbl" style={{ fontSize: 9.5, marginBottom: 4 }}>Stimulus / passage</div>
              <div style={{ fontSize: 12, color: H.ink2, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{detail.parentWording}</div>
            </div>
          )}

          {/* question stem */}
          <div style={{ fontSize: 13, color: H.ink, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{detail.wording ?? "—"}</div>

          {/* options with the correct answer marked */}
          {detail.options && detail.options.length > 0 && <AnswerOptions options={detail.options} />}

          {/* attributes: max score, demand, description */}
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", paddingTop: 4 }}>
            <Attr label="Max score">{detail.maxScore}</Attr>
            <Attr label="Demand level">{detail.demand ?? "—"}</Attr>
            {detail.major && <Attr label="Curriculum">{detail.major}{detail.sub ? ` · ${detail.sub}` : ""}</Attr>}
          </div>
          {detail.description && (
            <div className="hf-sub" style={{ fontSize: 10.5 }} title="QuestionDescription (internal item code)">{detail.description}</div>
          )}
        </section>

        {/* ── Statistics ──────────────────────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span className="hf-lbl">Statistics</span>
            <div style={{ flex: 1 }} />
            <span className="hf-sub" style={{ fontSize: 10.5 }}>{detail.answered}/{detail.presented} answered</span>
          </div>
          {/* P-Value, Point-Biserial, Discrimination — IT-R is not shown here */}
          <StatRow label="P-Value (difficulty)" value={fmt3(detail.pValue)} rating={detail.pRating} reason={detail.reasons.p} />
          <StatRow label="Point-Biserial (PT-BIS)" value={fmt3(detail.pointBiserial)} rating={detail.pbRating} reason={detail.reasons.pb} />
          <StatRow label="Item Discrimination" value={fmt3(detail.discrimination)} rating={detail.discRating} reason={detail.reasons.disc} />
          <div title={detail.reasons.overall} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0" }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: H.ink }}>Overall rating</span>
            <RatingChip rating={detail.overallReview} />
          </div>
        </section>

        {/* discrimination groups — top/bottom split */}
        <section>
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
        </section>

        {/* response outcome — compact bar + inline legend */}
        <section>
          <div className="hf-lbl" style={{ marginBottom: 6 }}>Response outcome</div>
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
        </section>

        {/* ── What these mean (plain-language definitions) ─────────────────── */}
        <section style={{ borderTop: `1px solid ${H.line}`, paddingTop: 12 }}>
          <button
            onClick={() => setShowDefs((v) => !v)}
            aria-expanded={showDefs}
            className="hf-btn ghost"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, padding: "2px 0" }}
          >
            <span style={{ display: "inline-flex", transform: showDefs ? "rotate(90deg)" : "none", transition: "transform .12s" }}>
              <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5L8 6l-4 3.5" fill="none" stroke={H.ink3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            What these mean
          </button>
          {showDefs && <StatDefinitions />}
        </section>

        {/* exclude / restore */}
        <section style={{ borderTop: `1px solid ${H.line}`, paddingTop: 12 }}>
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
        </section>
      </div>
    </div>
  );
}

/**
 * Plain-language definitions for each statistic shown in this view (KK's
 * request). IT-R is not displayed here, so it is deliberately not defined. These
 * describe the analyst's validated method (P-B).
 */
function StatDefinitions() {
  const Def = ({ term, children }: { term: string; children: ReactNode }) => (
    <div style={{ marginBottom: 9 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: H.ink, marginBottom: 2 }}>{term}</div>
      <div style={{ fontSize: 11.5, color: H.ink2, lineHeight: 1.5 }}>{children}</div>
    </div>
  );
  return (
    <div style={{ marginTop: 10, padding: "12px 13px", borderRadius: 8, background: H.canvas, border: `1px solid ${H.line}` }}>
      <Def term="P-Value (facility / difficulty)">
        The average score on this item across students — how easy it was. Guide: 0.30–0.85 is healthy; 0.20–0.30 or
        0.85–0.90 is worth a review; outside that is flagged. Very high or very low values tell you little about
        differences between students.
      </Def>
      <Def term="Point-Biserial (PT-BIS)">
        How well the item tracks overall performance — the correlation between this item’s scores and each student’s
        total. Higher is better: ≥ 0.30 good, ≥ 0.10 review, below that flagged. Near-zero or negative suggests the
        item isn’t distinguishing or may be mis-keyed.
      </Def>
      <Def term="Item Discrimination">
        The top group’s average on this item minus the bottom group’s (students split into high/low groups by overall
        performance). Positive and larger is better: ≥ 0.30 good, ≥ 0.10 review, below that flagged.
      </Def>
      <Def term="Rating (Good / Review / Flag)">
        Each statistic gets a rating on the guides above; the item’s <b>overall</b> rating is Flag if any statistic
        flags, else Review if any needs review, else Good.
      </Def>
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
