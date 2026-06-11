"use client";

/**
 * Screen 03 — Ingest & validate. Shows the real Section-10 validation report
 * from the ingest pipeline (run over the sample export), a cleaned-data preview,
 * and a duplicate-resolution panel when duplicates are found (the resolution
 * action is a provider stub for now). Progression is blocked on any hard-fail.
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark, type MarkKind } from "@/components/ui/icons";
import { parseEssayMarks } from "@/lib/data/parse-essays";
import { parseIncidentLog } from "@/lib/data/parse-incidents";
import type { AdjustmentsModel, DuplicateStrategy, EssayMarksModel } from "@/lib/data/types";

export default function IngestPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const model = useProviderData((p) => p.getIngest(cycleId), [cycleId]);
  const [resolved, setResolved] = useState<DuplicateStrategy | null>(null);

  if (!model) {
    return (
      <Shell crumb={[{ label: "Cycles", href: "/" }, { label: "Ingest" }]}>
        <div style={{ padding: 32 }} className="hf-sub">No ingest data for this cycle.</div>
      </Shell>
    );
  }

  const counts = model.report.checks.reduce(
    (acc, c) => ((acc[c.status] = (acc[c.status] ?? 0) + 1), acc),
    {} as Record<string, number>,
  );

  const resolve = (s: DuplicateStrategy) => {
    provider.resolveDuplicates(cycleId, s);
    setResolved(s);
  };

  return (
    <Shell
      crumb={[
        { label: "Cycles", href: "/" },
        { label: "May 2026", href: `/cycles/${cycleId}` },
        { label: "Ingest & validate" },
      ]}
      stageIndex={1}
      cycleId={cycleId}
      actions={
        <Button variant="danger">
          <Icon name="upload" />
          Re-upload export
        </Button>
      }
      stageAction={
        <Link href={model.canContinue ? `/cycles/${cycleId}/review` : "#"} tabIndex={model.canContinue ? undefined : -1}>
          <Button variant="pri" disabled={!model.canContinue}>
            Continue to review
            <Icon name="arrow" color="#fff" />
          </Button>
        </Link>
      }
    >
      <div style={{ display: "flex", flex: 1, alignItems: "stretch", minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "26px 30px", gap: 20, minWidth: 0 }}>
          <div>
            <div className="hf-h1">Ingest &amp; validate</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>
              Upload the raw exam export. We check it before anything else happens.
            </div>
          </div>

          {/* file area */}
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div
              style={{
                flex: "1 1 62%",
                height: 64,
                border: `1.5px dashed ${H.line2}`,
                borderRadius: 10,
                background: "repeating-linear-gradient(135deg, transparent 0 9px, var(--tint2) 9px 10px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span className="hf-mono" style={{ fontSize: 11, color: H.ink2 }}>
                {model.fileName} · {model.fileSizeMB} MB
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
              <span className="hf-mono" style={{ fontSize: 11, color: H.ink2 }}>uploaded {model.uploadedAgo}</span>
              <Button variant="ghost">Replace file</Button>
            </div>
          </div>

          {/* validation report */}
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 11, alignItems: "center" }}>
              <span className="hf-lbl">Validation report</span>
              <span className="hf-sub" style={{ fontSize: 11.5 }}>
                {counts.pass ?? 0} passed · {counts.warn ?? 0} warnings · {counts.fail ?? 0} must fix
              </span>
            </div>
            <div className="hf-card" style={{ overflow: "hidden" }}>
              {model.report.checks.map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "12px 15px",
                    gap: 12,
                    borderBottom: i < model.report.checks.length - 1 ? `1px solid ${H.line}` : "none",
                    background: c.status === "fail" ? H.badSoft : "transparent",
                  }}
                >
                  <Mark kind={c.status as MarkKind} size={17} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: c.status === "fail" ? 600 : 500 }}>{c.label}</div>
                    <div className="hf-sub" style={{ fontSize: 11.5 }}>{c.detail}</div>
                  </div>
                  {c.count != null && (
                    <span className="hf-mono" style={{ fontSize: 11.5, color: c.status === "fail" ? H.bad : H.ink2 }}>
                      {c.count}
                    </span>
                  )}
                  {c.status !== "pass" && <Button variant="ghost" style={{ fontSize: 11.5 }}>Review</Button>}
                </div>
              ))}
            </div>
          </div>

          {/* duplicate-resolution panel (only when duplicates exist) */}
          {model.duplicates > 0 && (
            <div className="hf-card" style={{ padding: "15px 17px", background: H.badSoft, borderColor: H.bad, display: "flex", gap: 13, alignItems: "flex-start" }}>
              <Mark kind="fail" size={18} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: H.bad, fontSize: 13.5 }}>
                  {model.duplicates} students submitted twice — resolve before scoring.
                </div>
                <div className="hf-sub" style={{ marginTop: 5 }}>
                  Keep the latest submission, keep the first, or exclude these students from this assessment. You can also re-upload a corrected export.
                </div>
                {resolved ? (
                  <div className="hf-sub" style={{ marginTop: 10, color: H.ink }}>
                    Recorded choice: <strong>{labelFor(resolved)}</strong>{" "}
                    <span className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>(stub — no DB write)</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
                    <Button onClick={() => resolve("keep_latest")}>Keep latest</Button>
                    <Button onClick={() => resolve("keep_first")}>Keep first</Button>
                    <Button variant="ghost" onClick={() => resolve("exclude")}>Exclude students</Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* OPTIONAL essay-marks upload (English/Arabic; never gates progress) */}
          <EssayMarksPanel cycleId={cycleId} />

          {/* OPTIONAL incident log (triaged into alterations on Adjustments) */}
          <IncidentLogPanel cycleId={cycleId} />
        </div>

        {/* cleaned data preview */}
        <aside
          style={{
            width: 372,
            flex: "0 0 auto",
            borderLeft: `1px solid ${H.line2}`,
            background: H.paper,
            boxShadow: "-12px 0 28px -18px rgba(31,42,49,.20)",
            padding: "26px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 13,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="hf-lbl">Cleaned data preview</span>
            <span className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>first {model.preview.rows.length} rows</span>
          </div>
          <div className="hf-card" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr>
                  {model.preview.headers.map((h) => (
                    <th key={h} className="hf-th" style={{ padding: "7px 9px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.preview.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((c, j) => (
                      <td key={j} className="hf-td hf-mono" style={{ padding: "7px 9px", color: c === "—" ? H.ink3 : H.ink }}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hf-sub">
            MCQ-only rows after cleaning: <span className="hf-mono">{model.report.stats.mcqRows.toLocaleString()}</span>. Surveys and non-MCQ rows removed; Arabic encoding repaired.
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function labelFor(s: DuplicateStrategy): string {
  return s === "keep_latest" ? "Keep latest" : s === "keep_first" ? "Keep first" : "Exclude students";
}


/**
 * Optional essay-marks upload (English + Arabic only). Parsed client-side; the
 * marks flow into the Adjustments view and into the subject totals at Score. It
 * NEVER blocks the pipeline. A clearly-labelled sample can be loaded without a
 * file. Matched students and any unmatched IDs are surfaced for the team.
 */
function EssayMarksPanel({ cycleId }: { cycleId: string }) {
  const provider = useProvider();
  const model = useProviderData((p) => p.getEssayMarks(cycleId), [cycleId]) as EssayMarksModel | null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await parseEssayMarks(file);
      if (rows.length === 0) {
        setError("No essay rows found. Expected AFL / ESL sheets with ParticipantID and TotalScore columns.");
      } else {
        provider.uploadEssayMarks(cycleId, file.name, rows);
      }
    } catch {
      setError("Couldn’t read that file. Use a .xlsx with per-subject sheets (AFL, ESL).");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (!model) return null;

  return (
    <div className="hf-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span className="hf-h2">Essay marks file</span>
            <span style={{ fontSize: 9, color: H.ink2, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 6px", letterSpacing: 0.4 }}>OPTIONAL</span>
          </div>
          <div className="hf-sub" style={{ fontSize: 12, marginTop: 4, maxWidth: 580 }}>
            Offline-marked essays for <b style={{ color: H.ink }}>English &amp; Arabic only</b> — per-subject sheets{" "}
            <span className="hf-mono" style={{ fontSize: 11 }}>AFL · ESL</span>, keyed by ParticipantID, marked out of 20
            (the <span className="hf-mono" style={{ fontSize: 11 }}>TotalScore</span> column; the rubric D1–D5 columns are ignored).
            Adds to the subject total. This <b style={{ color: H.ink }}>never blocks</b> the pipeline.
          </div>
        </div>
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: H.ink3 }}>
          <Icon name="lock" size={12} color={H.ink3} />
          <span className="hf-sub" style={{ fontSize: 11 }}>optional</span>
        </span>
      </div>

      {model.uploaded ? (
        <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", background: model.sample ? H.pinkSoft2 : H.tint, borderBottom: `1px solid ${H.line2}` }}>
            <Mark kind="pass" size={16} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{model.fileName}</span>
            {model.sample && <Badge tone="accent">SAMPLE</Badge>}
            <span style={{ flex: 1 }} />
            <span className="hf-sub" style={{ fontSize: 11.5 }}>
              {model.matchedCount} students matched · {model.subjects.map((s) => `${s.code} ${s.count}`).join(" · ")}
            </span>
            <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.clearEssayMarks(cycleId)}>
              <Icon name="trash" size={13} />Remove
            </Button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr>{model.preview.headers.map((h) => <th key={h} className="hf-th" style={{ padding: "7px 12px" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {model.preview.rows.map((row, i) => (
                <tr key={i}>{row.map((c, j) => <td key={j} className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {model.unmatchedIds.length > 0 && (
            <div className="hf-sub" style={{ fontSize: 11, padding: "8px 14px", borderTop: `1px solid ${H.line}` }}>
              {model.unmatchedIds.length} ParticipantID(s) didn’t match the roster (e.g.{" "}
              <span className="hf-mono">{model.unmatchedIds.slice(0, 3).join(", ")}</span>) — those marks were skipped.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="upload" size={13} />{busy ? "Reading…" : "Add essay-marks file"}
          </Button>
          <Button variant="ghost" onClick={() => provider.loadSampleEssayMarks(cycleId)} disabled={busy}>
            Load sample (labelled)
          </Button>
          {error && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Optional incident-log upload (operational record + student complaints). Parsed
 * client-side and queued for human triage on the Adjustments step — never
 * auto-applied, never blocks the pipeline. A labelled sample can be loaded.
 */
function IncidentLogPanel({ cycleId }: { cycleId: string }) {
  const provider = useProvider();
  const model = useProviderData((p) => p.getAdjustments(cycleId), [cycleId]) as AdjustmentsModel | null;
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

  if (!model) return null;

  return (
    <div className="hf-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span className="hf-h2">Incident log</span>
            <span style={{ fontSize: 9, color: H.ink2, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 6px", letterSpacing: 0.4 }}>OPTIONAL</span>
          </div>
          <div className="hf-sub" style={{ fontSize: 12, marginTop: 4, maxWidth: 580 }}>
            The operational record (<span className="hf-mono" style={{ fontSize: 11 }}>Incident_Log</span>) plus student
            complaints. Each row is <b style={{ color: H.ink }}>queued for human triage</b> on the Adjustments step —
            nothing is auto-applied. This <b style={{ color: H.ink }}>never blocks</b> the pipeline.
          </div>
        </div>
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: H.ink3 }}>
          <Icon name="lock" size={12} color={H.ink3} />
          <span className="hf-sub" style={{ fontSize: 11 }}>optional</span>
        </span>
      </div>

      {model.uploaded ? (
        <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", background: model.sample ? H.pinkSoft2 : H.tint, borderBottom: `1px solid ${H.line2}` }}>
            <Mark kind="pass" size={16} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{model.fileName}</span>
            {model.sample && <Badge tone="accent">SAMPLE</Badge>}
            <span style={{ flex: 1 }} />
            <span className="hf-sub" style={{ fontSize: 11.5 }}>
              {model.counts.incidents} incidents · {model.counts.awaiting} awaiting triage
            </span>
            <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.clearIncidentLog(cycleId)}>
              <Icon name="trash" size={13} />Remove
            </Button>
          </div>
          <div className="hf-sub" style={{ fontSize: 11.5, padding: "10px 14px" }}>
            Triage each incident into an alteration (per student or whole subject) on the{" "}
            <Link href={`/cycles/${cycleId}/adjustments`} style={{ color: H.pink, fontWeight: 600 }}>Adjustments</Link> step.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="upload" size={13} />{busy ? "Reading…" : "Add incident log"}
          </Button>
          <Button variant="ghost" onClick={() => provider.loadSampleIncidentLog(cycleId)} disabled={busy}>
            Load sample (labelled)
          </Button>
          {error && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
