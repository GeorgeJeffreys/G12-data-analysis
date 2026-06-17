"use client";

/**
 * Screen — Data import (Ingest + Validate merged into one step). The full-width
 * main window from the new Claude Design: three equal, expandable input cards —
 * 01 Raw exam export (Required), 02 Essay marks (Optional), 03 Incident log
 * (Optional). Open a card to upload its file and read its validation/match report
 * inline; collapse it so all three sit together. Per-card status lives on each
 * header. No right-hand sidebar (the mark-composition explainer lives in Grades).
 * Only the raw export is required — and its blocking issues (duplicates) must be
 * resolved — to continue.
 */
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { CycleShell } from "@/components/shell/CycleShell";
import { Button, Badge } from "@/components/ui/primitives";
import { UploadButton } from "@/components/import/UploadButton";
import { UploadStatusLine, ConfirmStep, type UploadStage } from "@/components/import/UploadFlow";
import { Icon, Mark, type MarkKind } from "@/components/ui/icons";
import { parseEssayMarks } from "@/lib/data/parse-essays";
import { parseIncidentLog } from "@/lib/data/parse-incidents";
import { parseExport, ingestAndClean } from "@/lib/ingest";
import type { AdjustmentsModel, CombinedSplitModel, DuplicateStrategy, EssayMarksModel, IngestModel } from "@/lib/data/types";

type Tone = "pass" | "warn" | "fail" | "neutral";

export default function ImportPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const model = useProviderData((p) => p.getIngest(cycleId), [cycleId]);
  const essay = useProviderData((p) => p.getEssayMarks(cycleId), [cycleId]) as EssayMarksModel | null;
  const adj = useProviderData((p) => p.getAdjustments(cycleId), [cycleId]) as AdjustmentsModel | null;
  const split = useProviderData((p) => p.getCombinedSplit(cycleId), [cycleId]);
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Cycle";

  const [open, setOpen] = useState<Record<number, boolean>>({ 1: true, 2: false, 3: false });
  const [resolved, setResolved] = useState<DuplicateStrategy | null>(null);

  if (!model) {
    return (
      <Shell crumb={[{ label: "Cycles", href: "/" }, { label: "Data import" }]}>
        <div style={{ padding: 32 }} className="hf-sub">No import data for this cycle.</div>
      </Shell>
    );
  }

  const counts = model.report.checks.reduce(
    (acc, c) => ((acc[c.status] = (acc[c.status] ?? 0) + 1), acc),
    {} as Record<string, number>,
  );
  const toggle = (n: number) => setOpen((o) => ({ ...o, [n]: !o[n] }));
  const resolve = (s: DuplicateStrategy) => {
    provider.resolveDuplicates(cycleId, s);
    setResolved(s);
  };

  // An empty/draft cycle hasn't ingested a raw export yet — the normal starting
  // state for this screen, not an error. Show a neutral "Not added" until upload.
  const exportTone: Tone = !model.uploaded ? "neutral" : counts.fail ? "fail" : counts.warn ? "warn" : "pass";
  const exportStatus = !model.uploaded
    ? "Not added"
    : counts.fail
      ? `${counts.fail} must fix`
      : `${counts.pass ?? 0} passed${counts.warn ? ` · ${counts.warn} warning${counts.warn > 1 ? "s" : ""}` : ""}`;

  const essayUp = !!essay?.uploaded;
  const essayStatus = essayUp ? `${essay!.matchedCount} matched · ${essay!.unmatchedIds.length} unmatched` : "Not added";

  const adjUp = !!adj?.uploaded;
  const incidentStatus = adjUp ? `${adj!.counts.incidents} incidents · ${adj!.counts.decided} triaged` : "Not added";

  // Why the second-step Confirm is unavailable (shown on the disabled ConfirmStep).
  const confirmHint = !model.uploaded
    ? "Upload and ingest a file first."
    : "Resolve the validation issues above to continue.";

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Upload exam data"
      stageIndex={0}
      primary={
        <Link href={model.canContinue ? `/cycles/${cycleId}/raw-data` : "#"} tabIndex={model.canContinue ? undefined : -1}>
          <Button variant="pri" disabled={!model.canContinue}>
            {split ? `Confirm ${split.subjects.length} subjects & continue` : "Continue to raw data"}
            <Icon name="arrow" color="#fff" />
          </Button>
        </Link>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 14, flex: 1, maxWidth: 1040 }}>
        <div>
          <div className="hf-h1">Upload exam data</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            Drop in <strong>one combined file</strong> with every subject in it — we detect each subject and split it for
            you. Only the raw export is required (resolve its blocking issues to continue); essay marks and the incident
            log are optional and never block progress.
          </div>
        </div>

        {split && <CombinedSplitPanel split={split} />}

        <ImportCard n="01" title="Raw exam export" required tone={exportTone} status={exportStatus} open={!!open[1]} onToggle={() => toggle(1)}>
          <ExportBody cycleId={cycleId} model={model} counts={counts} resolved={resolved} onResolve={resolve} />
        </ImportCard>

        <ImportCard n="02" title="Essay marks" tone={essayUp ? "pass" : "neutral"} status={essayStatus} open={!!open[2]} onToggle={() => toggle(2)}>
          <EssayBody cycleId={cycleId} model={essay} />
        </ImportCard>

        <ImportCard n="03" title="Incident log" tone={adjUp ? "pass" : "neutral"} status={incidentStatus} open={!!open[3]} onToggle={() => toggle(3)}>
          <IncidentBody cycleId={cycleId} model={adj} />
        </ImportCard>

        <ConfirmStep
          subjectCount={split?.subjects.length ?? 0}
          canContinue={model.canContinue}
          hint={confirmHint}
          href={`/cycles/${cycleId}/raw-data`}
        />
      </div>
    </CycleShell>
  );
}

// ── combined-upload detection: subjects split out of the single export ───────
function CombinedSplitPanel({ split }: { split: CombinedSplitModel }) {
  const warned = split.subjects.filter((s) => s.status === "warn");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="hf-lbl">Detected {split.subjects.length} subjects in this file</span>
        <span className="hf-sub" style={{ fontSize: 11.5 }}>{split.totalItems} items total · {split.totalParticipants} participants · split automatically</span>
      </div>
      <div className="hf-card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th className="hf-th">Detected subject</th>
              <th className="hf-th" style={{ textAlign: "right" }}>Items</th>
              <th className="hf-th" style={{ textAlign: "right" }}>Participants</th>
              <th className="hf-th" style={{ textAlign: "right" }}>Elements</th>
              <th className="hf-th" style={{ textAlign: "right" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {split.subjects.map((s) => (
              <tr key={s.id} className="hf-hover">
                <td className="hf-td" style={{ fontWeight: 600 }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {s.name}
                    {s.hasEssay && <Badge tone="accent">has essay</Badge>}
                    {s.rtl && <Badge>RTL</Badge>}
                  </span>
                </td>
                <td className="hf-td hf-mono" style={{ textAlign: "right" }}>{s.items}</td>
                <td className="hf-td hf-mono" style={{ textAlign: "right", color: s.status === "warn" ? H.warn : H.ink }}>{s.participants}</td>
                <td className="hf-td hf-mono" style={{ textAlign: "right", color: H.ink2 }} title={s.elements.join(" · ")}>{s.elements.length}</td>
                <td className="hf-td" style={{ textAlign: "right" }}>
                  {s.status === "warn" ? (
                    <Badge tone="warn"><Mark kind="warn" size={11} />{s.note}</Badge>
                  ) : (
                    <Badge tone="good"><Mark kind="pass" size={11} />Split OK</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {warned.length > 0 && (
        <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 10, background: H.warnSoft, alignItems: "center" }}>
          <Mark kind="warn" size={15} />
          <span style={{ fontSize: 12, color: H.ink, flex: 1 }}>
            {warned.length} subject{warned.length === 1 ? "" : "s"} {warned.length === 1 ? "has" : "have"} fewer participants than the largest — fine if some students didn’t sit them. You can confirm in cleaning.
          </span>
        </div>
      )}
    </div>
  );
}

// ── card chrome ─────────────────────────────────────────────────────────────
const toneColor = (t: Tone) => (t === "pass" ? H.good : t === "warn" ? H.warn : t === "fail" ? H.bad : H.ink3);
const toneBg = (t: Tone) => (t === "pass" ? H.goodSoft : t === "warn" ? H.warnSoft : t === "fail" ? H.badSoft : H.tint);

function ImportCard({
  n,
  title,
  required,
  tone,
  status,
  open,
  onToggle,
  children,
}: {
  n: string;
  title: string;
  required?: boolean;
  tone: Tone;
  status: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="hf-card" style={{ overflow: "hidden" }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 13, width: "100%", border: "none", background: open ? H.tint : H.paper, cursor: "pointer", padding: "15px 18px", textAlign: "left" }}
      >
        <span className="hf-mono" style={{ width: 30, height: 30, borderRadius: 8, background: H.tint2, color: H.ink2, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flex: "0 0 auto" }}>{n}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="hf-h2" style={{ fontSize: 14 }}>{title}</span>
          <span style={{ fontSize: 9, color: H.ink2, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 6px", letterSpacing: 0.4 }}>{required ? "REQUIRED" : "OPTIONAL"}</span>
        </span>
        <div style={{ flex: 1 }} />
        <span className="hf-mono" style={{ fontSize: 11.5, fontWeight: 600, color: toneColor(tone), background: toneBg(tone), padding: "3px 10px", borderRadius: 999 }}>{status}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", flex: "0 0 auto" }} aria-hidden="true">
          <path d="M4 2.5L8 6l-4 3.5" fill="none" stroke={H.ink3} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div style={{ borderTop: `1px solid ${H.line}`, padding: "16px 18px" }}>{children}</div>}
    </div>
  );
}

// ── 01 · raw exam export body ───────────────────────────────────────────────
function ExportBody({
  cycleId,
  model,
  counts,
  resolved,
  onResolve,
}: {
  cycleId: string;
  model: IngestModel;
  counts: Record<string, number>;
  resolved: DuplicateStrategy | null;
  onResolve: (s: DuplicateStrategy) => void;
}) {
  // Empty cycle: no raw export ingested yet. Render the upload prompt rather than
  // a file-meta + validation report for data that doesn't exist (which used to
  // crash reading `report.stats.mcqRows`). An empty cycle is the normal start.
  if (!model.uploaded) return <ExportEmpty cycleId={cycleId} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* file meta */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px", minWidth: 220, height: 52, border: `1.5px dashed ${H.line2}`, borderRadius: 10, background: "repeating-linear-gradient(135deg, transparent 0 9px, var(--tint2) 9px 10px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="hf-mono" style={{ fontSize: 11, color: H.ink2 }}>{model.fileName} · {model.fileSizeMB} MB</span>
        </div>
        <span className="hf-mono" style={{ fontSize: 11, color: H.ink2 }}>uploaded {model.uploadedAgo}</span>
        <RawExportUploader cycleId={cycleId} label="Replace file" variant="ghost" />
      </div>

      {/* validation report */}
      <div>
        <div style={{ display: "flex", gap: 10, marginBottom: 9, alignItems: "center" }}>
          <span className="hf-lbl">Validation report</span>
          <span className="hf-sub" style={{ fontSize: 11.5 }}>{counts.pass ?? 0} passed · {counts.warn ?? 0} warnings · {counts.fail ?? 0} must fix</span>
        </div>
        <div className="hf-card" style={{ overflow: "hidden" }}>
          {model.report.checks.map((c, i) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", padding: "11px 14px", gap: 12, borderBottom: i < model.report.checks.length - 1 ? `1px solid ${H.line}` : "none", background: c.status === "fail" ? H.badSoft : "transparent" }}>
              <Mark kind={c.status as MarkKind} size={16} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: c.status === "fail" ? 600 : 500 }}>{c.label}</div>
                <div className="hf-sub" style={{ fontSize: 11.5 }}>{c.detail}</div>
              </div>
              {c.count != null && <span className="hf-mono" style={{ fontSize: 11.5, color: c.status === "fail" ? H.bad : H.ink2 }}>{c.count}</span>}
              {c.status !== "pass" && <Button variant="ghost" style={{ fontSize: 11.5 }}>Review</Button>}
            </div>
          ))}
        </div>
      </div>

      {/* duplicate resolution (blocks continue) */}
      {model.duplicates > 0 && (
        <div className="hf-card" style={{ padding: "14px 16px", background: H.badSoft, borderColor: H.bad, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <Mark kind="fail" size={17} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: H.bad, fontSize: 13 }}>{model.duplicates} students submitted twice — resolve to continue.</div>
            <div className="hf-sub" style={{ marginTop: 5 }}>Keep the latest submission, keep the first, or exclude these students. You can also re-upload a corrected export.</div>
            {resolved ? (
              <div className="hf-sub" style={{ marginTop: 10, color: H.ink }}>
                Recorded choice: <strong>{labelFor(resolved)}</strong> <span className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>(stub — no DB write)</span>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 9, marginTop: 12, flexWrap: "wrap" }}>
                <Button onClick={() => onResolve("keep_latest")}>Keep latest</Button>
                <Button onClick={() => onResolve("keep_first")}>Keep first</Button>
                <Button variant="ghost" onClick={() => onResolve("exclude")}>Exclude students</Button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="hf-sub" style={{ fontSize: 11.5 }}>
        MCQ-only rows after cleaning: <span className="hf-mono">{(model.report.stats?.mcqRows ?? 0).toLocaleString()}</span>. Surveys and non-MCQ rows removed; Arabic encoding repaired.
      </div>
    </div>
  );
}

/** Empty-state for the raw export card before anything is ingested. The combined
 *  export is the one required input; uploading it parses + splits the subjects,
 *  persists assessments/items/responses, validates, and starts the pipeline. */
function ExportEmpty({ cycleId }: { cycleId: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="hf-sub" style={{ fontSize: 12, maxWidth: 640 }}>
        Upload <b style={{ color: H.ink }}>one combined export</b> containing every subject. We detect each subject,
        split it, persist it, and run validation automatically — no file is required for the optional essay-marks and
        incident-log steps below.
      </div>
      <RawExportUploader cycleId={cycleId} label="Upload exam export" variant="pri" />
    </div>
  );
}

/**
 * Upload + ingest one combined raw export. Parses + cleans + validates in the
 * browser (reusing lib/ingest), then hands the cleaned responses to the provider,
 * which persists the split assessments/items/responses to Supabase (live) or
 * rebuilds them in memory (demo). Used for both the first upload and "Replace file".
 */
function RawExportUploader({ cycleId, label, variant }: { cycleId: string; label: string; variant: "pri" | "ghost" }) {
  const provider = useProvider();
  const fileRef = useRef<HTMLInputElement>(null);
  // Explicit, visible stages: idle → uploading (read/parse) → ingesting
  // (persist + split) → done / failed. The status line names the active one.
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = stage === "uploading" || stage === "ingesting";

  const fail = (msg: string) => {
    setError(msg);
    setStage("failed");
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setStage("uploading");
    try {
      const buffer = await file.arrayBuffer();
      const { rows } = parseExport(buffer);
      if (rows.length === 0) {
        fail("No rows found. Export from Questionmark with the standard column set (the “in” sheet).");
        return;
      }
      const { cleanedResponses, validationReport } = ingestAndClean(rows);
      if (cleanedResponses.length === 0) {
        fail("No MCQ responses after cleaning. Check this is the combined exam export (not a survey file).");
        return;
      }
      // Browser parse/clean done; the server persist + split is the next stage.
      setStage("ingesting");
      const sizeMB = Math.round((file.size / (1024 * 1024)) * 10) / 10;
      await provider.ingestRawExport(cycleId, { name: file.name, sizeMB }, cleanedResponses, validationReport);
      setStage("done");
    } catch (e) {
      fail(e instanceof Error ? e.message : "Couldn’t read that file. Use the Questionmark .xlsx combined export.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // After a failure the control returns to a clearly retryable state: the primary
  // upload button becomes "Try again"; "Replace file" already reads as retryable.
  const buttonLabel = stage === "failed" && variant === "pri" ? "Try again" : label;
  const busyLabel = stage === "ingesting" ? "Ingesting…" : "Uploading…";

  return (
    <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <UploadButton busy={busy} label={buttonLabel} busyLabel={busyLabel} variant={variant} onClick={() => fileRef.current?.click()} />
      <UploadStatusLine stage={stage} error={error} />
    </div>
  );
}

function labelFor(s: DuplicateStrategy): string {
  return s === "keep_latest" ? "Keep latest" : s === "keep_first" ? "Keep first" : "Exclude students";
}

// ── 02 · essay marks body ───────────────────────────────────────────────────
function EssayBody({ cycleId, model }: { cycleId: string; model: EssayMarksModel | null }) {
  const provider = useProvider();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await parseEssayMarks(file);
      if (rows.length === 0) setError("No essay rows found. Expected AFL / ESL sheets with ParticipantID and TotalScore columns.");
      else provider.uploadEssayMarks(cycleId, file.name, rows);
    } catch {
      setError("Couldn’t read that file. Use a .xlsx with per-subject sheets (AFL, ESL).");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <div className="hf-sub" style={{ fontSize: 12, maxWidth: 640 }}>
        Offline-marked essays for <b style={{ color: H.ink }}>English &amp; Arabic only</b> — per-subject sheets{" "}
        <span className="hf-mono" style={{ fontSize: 11 }}>AFL · ESL</span>, keyed by ParticipantID, marked out of 20 (the{" "}
        <span className="hf-mono" style={{ fontSize: 11 }}>TotalScore</span> column; the rubric D1–D5 columns are ignored). Adds to the subject total.
      </div>

      {model?.uploaded ? (
        <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", background: model.sample ? H.pinkSoft2 : H.tint, borderBottom: `1px solid ${H.line2}`, flexWrap: "wrap" }}>
            <Mark kind="pass" size={16} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{model.fileName}</span>
            {model.sample && <Badge tone="accent">SAMPLE</Badge>}
            <span style={{ flex: 1 }} />
            <span className="hf-sub" style={{ fontSize: 11.5 }}>{model.matchedCount} students matched · {model.subjects.map((s) => `${s.code} ${s.count}`).join(" · ")}</span>
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
        </div>
      ) : (
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <Button onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={13} />{busy ? "Reading…" : "Add essay-marks file"}</Button>
          <Button variant="ghost" onClick={() => provider.loadSampleEssayMarks(cycleId)} disabled={busy}>Load sample (labelled)</Button>
          {error && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

// ── 03 · incident log body ──────────────────────────────────────────────────
function IncidentBody({ cycleId, model }: { cycleId: string; model: AdjustmentsModel | null }) {
  const provider = useProvider();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await parseIncidentLog(file);
      if (rows.length === 0) setError("No incidents found. Expected an Incident_Log sheet (header on row 3) and/or a Students Complaints sheet.");
      else provider.uploadIncidentLog(cycleId, file.name, rows);
    } catch {
      setError("Couldn’t read that file. Use a .xlsx with Incident_Log / Students Complaints sheets.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <div className="hf-sub" style={{ fontSize: 12, maxWidth: 640 }}>
        The operational record (<span className="hf-mono" style={{ fontSize: 11 }}>Incident_Log</span>) plus student complaints. Each row is{" "}
        <b style={{ color: H.ink }}>queued for human triage</b> on the Adjustments step — nothing is auto-applied.
      </div>

      {model?.uploaded ? (
        <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", background: model.sample ? H.pinkSoft2 : H.tint, borderBottom: `1px solid ${H.line2}`, flexWrap: "wrap" }}>
            <Mark kind="pass" size={16} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{model.fileName}</span>
            {model.sample && <Badge tone="accent">SAMPLE</Badge>}
            <span style={{ flex: 1 }} />
            <span className="hf-sub" style={{ fontSize: 11.5 }}>{model.counts.incidents} incidents · {model.counts.awaiting} awaiting triage</span>
            <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.clearIncidentLog(cycleId)}><Icon name="trash" size={13} />Remove</Button>
          </div>
          <div className="hf-sub" style={{ fontSize: 11.5, padding: "10px 14px" }}>
            Triage each incident into an alteration (per student or whole subject) on the{" "}
            <Link href={`/cycles/${cycleId}/adjustments`} style={{ color: H.pink, fontWeight: 600 }}>Adjustments</Link> step.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <Button onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={13} />{busy ? "Reading…" : "Add incident log"}</Button>
          <Button variant="ghost" onClick={() => provider.loadSampleIncidentLog(cycleId)} disabled={busy}>Load sample (labelled)</Button>
          {error && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
