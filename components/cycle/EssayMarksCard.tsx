"use client";

/**
 * Essay-marks entry — the single upload surface for offline-marked essays
 * (English & Arabic only). Lives on the Upload screen (step 1) as the optional
 * "Essay marks" card. Marks fold into the scored subject totals at FULL weight
 * through the existing post-engine essay-marks layer (never as responses).
 *
 * The app owns ONE fixed template on both ends: "Download template"
 * (`lib/data/essay-template.ts`) emits an `.xlsx` with two sheets
 * (`English Essay master`, `Arabic Essay master`), pre-filled with each student's
 * QM email so the join key is never hand-typed. The team fills `Final essay
 * mark (/20)`; the parser (`parse-essay-masterfile.ts`) reads ONLY the tab name
 * (→ subject), the QM email, and the Final mark, joins on the email, and rejects
 * blank / off-roster / no-Final / multiple-Final rows with a reason.
 *
 * Flow: upload → REVIEW the row-by-row valid/rejected report → apply. Nothing is
 * written until the operator confirms; only valid rows reach the existing
 * `uploadEssayMarks` (which upserts idempotently per subject — a re-upload of a
 * language replaces that subject's marks and never duplicates).
 */
import { useRef, useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { parseEssayMasterfile, ESSAY_MARK_ROUNDING } from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import type { EssayUploadRow } from "@/lib/data/provider";
import type { EssayMarksModel, EssayUploadContext } from "@/lib/data/types";

/** A unified review row shown in the pre-apply panel (from either flow). */
type ReviewRow = {
  id: string;
  subject: string | null;
  /** The matched participant (email + name) a human signs off on, when joined. */
  matched: string | null;
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
      {
        // The app's fixed template (two sheets). Read tab→subject, QM email, and
        // Final essay mark; join on the QM email.
        const result = await parseEssayMasterfile(file);
        const report = validateEssayMasterfile(result, context);
        if (result.students.length === 0) {
          setError("No essays found. Upload the generated template — sheets “English/Arabic Essay master” with a QM email column and a Final essay mark column.");
          return;
        }
        const subjects = report.subjectsSeen.length ? report.subjectsSeen.join(" & ") : result.subjectsSeen.join(" & ");
        setStaged({
          fileName: file.name,
          summary: `${subjects} · joined on QM email · Final essay mark, rounding: ${ESSAY_MARK_ROUNDING}`,
          valid: report.valid,
          validCount: report.validCount,
          rejectedCount: report.rejectedCount,
          flaggedCount: report.flaggedCount,
          rows: report.rows.map((r) => ({
            id: r.matchedName ?? r.email,
            subject: r.subjectName ?? r.subjectCode,
            matched: r.matchedEmail ? `${r.matchedEmail}${r.matchedName ? ` — ${r.matchedName}` : ""}` : null,
            status: r.status,
            reason: r.reason,
            value: r.subjectEssay ?? r.finalRaw,
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
        Offline-marked essays for <b style={{ color: H.ink }}>English &amp; Arabic only</b>.{" "}
        <b style={{ color: H.ink }}>Download the template</b> (pre-filled with each student’s QM email so it’s never hand-typed),
        have the team fill <span className="hf-mono" style={{ fontSize: 11 }}>Final essay mark (/20)</span>, then upload it back.
        The app reads only the tab name (→ subject), <span className="hf-mono" style={{ fontSize: 11 }}>QM email</span>, and the
        Final mark; it joins on the email and adds the <b style={{ color: H.ink }}>/20 at full weight</b>.
      </div>

      {staged ? (
        <ReviewPanel staged={staged} onApply={applyStaged} onCancel={() => setStaged(null)} />
      ) : model?.uploaded ? (
        <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", background: H.tint, borderBottom: `1px solid ${H.line2}`, flexWrap: "wrap" }}>
            <Mark kind="pass" size={16} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{model.fileName}</span>
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
  // Show valid rows FIRST (matched participant + computed /20 to sign off on),
  // then the problems, so a human confirms every join before applying.
  const ordered = [
    ...staged.rows.filter((r) => r.status === "valid"),
    ...staged.rows.filter((r) => r.status !== "valid"),
  ];
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

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
        <thead><tr>
          <th className="hf-th" style={{ padding: "7px 12px" }}>Student ID</th>
          <th className="hf-th" style={{ padding: "7px 12px" }}>Matched participant (QM email)</th>
          <th className="hf-th" style={{ padding: "7px 12px" }}>Essay /20</th>
          <th className="hf-th" style={{ padding: "7px 12px" }}>Status</th>
          <th className="hf-th" style={{ padding: "7px 12px" }}>Reason</th>
        </tr></thead>
        <tbody>
          {ordered.slice(0, 40).map((r, i) => (
            <tr key={i}>
              <td className="hf-td hf-mono" style={{ padding: "7px 12px", color: H.ink2 }}>{r.id}</td>
              <td className="hf-td" style={{ padding: "7px 12px", color: r.matched ? H.ink2 : H.bad }}>{r.matched ?? "— no match —"}</td>
              <td className="hf-td hf-mono" style={{ padding: "7px 12px", color: H.ink2 }}>{r.value ?? "—"}</td>
              <td className="hf-td" style={{ padding: "7px 12px" }}>
                <Badge tone={r.status === "valid" ? "good" : r.status === "rejected" ? "bad" : "warn"}>{r.status}</Badge>
              </td>
              <td className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ordered.length > 40 && (
        <div className="hf-sub" style={{ fontSize: 11, padding: "6px 14px" }}>…and {ordered.length - 40} more.</div>
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
