"use client";

/**
 * Screen 04 — Naive (raw) overall scores. Ports design/hfFront.jsx · HFNaiveScores:
 * what every student scored straight from their answers, with NO items removed —
 * a pre-exclusion sanity check before item review, clearly labelled so it's never
 * confused with final scores. Pre-exclusion is distinct from the post-exclusion
 * scoring used downstream; it never touches how item statistics are computed.
 */
import { useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell, Alert, AlertStack } from "@/components/shell/CycleShell";
import { AssessmentTabs } from "@/components/shell/AssessmentTabs";
import { Button, Avatar } from "@/components/ui/primitives";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { downloadCsv, downloadScoreAnalysisXlsx, overallScoreCsv, scoreData } from "@/lib/ui/analysis-exports";
import { fileStem } from "@/lib/ui/export";
import { Icon } from "@/components/ui/icons";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";

export default function RawScoresPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";
  const first = useProviderData((p) => p.getCycle(cycleId)?.assessments[0]?.id, [cycleId]);
  const [scope, setScope] = useState<string | undefined>(undefined);
  const assessmentId = scope ?? first ?? "";
  const model = useProviderData((p) => (assessmentId ? p.getNaiveScores(cycleId, assessmentId) : null), [cycleId, assessmentId]);
  const { zoom, setZoom, scrollRef, zoomWrapStyle } = useTableZoom();

  if (!model) {
    return (
      <CycleShell cycleId={cycleId} cycleName={cycleName} page="Raw scores" stageIndex={2}>
        <div style={{ padding: 32 }} className="hf-sub">No data for this sitting.</div>
      </CycleShell>
    );
  }

  const reviewHref = `/cycles/${cycleId}/review/${encodeURIComponent(assessmentId)}`;

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Raw scores"
      stageIndex={2}
      actions={
        <ExportButtons
          onCsv={() => {
            const data = scoreData(provider, cycleId, true);
            if (!data) return;
            const { headers, rows } = overallScoreCsv(data);
            downloadCsv(`${fileStem("naive_overall_scores", cycleName)}.csv`, headers, rows);
            provider.recordExport(cycleId, "Naive (pre-exclusion) scores (CSV)");
          }}
          onXlsx={async () => {
            const data = scoreData(provider, cycleId, true);
            if (!data) return;
            await downloadScoreAnalysisXlsx(data, `naive_score_analysis_${cycleName}`);
            provider.recordExport(cycleId, "Naive (pre-exclusion) score analysis (Excel)");
          }}
        />
      }
      primary={<Link href={reviewHref}><Button variant="pri" title="Continue to item review">Continue<Icon name="arrow" color="#fff" /></Button></Link>}
      subjectTabs={
        <AssessmentTabs
          activeId={assessmentId}
          tabs={model.assessments.map((a) => ({ id: a.id, label: a.shortName, rtl: a.rtl }))}
          onSelect={setScope}
          right={<ZoomControl zoom={zoom} onZoom={setZoom} />}
        />
      }
      alerts={
        <AlertStack
          notices={[
            {
              key: "as-submitted",
              tone: "warn",
              message: (
                <>
                  <b>Scores as-submitted — before any item review.</b> No questions have been dropped yet; final scores can change once weak items are reviewed.
                </>
              ),
              action: <span className="hf-mono" style={{ fontSize: 11.5, color: H.warn, fontWeight: 700 }}>0 items excluded</span>,
            },
          ]}
        />
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "16px 28px", gap: 12, flex: 1, minHeight: 0, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="hf-h2" style={{ fontSize: 16 }}>Raw scores — {model.assessment.shortName}</div>
            <div className="hf-sub" style={{ fontSize: 12, marginTop: 2 }}>
              Straight from the answers, no items removed{model.mcqItems !== model.totalItems ? ` (showing ${model.mcqItems} scored MCQ items of ${model.totalItems})` : ""}.
            </div>
          </div>
          <span className="hf-sub" style={{ fontSize: 11.5 }}>cohort average</span>
          <span className="hf-mono" style={{ fontSize: 15, fontWeight: 600 }}>{model.cohortAvgPct}%</span>
        </div>

        {model.hasEssay && (
          <Alert tone="info">This subject includes an essay-scored element marked offline; it’s added later in Adjustments. The raw score here is the MCQ items only.</Alert>
        )}

        <div ref={scrollRef} className="hf-card" style={{ overflow: "auto", flex: 1, minWidth: 0, padding: 0 }}>
          <div style={zoomWrapStyle}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
              <thead>
                <tr>
                  <th className="hf-th" style={{ position: "sticky", top: 0, width: 34, textAlign: "right" }}>#</th>
                  <th className="hf-th" style={{ position: "sticky", top: 0 }}>Participant</th>
                  {model.elements.map((e) => (
                    <th key={e.major} className="hf-th" style={{ position: "sticky", top: 0, textAlign: "center", minWidth: 52 }} title={e.major}>
                      {e.shortId} <span style={{ color: H.ink3, fontWeight: 400 }}>/{e.items}</span>
                    </th>
                  ))}
                  <th className="hf-th" style={{ position: "sticky", top: 0, textAlign: "right" }}>Raw score</th>
                  <th className="hf-th" style={{ position: "sticky", top: 0, textAlign: "right", minWidth: 150 }}>Percentage</th>
                  <th className="hf-th" style={{ position: "sticky", top: 0 }} />
                </tr>
              </thead>
              <tbody>
                {model.students.map((s, i) => (
                  <tr key={s.id} className="hf-hover">
                    <td className="hf-td hf-mono" style={{ color: H.ink3, fontSize: 11.5, textAlign: "right" }}>{i + 1}</td>
                    <td className="hf-td">
                      <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
                        <Avatar name={s.name} size={26} />
                        <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.name}</div><div className="hf-mono hf-sub" style={{ fontSize: 10.5 }}>{s.studentId}</div></div>
                      </div>
                    </td>
                    {model.elements.map((e) => (
                      <td key={e.major} className="hf-td hf-mono" style={{ textAlign: "center", color: H.ink2, fontSize: 12 }}>{s.perElement[e.major] ?? 0}</td>
                    ))}
                    <td className="hf-td hf-mono" style={{ textAlign: "right", fontWeight: 600 }}>{s.raw}<span style={{ color: H.ink3, fontWeight: 400 }}> / {model.mcqItems}</span></td>
                    <td className="hf-td">
                      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
                        <div style={{ width: 84, height: 7, background: H.tint2, borderRadius: 5, flex: "0 0 auto" }}><div style={{ width: `${s.pct}%`, height: "100%", background: H.bar, borderRadius: 5 }} /></div>
                        <span className="hf-mono" style={{ fontSize: 13, fontWeight: 600, width: 44, textAlign: "right" }}>{s.pct}%</span>
                      </div>
                    </td>
                    <td className="hf-td" style={{ textAlign: "right" }}>
                      <Link href={reviewHref}><Button variant="ghost" style={{ fontSize: 11 }}>Items<Icon name="arrow" size={12} /></Button></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hf-sub" style={{ fontSize: 12 }}>Click a subject above to see its raw scores, or drill into any student’s items.</div>
      </div>
    </CycleShell>
  );
}
