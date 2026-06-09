"use client";

/**
 * Screen 06 — Grades & sign-off. Shows every participant's section + overall
 * grade (computed by the provider/engine from the boundaries), the overall
 * distribution, CSV / Excel export, and the Lead-only lock & sign-off flow.
 * Once locked the cycle is read-only until re-opened.
 */
import { useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { MiniGradeBars } from "@/components/ui/charts";
import type { GradesModel } from "@/lib/data/types";

export default function GradesPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const model = useProviderData((p) => p.getGrades(cycleId), [cycleId]);
  const user = provider.getCurrentUser();
  const [confirming, setConfirming] = useState(false);

  if (!model) {
    return (
      <Shell crumb={[{ label: "Cycles", href: "/" }, { label: "Grades" }]}>
        <div style={{ padding: 32 }} className="hf-sub">No grades for this cycle.</div>
      </Shell>
    );
  }

  const lock = () => {
    provider.lockCycle(cycleId);
    setConfirming(false);
  };
  const unlock = () => provider.unlockCycle(cycleId);

  return (
    <Shell
      crumb={[
        { label: "Cycles", href: "/" },
        { label: "May 2026", href: `/cycles/${cycleId}` },
        { label: "Grades & sign-off" },
      ]}
      stageIndex={5}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => exportCsv(model)}>
            <Icon name="doc" />
            Export CSV
          </Button>
          <Button variant="ghost" onClick={() => exportExcel(model)}>
            <Icon name="doc" />
            Export Excel
          </Button>
        </div>
      }
      stageAction={
        model.locked ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: H.good, fontWeight: 700, fontSize: 12.5 }}>
            <Mark kind="pass" size={16} /> Locked &amp; signed off
          </span>
        ) : (
          <Button variant="pri" disabled={!model.canLock} onClick={() => setConfirming(true)}>
            <Icon name="lock" color="#fff" />
            Lock grades
          </Button>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 32px", gap: 20, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div className="hf-h1">Grades &amp; sign-off</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>
              Every student’s section and overall grade. Review, then lock to publish.
            </div>
          </div>
          <div className="hf-card" style={{ padding: "13px 18px", display: "flex", gap: 18, alignItems: "center" }}>
            <span className="hf-lbl">Overall distribution</span>
            <MiniGradeBars data={model.distribution} />
          </div>
        </div>

        {model.locked && (
          <div className="hf-card" style={{ padding: "13px 17px", background: H.goodSoft, borderColor: H.good, display: "flex", gap: 12, alignItems: "center" }}>
            <Mark kind="pass" size={18} />
            <span style={{ fontSize: 13, flex: 1 }}>
              Grades are locked and signed off by {user.name}. The cycle is read-only.
            </span>
            {user.role === "lead_admin" && (
              <Button variant="ghost" onClick={unlock}>Re-open cycle</Button>
            )}
          </div>
        )}

        <div className="hf-card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="hf-th">Participant</th>
                {model.assessments.map((a) => (
                  <th key={a.id} className="hf-th" style={{ textAlign: "center" }}>{a.shortName.split(" ")[0]}</th>
                ))}
                <th className="hf-th" style={{ textAlign: "center" }}>Overall</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((r) => (
                <tr key={r.id} className="hf-hover">
                  <td className="hf-td">
                    <span className="hf-mono" style={{ fontSize: 11, color: H.ink3, marginRight: 10 }}>{r.id}</span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</span>
                  </td>
                  {model.assessments.map((a) => (
                    <td key={a.id} className="hf-td" style={{ textAlign: "center" }}>
                      <GradeBadge g={r.grades[a.id] ?? "–"} />
                    </td>
                  ))}
                  <td className="hf-td" style={{ textAlign: "center" }}>
                    <GradeBadge g={r.overall} big />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!model.locked && (
          <div style={{ display: "flex", gap: 16, marginTop: "auto", alignItems: "stretch" }}>
            <div className="hf-card" style={{ padding: "15px 19px", flex: 1, display: "flex", gap: 13, alignItems: "center", background: H.tint }}>
              <Mark kind="warn" size={18} />
              <span style={{ fontSize: 13 }}>
                Locking writes a signed, timestamped record and freezes all {model.assessments.length} assessments. Boundaries can’t change afterward without re-opening the cycle.
              </span>
            </div>
            {confirming ? (
              <div className="hf-card" style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: 8, justifyContent: "center", minWidth: 230 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Lock and sign off now?</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="pri" onClick={lock}><Icon name="lock" color="#fff" />Confirm lock</Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button
                variant="pri"
                style={{ padding: "13px 24px", fontSize: 13.5 }}
                disabled={!model.canLock}
                onClick={() => setConfirming(true)}
                title={model.canLock ? undefined : "Only a Lead can lock grades"}
              >
                <Icon name="lock" color="#fff" />
                Lock grades &amp; sign off
              </Button>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

function GradeBadge({ g, big }: { g: string; big?: boolean }) {
  return (
    <span
      style={{
        width: big ? 30 : 23,
        height: big ? 30 : 23,
        border: `1px solid ${big ? H.pink : H.line2}`,
        borderRadius: 7,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        fontSize: big ? 14 : 11.5,
        background: big ? H.pink : H.paper,
        color: big ? "#fff" : H.ink,
      }}
    >
      {g}
    </span>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv(model: GradesModel) {
  const header = ["Participant ID", "Participant", ...model.assessments.map((a) => a.name), "Overall"];
  const lines = [header.join(",")];
  for (const r of model.rows) {
    const cells = [r.id, r.label, ...model.assessments.map((a) => r.grades[a.id] ?? ""), r.overall];
    lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
  }
  downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }), "grades_may_2026.csv");
}

async function exportExcel(model: GradesModel) {
  // Uses the existing export module (lib/export) — same workbook the backend
  // produces. xlsx-js-style runs fine in the browser.
  const { buildGradesWorkbook, workbookToBuffer } = await import("@/lib/export");
  const wb = buildGradesWorkbook({
    assessments: model.assessments.map((a) => ({ id: a.id, name: a.name })),
    participants: model.rows.map((r) => ({ id: r.id, label: r.label })),
    grades: [
      ...model.rows.flatMap((r) =>
        model.assessments.map((a) => ({ participantId: r.id, scope: a.id, gradeLabel: r.grades[a.id] ?? null, score: null })),
      ),
      ...model.rows.map((r) => ({ participantId: r.id, scope: "overall", gradeLabel: r.overall, score: null })),
    ],
  });
  const buf = workbookToBuffer(wb);
  // Copy into a plain ArrayBuffer-backed view for Blob (avoids SharedArrayBuffer typing).
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "grades_may_2026.xlsx");
}
