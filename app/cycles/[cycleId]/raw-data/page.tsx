"use client";

/**
 * Screen 02 — Raw data view (the first "show me my data" step after upload).
 * Ports design/hfFront.jsx · HFRawView: a read-first view of exactly what was
 * uploaded, before any analysis — a summary band, an element / sub-element /
 * demand breakdown (counts vary per subject, never hard-coded), and the dataset
 * as a scrollable, sticky-header spreadsheet. Editing happens later in Clean.
 */
import { useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell, Alert } from "@/components/shell/CycleShell";
import { AssessmentTabs } from "@/components/shell/AssessmentTabs";
import { Button } from "@/components/ui/primitives";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { downloadCsv, downloadScoreAnalysisXlsx, scoreData, scoreDatasetCsv } from "@/lib/ui/analysis-exports";
import { fileStem } from "@/lib/ui/export";
import { Icon } from "@/components/ui/icons";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";
import { RawSpreadsheet } from "@/components/cycle/RawSpreadsheet";

export default function RawDataPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Cycle";
  const first = useProviderData((p) => p.getCycle(cycleId)?.assessments[0]?.id, [cycleId]);
  const [scope, setScope] = useState<string | undefined>(undefined);
  const assessmentId = scope ?? first ?? "";
  const model = useProviderData((p) => (assessmentId ? p.getRawData(cycleId, assessmentId) : null), [cycleId, assessmentId]);
  const { zoom, setZoom, scrollRef, zoomWrapStyle } = useTableZoom();

  if (!model) {
    return (
      <CycleShell cycleId={cycleId} cycleName={cycleName} page="Raw data" stageIndex={1}>
        <div style={{ padding: 32 }} className="hf-sub">No data for this cycle.</div>
      </CycleShell>
    );
  }

  const stat = (n: string | number, label: string, accent?: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 18px", borderLeft: `1px solid ${H.line}` }}>
      <span className="hf-mono" style={{ fontSize: String(n).length > 6 ? 17 : 21, fontWeight: 600, color: accent ? H.pink : H.ink }}>{n}</span>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{label}</span>
    </div>
  );

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Raw data"
      stageIndex={1}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ExportButtons
            onCsv={() => {
              const data = scoreData(provider, cycleId, true);
              if (!data) return;
              const { headers, rows } = scoreDatasetCsv(data);
              downloadCsv(`${fileStem("raw_dataset", cycleName)}.csv`, headers, rows);
              provider.recordExport(cycleId, "Raw dataset (CSV)");
            }}
            onXlsx={async () => {
              const data = scoreData(provider, cycleId, true);
              if (!data) return;
              await downloadScoreAnalysisXlsx(data, `raw_score_analysis_${cycleName}`);
              provider.recordExport(cycleId, "Raw score analysis (Excel)");
            }}
          />
          <Link href={`/cycles/${cycleId}/clean`}><Button variant="ghost"><Icon name="refresh" />Clean data</Button></Link>
        </div>
      }
      primary={<Link href={`/cycles/${cycleId}/clean`}><Button variant="pri">Looks right — continue<Icon name="arrow" color="#fff" /></Button></Link>}
      subjectTabs={
        <AssessmentTabs
          activeId={assessmentId}
          tabs={model.assessments.map((a) => ({ id: a.id, label: a.shortName, rtl: a.rtl }))}
          onSelect={setScope}
          right={<ZoomControl zoom={zoom} onZoom={setZoom} />}
        />
      }
      alerts={<Alert tone="info" action={<Link href={`/cycles/${cycleId}/clean`} style={{ fontSize: 11.5, color: H.pink, fontWeight: 600 }}>Open Clean →</Link>}>This is exactly what you uploaded, <b>before any analysis</b> — a read-only view. Editing happens in Clean.</Alert>}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "18px 28px", gap: 14, flex: 1, minWidth: 0 }}>
        <div>
          <div className="hf-h2" style={{ fontSize: 16 }}>{model.assessment.name} — your raw data</div>
        </div>

        {/* summary band */}
        <div style={{ display: "flex", alignItems: "stretch", border: `1px solid ${H.line2}`, borderRadius: 10, background: H.paper, padding: "12px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 18px" }}>
            <span className="hf-mono" style={{ fontSize: 21, fontWeight: 600 }}>{model.participants}</span>
            <span className="hf-lbl" style={{ fontSize: 9.5 }}>Participants</span>
          </div>
          {stat(model.items, "Items", true)}
          {stat(model.elementsCount, "Major elements")}
          {stat(model.subElementsCount, "Sub-elements")}
          {stat(`${model.demand.D1}·${model.demand.D2}·${model.demand.D3}`, "D1·D2·D3")}
        </div>

        {/* breakdowns: by major element + by demand */}
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

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="hf-lbl">{model.assessment.shortName} · raw responses</span>
          <span className="hf-sub" style={{ fontSize: 11.5 }}>{model.rows.length} rows × {model.items} items · 1 correct · 0 incorrect · – omitted</span>
          <div style={{ flex: 1 }} />
          <span className="hf-sub" style={{ fontSize: 11, fontStyle: "italic" }}>scroll → to see all items</span>
        </div>

        <RawSpreadsheet model={model} scrollRef={scrollRef} zoomWrapStyle={zoomWrapStyle} maxHeight={460} rtl={model.assessment.rtl} />
      </div>
    </CycleShell>
  );
}
