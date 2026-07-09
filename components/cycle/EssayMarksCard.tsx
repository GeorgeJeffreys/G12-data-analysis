"use client";

/**
 * Essay-marks entry — the single upload/enter surface for offline-marked essays
 * (English & Arabic only). Lives on the Upload screen (step 1) as the optional
 * "Essay marks" card, alongside the QM exports. Keyed on the real Student ID via
 * the provider — marks fold into the scored subject totals at HALF weight through
 * the existing post-engine essay-marks layer (never as responses).
 *
 * Primary flow: upload the marking team's REAL double-marking masterfile — a CSV,
 * ONE FILE PER LANGUAGE (English / Arabic). It is reconciled per the SIGNED-OFF
 * policy (`lib/data/parse-essay-masterfile.ts`): approved mark per essay =
 * Moderated-else-Final, halve each /20 to /10, sum, `round_half_up` the sum → the
 * subject essay /20. The subject/language is inferred from the FILE NAME. Each
 * language can be uploaded separately; the provider merges per subject.
 *
 * Legacy flow (kept): a pre-populated `.xlsx` template with one row per essay,
 * consumed by `parseEssayMarks` + `validateEssayRows`.
 *
 * Both flows: upload → REVIEW the row-by-row valid/rejected/flagged report → apply.
 * Nothing is written until the operator confirms; only valid rows reach the
 * existing `uploadEssayMarks` (which upserts idempotently — a re-upload of a
 * language replaces that subject's marks and never duplicates).
 */
import { useRef, useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { parseEssayMarks } from "@/lib/data/parse-essays";
import { validateEssayRows } from "@/lib/data/validate-essays";
import { parseEssayMasterfile } from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import type { EssayUploadRow } from "@/lib/data/provider";
import type { EssayMarksModel, EssayUploadContext } from "@/lib/data/types";

/** A unified review row shown in the pre-apply panel (from either flow). */
type ReviewRow = {
  id: string;
  subject: string | null;
  status: "valid" | "rejected" | "flagged";
  reason: string | null;
  value: number | null;
};

/** Everything staged for review; nothing is written until `valid` is applied. */
type Staged = {
  fileName: string;
  summary: string | null;
  valid: EssayUploadRow[];
  validCount: number;
  rejectedCount: number;
  flaggedCount: number;
  rows: ReviewRow[];
};

export function EssayMarksCard({ cycleId, model }: { cycleId: string; model: EssayMarksModel | null }) {
  const provider = useProvider();
  const context = useProviderData((p) => p.getEssayContext(cycleId), [cycleId]) as EssayUploadContext | null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);

  // Roster participants still without a mark, per essay subject — the "pending"
  // surface so the team knows essay marks are outstanding. Clears per subject as
  // soon as that language's marks are applied.
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
      if (!context) {
        setError("No cycle roster to validate against — ingest the raw export first.");
        return;
      }
      const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
      if (isCsv) {
        // Real masterfile: reconcile per the signed-off policy, then validate.
        const result = await parseEssayMasterfile(file); // subject inferred from filename
        const report = validateEssayMasterfile(result, context);
        if (result.reconciled.length === 0 && result.anomalies.length === 0) {
          setError("No essays found in that file. Expected Student ID / Essay ID / Moderated-or-Final columns.");
          return;
        }
        const roundNote = "reconciled: round_half_up(essay₁/2 + essay₂/2)";
        setStaged({
          fileName: file.name,
          summary: `${report.subjectName ?? report.subjectCode} · ${roundNote}`,
          valid: report.valid,
          validCount: report.validCount,
          rejectedCount: report.rejectedCount,
          flaggedCount: report.flaggedCount,
          rows: report.rows.map((r) => ({
            id: r.studentId,
            subject: report.subjectName,
            status: r.status,
            reason: r.reason,
            value: r.subjectEssay,
          })),
        });
      } else {
        // Legacy per-essay template (.xlsx, one row per essay).
        const rows = await parseEssayMarks(file);
        if (rows.length === 0) {
          setError("No essay rows found. Use a .csv masterfile, or an .xlsx with AFL / ESL sheets.");
          return;
        }
        const report = validateEssayRows(rows, context);
        setStaged({
          fileName: file.name,
          summary: report.subjectsSeen.length ? report.subjectsSeen.join(" · ") : null,
          valid: report.valid,
          validCount: report.validCount,
          rejectedCount: report.rejectedCount,
          flaggedCount: report.flaggedCount,
          rows: report.results.map((r) => ({
            id: r.row.participantId,
            subject: r.subjectName ?? r.row.subjectCode,
            status: r.status,
            reason: r.reason,
            value: r.status === "valid" ? r.row.totalScore : null,
          })),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t read that file. Use the language CSV masterfile (English / Arabic).");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const applyStaged = () => {
    if (!staged) return;
    provider.uploadEssayMarks(cycleId, staged.fileName, staged.valid);
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
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xls"
        style={{ display: "none" }}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <div className="hf-sub" style={{ fontSize: 12, maxWidth: 680 }}>
        Offline-marked essays for <b style={{ color: H.ink }}>English &amp; Arabic only</b>. Upload the marking team’s{" "}
        <b style={{ color: H.ink }}>masterfile CSV — one file per language</b> (the language is read from the file name).
        The double-marking is reconciled per policy: approved mark per essay = <span className="hf-mono" style={{ fontSize: 11 }}>Moderated</span>-else-
        <span className="hf-mono" style={{ fontSize: 11 }}>Final</span>, then{" "}
        <span className="hf-mono" style={{ fontSize: 11 }}>round_half_up(essay₁/2 + essay₂/2)</span>. Adds to the subject total at{" "}
        <b style={{ color: H.ink }}>half weight</b>.
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
            <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={13} />Add / re-upload language</Button>
            <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.clearEssayMarks(cycleId)}><Icon name="trash" size={13} />Remove</Button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead><tr>{model.preview.headers.map((h) => <th key={h} className="hf-th" style={{ padding: "7px 12px" }}>{h}</th>)}</tr></thead>
            <tbody>{model.preview.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{c}</td>)}</tr>)}</tbody>
          </table>
          {model.unmatchedIds.length > 0 && (
            <div className="hf-sub" style={{ fontSize: 11, padding: "8px 14px", borderTop: `1px solid ${H.line}` }}>
              {model.unmatchedIds.length} Student ID(s) didn’t match the roster (e.g. <span className="hf-mono">{model.unmatchedIds.slice(0, 3).join(", ")}</span>) — those marks were skipped.
            </div>
          )}
          {totalPending > 0 && <PendingNote total={totalPending} bySubject={pendingBySubject} />}
        </div>
      ) : (
        <>
          {totalPending > 0 && <PendingNote total={totalPending} bySubject={pendingBySubject} />}
          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <Button onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={13} />{busy ? "Reading…" : "Add masterfile (CSV)"}</Button>
            <Button variant="ghost" onClick={downloadTemplate} disabled={!context || (context.subjects.length === 0)}><Icon name="download" size={13} />Download template (.xlsx)</Button>
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
  const problems = staged.rows.filter((r) => r.status !== "valid");
  return (
    <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", background: H.tint, borderBottom: `1px solid ${H.line2}`, flexWrap: "wrap" }}>
        <Icon name="eye" size={15} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Review {staged.fileName}</span>
        {staged.summary && <span className="hf-sub hf-mono" style={{ fontSize: 11 }}>{staged.summary}</span>}
        <Badge tone="good">{staged.validCount} valid</Badge>
        {staged.rejectedCount > 0 && <Badge tone="bad">{staged.rejectedCount} rejected</Badge>}
        {staged.flaggedCount > 0 && <Badge tone="warn">{staged.flaggedCount} flagged</Badge>}
        <span style={{ flex: 1 }} />
        <span className="hf-sub" style={{ fontSize: 11 }}>Nothing is written until you apply.</span>
      </div>

      {problems.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead><tr>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Student ID</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Subject</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Status</th>
            <th className="hf-th" style={{ padding: "7px 12px" }}>Reason</th>
          </tr></thead>
          <tbody>
            {problems.slice(0, 20).map((r, i) => (
              <tr key={i}>
                <td className="hf-td hf-mono" style={{ padding: "7px 12px", color: H.ink2 }}>{r.id}</td>
                <td className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{r.subject}</td>
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
        <Button variant="pri" onClick={onApply} disabled={staged.validCount === 0}>
          Apply {staged.validCount} mark{staged.validCount === 1 ? "" : "s"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        {staged.validCount === 0 && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>No valid rows to apply — fix the file and re-upload.</span>}
        {staged.flaggedCount > 0 && (
          <span className="hf-sub" style={{ fontSize: 11.5 }}>Flagged rows (excluded sittings) will not be applied.</span>
        )}
      </div>
    </div>
  );
}
