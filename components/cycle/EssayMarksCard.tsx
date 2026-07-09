"use client";

/**
 * Essay-marks entry — the single upload/enter surface for offline-marked essays
 * (English & Arabic only). Lives on the Upload screen (step 1) as the optional
 * "Essay marks" card, alongside the QM exports. Keyed on P-A's internal unique
 * participant id via the provider — marks fold into the scored subject totals at
 * HALF weight through the existing post-engine essay-marks layer (never as
 * responses), so keying and weighting are unchanged here.
 *
 * Flow: download a pre-populated template → fill it → upload → REVIEW the
 * row-by-row valid/rejected/flagged report → apply. Nothing is written until the
 * operator confirms; only valid rows are handed to the existing
 * `uploadEssayMarks` (which upserts idempotently, so a re-upload overwrites and
 * never duplicates).
 */
import { useRef, useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { parseEssayMarks } from "@/lib/data/parse-essays";
import { validateEssayRows, type EssayValidationReport } from "@/lib/data/validate-essays";
import type { EssayUploadRow } from "@/lib/data/provider";
import type { EssayMarksModel, EssayUploadContext } from "@/lib/data/types";

type Staged = { fileName: string; rows: EssayUploadRow[]; report: EssayValidationReport };

export function EssayMarksCard({ cycleId, model }: { cycleId: string; model: EssayMarksModel | null }) {
  const provider = useProvider();
  const context = useProviderData((p) => p.getEssayContext(cycleId), [cycleId]) as EssayUploadContext | null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);

  // Roster participants still without a mark, per essay subject — the "pending"
  // surface so the team knows essay marks are outstanding.
  const pendingBySubject = (context?.subjects ?? []).map((s) => {
    const withMark = new Set(
      (model?.students ?? []).filter((st) => st.marks[s.assessmentId] != null).map((st) => st.participantId),
    );
    const pending = s.participants.filter((p) => !p.excluded && !withMark.has(p.participantId)).length;
    return { name: s.name, pending, total: s.participants.filter((p) => !p.excluded).length };
  });
  const totalPending = pendingBySubject.reduce((n, s) => n + s.pending, 0);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await parseEssayMarks(file);
      if (rows.length === 0) {
        setError("No essay rows found. Expected AFL / ESL sheets with ParticipantID and TotalScore columns.");
      } else if (!context) {
        setError("No cycle roster to validate against — ingest the raw export first.");
      } else {
        // Validate, then STAGE for review — write nothing until confirmed.
        setStaged({ fileName: file.name, rows, report: validateEssayRows(rows, context) });
      }
    } catch {
      setError("Couldn’t read that file. Use a .xlsx with per-subject sheets (AFL, ESL).");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const applyStaged = () => {
    if (!staged) return;
    provider.uploadEssayMarks(cycleId, staged.fileName, staged.report.valid);
    setStaged(null);
  };

  const downloadTemplate = async () => {
    if (!context) return;
    const [{ buildEssayTemplateWorkbook, ESSAY_TEMPLATE_FILENAME }, { downloadWorkbook }] = await Promise.all([
      import("@/lib/data/essay-template"),
      import("@/lib/ui/export"),
    ]);
    await downloadWorkbook(ESSAY_TEMPLATE_FILENAME, buildEssayTemplateWorkbook(context));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <div className="hf-sub" style={{ fontSize: 12, maxWidth: 640 }}>
        Offline-marked essays for <b style={{ color: H.ink }}>English &amp; Arabic only</b> — per-subject sheets{" "}
        <span className="hf-mono" style={{ fontSize: 11 }}>AFL · ESL</span>, keyed by ParticipantID, marked out of 20 (the{" "}
        <span className="hf-mono" style={{ fontSize: 11 }}>TotalScore</span> column; the rubric D1–D5 columns are ignored). Adds to the
        subject total at <b style={{ color: H.ink }}>half weight</b>.
      </div>

      {staged ? (
        <ReviewPanel staged={staged} onApply={applyStaged} onCancel={() => setStaged(null)} />
      ) : model?.uploaded ? (
        <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", background: model.sample ? H.pinkSoft2 : H.tint, borderBottom: `1px solid ${H.line2}`, flexWrap: "wrap" }}>
            <Mark kind="pass" size={16} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{model.fileName}</span>
            {model.sample && <Badge tone="accent">SAMPLE</Badge>}
            <span style={{ flex: 1 }} />
            <span className="hf-sub" style={{ fontSize: 11.5 }}>{model.matchedCount} students matched · {model.subjects.map((s) => `${s.code} ${s.count}`).join(" · ")}</span>
            <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={13} />Re-upload</Button>
            <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.clearEssayMarks(cycleId)}><Icon name="trash" size={13} />Remove</Button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead><tr>{model.preview.headers.map((h) => <th key={h} className="hf-th" style={{ padding: "7px 12px" }}>{h}</th>)}</tr></thead>
            <tbody>{model.preview.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{c}</td>)}</tr>)}</tbody>
          </table>
          {model.unmatchedIds.length > 0 && (
            <div className="hf-sub" style={{ fontSize: 11, padding: "8px 14px", borderTop: `1px solid ${H.line}` }}>
              {model.unmatchedIds.length} ParticipantID(s) didn’t match the roster (e.g. <span className="hf-mono">{model.unmatchedIds.slice(0, 3).join(", ")}</span>) — those marks were skipped.
            </div>
          )}
          {totalPending > 0 && <PendingNote total={totalPending} bySubject={pendingBySubject} />}
        </div>
      ) : (
        <>
          {totalPending > 0 && <PendingNote total={totalPending} bySubject={pendingBySubject} />}
          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="ghost" onClick={downloadTemplate} disabled={!context || (context.subjects.length === 0)}><Icon name="download" size={13} />Download template</Button>
            <Button onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={13} />{busy ? "Reading…" : "Add essay-marks file"}</Button>
            <Button variant="ghost" onClick={() => provider.loadSampleEssayMarks(cycleId)} disabled={busy}>Load sample (labelled)</Button>
            {error && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>{error}</span>}
          </div>
        </>
      )}
      {staged && error && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>{error}</span>}
    </div>
  );
}

/** "N essay items pending marks" surface — outstanding offline marks per subject. */
function PendingNote({ total, bySubject }: { total: number; bySubject: { name: string; pending: number; total: number }[] }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 10, background: H.warnSoft, alignItems: "flex-start" }}>
      <Mark kind="warn" size={15} />
      <span style={{ fontSize: 12, color: H.ink, flex: 1 }}>
        <b>{total} essay item(s) pending marks.</b> These subjects are marked offline and stay incomplete until their marks are entered:{" "}
        {bySubject.filter((s) => s.pending > 0).map((s) => `${s.name} (${s.pending}/${s.total})`).join(" · ")}.
      </span>
    </div>
  );
}

/** Review-before-apply: the row-by-row validation report; nothing is written yet. */
function ReviewPanel({ staged, onApply, onCancel }: { staged: Staged; onApply: () => void; onCancel: () => void }) {
  const { report, fileName } = staged;
  const problems = report.results.filter((r) => r.status !== "valid");
  return (
    <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", background: H.tint, borderBottom: `1px solid ${H.line2}`, flexWrap: "wrap" }}>
        <Icon name="eye" size={15} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Review {fileName}</span>
        <Badge tone="good">{report.validCount} valid</Badge>
        {report.rejectedCount > 0 && <Badge tone="bad">{report.rejectedCount} rejected</Badge>}
        {report.flaggedCount > 0 && <Badge tone="warn">{report.flaggedCount} flagged</Badge>}
        <span style={{ flex: 1 }} />
        <span className="hf-sub" style={{ fontSize: 11 }}>Nothing is written until you apply.</span>
      </div>

      {problems.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead><tr>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Row</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Subject</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Status</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Reason</th>
          </tr></thead>
          <tbody>
            {problems.slice(0, 20).map((r, i) => (
              <tr key={i}>
                <td className="hf-td hf-mono" style={{ padding: "7px 12px", color: H.ink2 }}>{r.row.participantId}</td>
                <td className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{r.subjectName ?? r.row.subjectCode}</td>
                <td className="hf-td" style={{ padding: "7px 12px" }}>
                  <Badge tone={r.status === "rejected" ? "bad" : "warn"}>{r.status}</Badge>
                </td>
                <td className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {problems.length > 20 && (
        <div className="hf-sub" style={{ fontSize: 11, padding: "6px 14px" }}>…and {problems.length - 20} more.</div>
      )}

      <div style={{ display: "flex", gap: 9, alignItems: "center", padding: "10px 14px", borderTop: `1px solid ${H.line}`, flexWrap: "wrap" }}>
        <Button variant="pri" onClick={onApply} disabled={report.validCount === 0}>
          Apply {report.validCount} mark{report.validCount === 1 ? "" : "s"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        {report.validCount === 0 && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>No valid rows to apply — fix the file and re-upload.</span>}
        {report.flaggedCount > 0 && (
          <span className="hf-sub" style={{ fontSize: 11.5 }}>Flagged rows (excluded sittings) will not be applied.</span>
        )}
      </div>
    </div>
  );
}
