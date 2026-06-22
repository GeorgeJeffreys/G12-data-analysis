"use client";

/**
 * Screen 02 — Clean data (the merged Raw data + Clean step). The raw-data view
 * and the cleaning controls now live together: a summary band + element / demand
 * breakdown of exactly what was uploaded, then the select rows / columns to
 * remove + validation report (must-fix blockers vs warnings) with the
 * before → after effect. The raw file is never touched — removals are a recorded,
 * non-destructive decision (like duplicate resolution), so scoring and parity are
 * unaffected.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { AssessmentTabs } from "@/components/shell/AssessmentTabs";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark, type MarkKind } from "@/components/ui/icons";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";
import { RawSpreadsheet } from "@/components/cycle/RawSpreadsheet";
import type { RawDataModel } from "@/lib/data/types";

export default function CleanPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";
  const first = useProviderData((p) => p.getCycle(cycleId)?.assessments[0]?.id, [cycleId]);
  const [scope, setScope] = useState<string | undefined>(undefined);
  const assessmentId = scope ?? first ?? "";
  const model = useProviderData((p) => (assessmentId ? p.getDataCleaning(cycleId, assessmentId) : null), [cycleId, assessmentId]);
  // Raw-data view (summary band + element/demand breakdown) folded into Clean:
  // the same read-only overview that used to live on the separate Raw data step.
  const raw = useProviderData((p) => (assessmentId ? p.getRawData(cycleId, assessmentId) : null), [cycleId, assessmentId]);
  const { zoom, setZoom, scrollRef, zoomWrapStyle } = useTableZoom();

  // local, non-destructive selection of rows / columns to remove
  const [selCols, setSelCols] = useState<Set<string>>(new Set());
  const [selRows, setSelRows] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const after = useMemo(() => (model ? model.rowsBefore - selRows.size : 0), [model, selRows]);

  if (!model) {
    return (
      <CycleShell cycleId={cycleId} cycleName={cycleName} page="Clean data" stageIndex={1}>
        <div style={{ padding: 32 }} className="hf-sub">No data for this sitting.</div>
      </CycleShell>
    );
  }

  const blocked = !model.canProceed;
  const selCount = selCols.size + selRows.size;

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Clean data"
      stageIndex={1}
      actions={<Button variant="ghost" onClick={() => { setSelCols(new Set()); setSelRows(new Set()); }}><Icon name="refresh" />Revert all</Button>}
      primary={
        <Link href={blocked ? "#" : `/cycles/${cycleId}/raw-scores`} tabIndex={blocked ? -1 : undefined}>
          <Button variant="pri" disabled={blocked} title={blocked ? "Resolve the blocker first" : "Clean & continue"}>
            Continue
            <Icon name="arrow" color="#fff" />
          </Button>
        </Link>
      }
      subjectTabs={
        <AssessmentTabs
          activeId={assessmentId}
          tabs={model.assessments.map((a) => ({ id: a.id, label: a.shortName, rtl: a.rtl }))}
          onSelect={(id) => { setScope(id); setSelCols(new Set()); setSelRows(new Set()); }}
          right={<ZoomControl zoom={zoom} onZoom={setZoom} />}
        />
      }
    >
      <div style={{ display: "flex", flex: 1, alignItems: "stretch", minHeight: 0 }}>
        {/* main: raw-data overview + select + table */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "16px 24px", gap: 12, minWidth: 0 }}>
          {/* Raw-data view (folded in from the old Raw data step): a read-only
              summary of exactly what was uploaded, before any cleaning. */}
          {raw && <RawOverview model={raw} />}
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="hf-h2" style={{ fontSize: 16 }}>Clean data — {model.assessment.shortName}</div>
              <div className="hf-sub" style={{ fontSize: 12, marginTop: 2 }}>Remove columns and rows you don’t need, work any flagged values, then continue. Your raw file is never touched.</div>
            </div>
            <div className="hf-card" style={{ padding: "8px 16px", display: "flex", gap: 14, alignItems: "center", background: H.canvas }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}><span className="hf-mono" style={{ fontSize: 16, fontWeight: 600, color: H.ink3 }}>{model.rowsBefore}</span><span className="hf-lbl" style={{ fontSize: 9 }}>before</span></div>
              <Icon name="arrow" size={14} color={H.ink3} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}><span className="hf-mono" style={{ fontSize: 16, fontWeight: 600, color: after < model.rowsBefore ? H.pink : H.ink }}>{after}</span><span className="hf-lbl" style={{ fontSize: 9 }}>after</span></div>
              <div style={{ width: 1, height: 28, background: H.line2 }} />
              <span className="hf-sub" style={{ fontSize: 11 }}>{selRows.size} row{selRows.size === 1 ? "" : "s"} ·<br />{selCols.size} column{selCols.size === 1 ? "" : "s"} selected</span>
            </div>
          </div>

          {/* selection action bar */}
          <div style={{ display: "flex", gap: 12, padding: "9px 15px", borderRadius: 10, background: H.slate, color: H.cream, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#fff" }}>
              {selCount === 0 ? "Click a column header or a row to select it for removal" : `${selCols.size} column · ${selRows.size} row selected`}
            </span>
            <div style={{ flex: 1 }} />
            <Button style={{ fontSize: 11.5, background: "transparent", borderColor: H.slate2, color: H.cream }} onClick={() => { setSelCols(new Set()); setSelRows(new Set()); }}>Clear</Button>
            <Button variant="danger" disabled={selCount === 0} style={{ fontSize: 11.5, background: H.paper }}>
              <Icon name="trash" size={12} color={H.bad} />Delete selected
            </Button>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="hf-lbl">Select rows / columns to remove</span>
            <div style={{ flex: 1 }} />
            <span className="hf-sub" style={{ fontSize: 11, fontStyle: "italic" }}>scroll → for all items · click headers/rows to select</span>
          </div>

          <RawSpreadsheet
            model={model}
            scrollRef={scrollRef}
            zoomWrapStyle={zoomWrapStyle}
            maxHeight={440}
            rtl={model.assessment.rtl}
            selectable
            selCols={selCols}
            selRows={selRows}
            onToggleCol={(id) => setSelCols((s) => toggle(s, id))}
            onToggleRow={(id) => setSelRows((s) => toggle(s, id))}
          />
        </div>

        {/* right rail: validation report */}
        <aside style={{ width: 320, flex: "0 0 auto", borderLeft: `1px solid ${H.line2}`, background: H.paper, padding: "18px 18px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="hf-lbl">Validation report</span>
            <div style={{ flex: 1 }} />
            {model.counts.fail > 0 && <Badge tone="bad">{model.counts.fail} must fix</Badge>}
            {model.counts.warn > 0 && <Badge tone="warn">{model.counts.warn} warnings</Badge>}
          </div>
          {model.checks.map((c) => (
            <div key={c.id} className="hf-card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, borderColor: c.status === "fail" ? H.bad : H.line2, background: c.status === "fail" ? H.badSoft : H.paper }}>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
                <Mark kind={c.status as MarkKind} size={15} />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: c.status === "pass" ? 500 : 700 }}>{c.title}</span>
                {c.count && <span className="hf-mono" style={{ fontSize: 11, color: c.status === "fail" ? H.bad : c.status === "warn" ? H.warn : H.ink3 }}>{c.count}</span>}
              </div>
              {c.detail && <div className="hf-sub" style={{ fontSize: 11, paddingLeft: 24 }}>{c.detail}</div>}
              {c.action && <div style={{ paddingLeft: 24 }}><Button variant={c.status === "fail" ? "pri" : "default"} style={{ fontSize: 11, padding: "5px 11px" }}>{c.action}</Button></div>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 10, background: blocked ? H.badSoft : H.goodSoft, alignItems: "center" }}>
            <Mark kind={blocked ? "fail" : "pass"} size={15} />
            <span style={{ fontSize: 11.5, color: H.ink }}>
              {blocked ? `${model.counts.fail} blocker${model.counts.fail === 1 ? "" : "s"} must be resolved. Warnings are your call.` : "No blockers — warnings are your call. Ready to continue."}
            </span>
          </div>
        </aside>
      </div>
    </CycleShell>
  );
}

/**
 * Read-only raw-data overview, folded in from the old standalone Raw data step:
 * exactly what was uploaded, before any cleaning — a compact summary band plus the
 * by-element and by-demand breakdowns. The editable spreadsheet below is the
 * cleaning surface; this block is purely "show me my data".
 *
 * The breakdown panels are COLLAPSED BY DEFAULT so the overview keeps a small
 * vertical footprint and the selectable table below stays reachable within the
 * viewport (even at full screen on a laptop). The key figures stay visible in the
 * always-on summary band; the per-element / per-demand detail expands on demand.
 */
function RawOverview({ model }: { model: RawDataModel }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const stat = (n: string | number, label: string, accent?: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 16px", borderLeft: `1px solid ${H.line}` }}>
      <span className="hf-mono" style={{ fontSize: String(n).length > 6 ? 15 : 18, fontWeight: 600, color: accent ? H.pink : H.ink }}>{n}</span>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{label}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* summary band — always on, compact. Carries the headline figures and the
          single toggle that reveals the (taller) per-element / per-demand panels. */}
      <div style={{ display: "flex", alignItems: "center", border: `1px solid ${H.line2}`, borderRadius: 10, background: H.paper, padding: "9px 0", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 16px" }}>
          <span className="hf-mono" style={{ fontSize: 18, fontWeight: 600 }}>{model.participants}</span>
          <span className="hf-lbl" style={{ fontSize: 9.5 }}>Participants</span>
        </div>
        {stat(model.items, "Items", true)}
        {stat(model.elementsCount, "Major elements")}
        {stat(model.subElementsCount, "Sub-elements")}
        {stat(`${model.demand.D1}·${model.demand.D2}·${model.demand.D3}`, "D1·D2·D3")}
        <div style={{ flex: 1, minWidth: 12 }} />
        <button
          type="button"
          onClick={() => setShowBreakdown((v) => !v)}
          aria-expanded={showBreakdown}
          className="hf-btn ghost"
          style={{ fontSize: 11.5, margin: "0 14px", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
        >
          {showBreakdown ? "Hide breakdown" : "Show breakdown"}
          <span style={{ display: "inline-flex", transform: showBreakdown ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
            <Icon name="chev" size={12} color={H.ink3} />
          </span>
        </button>
      </div>

      {/* breakdowns: by major element + by demand — collapsed by default */}
      {showBreakdown && (
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", padding: "14px 18px", border: `1px solid ${H.line}`, borderRadius: 10, background: H.paper }}>
        <div style={{ flex: 2, minWidth: 280, display: "flex", flexDirection: "column", gap: 9 }}>
          <span className="hf-lbl">Items by major element &amp; sub-element</span>
          {model.byElement.map((el, i) => {
            const max = Math.max(...model.byElement.map((e) => e.items), 1);
            return (
              <div key={el.major} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="hf-mono" style={{ width: 16, height: 16, borderRadius: 5, background: H.tint2, color: H.ink2, fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{String.fromCharCode(65 + i)}</span>
                <span style={{ flex: 1, fontSize: 12, color: H.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${el.major} — ${el.subs.length} sub-element${el.subs.length === 1 ? "" : "s"}: ${el.subs.join(", ")}`}>
                  {el.major} <span className="hf-sub" style={{ fontSize: 10.5 }}>· {el.subs.length} sub</span>
                </span>
                <div style={{ width: 90, height: 8, background: H.tint2, borderRadius: 5, flex: "0 0 auto" }}><div style={{ width: `${(el.items / max) * 100}%`, height: "100%", background: H.bar, borderRadius: 5 }} /></div>
                <span className="hf-mono" style={{ width: 22, fontSize: 11.5, textAlign: "right", flex: "0 0 auto" }}>{el.items}</span>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 190, display: "flex", flexDirection: "column", gap: 9, borderLeft: `1px solid ${H.line}`, paddingLeft: 22 }}>
          <span className="hf-lbl">Items by demand level</span>
          {([["D1", model.demand.D1, "Less demanding"], ["D2", model.demand.D2, "Moderately demanding"], ["D3", model.demand.D3, "More demanding"]] as const).map(([d, v, name]) => {
            const dmax = Math.max(model.demand.D1, model.demand.D2, model.demand.D3, 1);
            return (
              <div key={d} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="hf-mono" style={{ fontSize: 11, fontWeight: 700, color: H.ink2, width: 20, flex: "0 0 auto" }}>{d}</span>
                <span style={{ flex: 1, fontSize: 11.5, color: H.ink2, whiteSpace: "nowrap" }}>{name}</span>
                <div style={{ width: 64, height: 8, background: H.tint2, borderRadius: 5, flex: "0 0 auto" }}><div style={{ width: `${(v / dmax) * 100}%`, height: "100%", background: H.bar, borderRadius: 5 }} /></div>
                <span className="hf-mono" style={{ width: 22, fontSize: 11.5, textAlign: "right", flex: "0 0 auto" }}>{v}</span>
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
