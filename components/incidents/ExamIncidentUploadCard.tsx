"use client";

/**
 * Technical Incident Upload — ingest the real 20-column technical-incident export
 * (`exam-incidents-YYYY-MM-DD.csv`), match each incident to a real sitting by
 * lowercased EMAIL within the active cycle, and STAGE it for the Incident
 * Adjustments step. Mirrors the essay masterfile upload UX
 * (`components/cycle/EssayMarksCard.tsx`): upload → review the row-by-row
 * reconciliation report → commit. Nothing is written until the operator confirms.
 *
 * STAGING ONLY — NO MARKS ARE ADJUSTED (see docs/incident-upload-findings.md, §3
 * gate). The export supplies no machine-readable remedy (`Action Taken` is free
 * text; `Code` classifies the issue, not the remedy; `Questions Affected (list)`
 * is empty), so records land matched + staged with the adjustment fields
 * unpopulated. A remedy is never guessed from `Action Taken`, `Code`, or
 * `Duration`. Composition of multiple incidents is deferred to the
 * adjudication/engine step (surfaced here only as a `multiple_incidents` flag).
 */
import { useRef, useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { parseExamIncidentFile } from "@/lib/incidents/exam-incident-parse";
import { matchExamIncidents } from "@/lib/incidents/exam-incident-match";
import type {
  ExamIncidentMatchContext,
  ExamIncidentReconciliation,
  ExamIncidentReportStatus,
} from "@/lib/incidents/exam-incident-match";

const STATUS_LABEL: Record<ExamIncidentReportStatus, string> = {
  matched: "Matched",
  out_of_scope_cycle: "Out of scope",
  staff_excluded: "Staff excluded",
  unmatched_email: "Unmatched email",
  unmatched_subject: "Unmatched subject",
  duplicate: "Duplicate (update)",
  error: "Error",
};

function toneFor(status: ExamIncidentReportStatus): "good" | "bad" | "warn" | "neutral" | "accent" {
  if (status === "matched") return "good";
  if (status === "error" || status === "unmatched_email" || status === "unmatched_subject") return "warn";
  if (status === "duplicate") return "accent";
  return "neutral"; // out_of_scope_cycle / staff_excluded — expected input, not a problem
}

export function ExamIncidentUploadCard({ cycleId }: { cycleId: string }) {
  const provider = useProvider();
  const context = useProviderData((p) => p.getExamIncidentMatchContext(cycleId), [cycleId]) as ExamIncidentMatchContext | null;
  const staged = useProviderData((p) => p.getExamIncidentsForCycle(cycleId), [cycleId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ExamIncidentReconciliation | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (!context) {
        setError("No cycle roster to match against — ingest the raw export first.");
        return;
      }
      const parsed = await parseExamIncidentFile(file);
      if (parsed.rows.length === 0) {
        setError("No incident rows found. Expected the 20-column technical-incident export (Reference, Exam Cycle, Subject, Student Email, …).");
        return;
      }
      const batchId = crypto.randomUUID();
      setReport(matchExamIncidents(parsed, context, { batchId, fileName: file.name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t read that file. Use the technical-incident CSV export.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const commit = () => {
    if (!report) return;
    provider.upsertExamIncidents(cycleId, report.batchId, report.fileName, report.records);
    setReport(null);
  };

  return (
    <div className="hf-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <Icon name="upload" size={15} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>Technical incident export</span>
        <Badge tone="neutral">Staged — no marks adjusted</Badge>
        <span style={{ flex: 1 }} />
        {staged.length > 0 && !report && (
          <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.clearExamIncidents(cycleId)}><Icon name="trash" size={13} />Remove</Button>
        )}
      </div>
      <div className="hf-sub" style={{ fontSize: 12, maxWidth: 720 }}>
        Upload the operations team’s <b style={{ color: H.ink }}>technical-incident export</b> (the 20-column CSV). Each
        incident is matched to a real sitting on the <b style={{ color: H.ink }}>lowercased email</b> within{" "}
        <span className="hf-mono" style={{ fontSize: 11 }}>{context?.activeCycleName ?? "the active cycle"}</span> and bucketed
        into a reconciliation report. Records are <b style={{ color: H.ink }}>staged, not adjusted</b> — the export carries no
        machine-readable remedy (<span className="hf-mono" style={{ fontSize: 11 }}>Action Taken</span> is free text), so no
        mark is changed. Re-uploading a corrected file updates by <span className="hf-mono" style={{ fontSize: 11 }}>Reference</span>.
      </div>

      {report ? (
        <ReconciliationPanel report={report} onCommit={commit} onCancel={() => setReport(null)} />
      ) : staged.length > 0 ? (
        <div className="hf-card" style={{ padding: "10px 14px", background: H.tint, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Mark kind="pass" size={15} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{staged.length} incident(s) staged</span>
          <span className="hf-sub" style={{ fontSize: 11.5 }}>
            {staged.filter((r) => r.matchStatus === "matched").length} matched ·{" "}
            {staged.filter((r) => r.matchStatus !== "matched").length} bucketed for attention
          </span>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="upload" size={13} />Re-upload / correct
          </Button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <Button onClick={() => fileRef.current?.click()} disabled={busy || !context}>
            <Icon name="upload" size={13} />{busy ? "Reading…" : "Upload incident export (CSV)"}
          </Button>
          {!context && <span className="hf-sub" style={{ fontSize: 11.5 }}>Ingest the raw export first.</span>}
          {error && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>{error}</span>}
        </div>
      )}
      {report && error && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>{error}</span>}
    </div>
  );
}

/** Review-before-commit: counts per reconciliation bucket + the per-row table. */
function ReconciliationPanel({ report, onCommit, onCancel }: { report: ExamIncidentReconciliation; onCommit: () => void; onCancel: () => void }) {
  const c = report.counts;
  // Matched first (sign-off), then the buckets needing attention, then expected input.
  const order: Record<ExamIncidentReportStatus, number> = {
    matched: 0, duplicate: 1, unmatched_email: 2, unmatched_subject: 3, error: 4, out_of_scope_cycle: 5, staff_excluded: 6,
  };
  const rows = [...report.rows].sort((a, b) => order[a.status] - order[b.status] || a.reference.localeCompare(b.reference));
  const stageable = report.records.length;
  return (
    <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: H.tint, borderBottom: `1px solid ${H.line2}`, flexWrap: "wrap" }}>
        <Icon name="eye" size={15} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Reconcile {report.fileName}</span>
        <span style={{ flex: 1 }} />
        <Badge tone="good">{c.matched} matched</Badge>
        {c.duplicate > 0 && <Badge tone="accent">{c.duplicate} duplicate</Badge>}
        {c.unmatched_email > 0 && <Badge tone="warn">{c.unmatched_email} unmatched email</Badge>}
        {c.unmatched_subject > 0 && <Badge tone="warn">{c.unmatched_subject} unmatched subject</Badge>}
        {c.out_of_scope_cycle > 0 && <Badge tone="neutral">{c.out_of_scope_cycle} out of scope</Badge>}
        {c.staff_excluded > 0 && <Badge tone="neutral">{c.staff_excluded} staff</Badge>}
        {c.error > 0 && <Badge tone="bad">{c.error} error</Badge>}
      </div>

      {(c.multiple_incidents > 0 || c.q_list_missing > 0) && (
        <div className="hf-sub" style={{ fontSize: 11, padding: "7px 14px", borderBottom: `1px solid ${H.line}`, display: "flex", gap: 14, flexWrap: "wrap" }}>
          {c.multiple_incidents > 0 && <span><Mark kind="warn" size={11} /> {c.multiple_incidents} row(s) flagged <span className="hf-mono">multiple_incidents</span> (composition deferred to the adjustment step).</span>}
          {c.q_list_missing > 0 && <span><Mark kind="warn" size={11} /> {c.q_list_missing} row(s) flagged <span className="hf-mono">q_list_missing</span> (count &gt; 0 but no id list).</span>}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead><tr>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Reference</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Student</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Email (join key)</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Subject</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Sitting</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Status</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Reason</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, 60).map((r, i) => (
              <tr key={i}>
                <td className="hf-td hf-mono" style={{ padding: "7px 12px", color: H.ink2 }}>{r.reference || "—"}</td>
                <td className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{r.studentName || "—"}</td>
                <td className="hf-td hf-mono" style={{ padding: "7px 12px", color: H.ink2 }}>{r.studentEmail || "—"}</td>
                <td className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{r.subjectRaw || "—"}{r.subjectKey ? ` (${r.subjectKey})` : ""}</td>
                <td className="hf-td hf-mono" style={{ padding: "7px 12px", color: r.matchedQmResultId ? H.ink2 : H.ink3 }}>{r.matchedQmResultId ?? "—"}</td>
                <td className="hf-td" style={{ padding: "7px 12px" }}>
                  <Badge tone={toneFor(r.status)}>{STATUS_LABEL[r.status]}</Badge>
                  {r.flags.includes("multiple_incidents") && <span className="hf-mono" style={{ fontSize: 9.5, color: H.warn, marginLeft: 5 }}>×N</span>}
                </td>
                <td className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{r.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 60 && <div className="hf-sub" style={{ fontSize: 11, padding: "6px 14px" }}>…and {rows.length - 60} more.</div>}

      <div style={{ display: "flex", gap: 9, alignItems: "center", padding: "10px 14px", borderTop: `1px solid ${H.line}`, flexWrap: "wrap" }}>
        <Button variant="pri" onClick={onCommit} disabled={stageable === 0}>
          Commit {stageable} staged record{stageable === 1 ? "" : "s"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <span className="hf-sub" style={{ fontSize: 11.5 }}>
          Staging only — no marks are adjusted.{c.error > 0 ? ` ${c.error} keyless row(s) are surfaced but not staged.` : ""}
        </span>
      </div>
    </div>
  );
}
