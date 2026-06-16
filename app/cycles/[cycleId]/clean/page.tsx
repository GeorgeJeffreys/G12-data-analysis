"use client";

/**
 * Screen 03 — Data cleaning (a dedicated clean-only step; viewing lives on Raw
 * data). Ports design/hfFront.jsx · HFCleanSeparate: select rows / columns to
 * remove, work the validation report (must-fix blockers vs warnings), and see
 * the before → after effect. The raw file is never touched — removals are a
 * recorded, non-destructive decision (like duplicate resolution), so scoring and
 * parity are unaffected.
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

export default function CleanPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Cycle";
  const first = useProviderData((p) => p.getCycle(cycleId)?.assessments[0]?.id, [cycleId]);
  const [scope, setScope] = useState<string | undefined>(undefined);
  const assessmentId = scope ?? first ?? "";
  const model = useProviderData((p) => (assessmentId ? p.getDataCleaning(cycleId, assessmentId) : null), [cycleId, assessmentId]);
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
      <CycleShell cycleId={cycleId} cycleName={cycleName} page="Clean data" stageIndex={2}>
        <div style={{ padding: 32 }} className="hf-sub">No data for this cycle.</div>
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
      stageIndex={2}
      actions={<Button variant="ghost" onClick={() => { setSelCols(new Set()); setSelRows(new Set()); }}><Icon name="refresh" />Revert all</Button>}
      primary={
        <Link href={blocked ? "#" : `/cycles/${cycleId}/raw-scores`} tabIndex={blocked ? -1 : undefined}>
          <Button variant="pri" disabled={blocked} title={blocked ? "Resolve the blocker first" : undefined}>
            {blocked ? "Resolve blockers to continue" : "Clean & continue"}
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
        {/* main: select + table */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "16px 24px", gap: 12, minWidth: 0 }}>
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
