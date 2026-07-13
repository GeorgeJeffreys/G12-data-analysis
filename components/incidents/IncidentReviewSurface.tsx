"use client";

/**
 * The config-driven Incident Adjustments surface (02b) — the single component both
 * the critical-path STEP (`/adjustments`) and its review deep-link
 * (`/adjustments/review`) render, so they never drift apart.
 *
 * It is the direct product of wiring the step to the admin Incident config: every
 * imported incident row is matched to a configured incident CODE (bucketing), its
 * mark alteration is AUTO-COMPUTED from that code's formula, clamped to the code's
 * per-incident cap and the per-student global cap, and shown as
 * `base + adjustment = adjusted` per student — never "nothing is applied
 * automatically". Unmatched / unclassified / errored rows grant ZERO and are
 * surfaced for manual attention (the manual-override step), never silently applied.
 *
 * Base scores are the untouched engine figures (they reconcile 1:1 with the raw
 * oracle); the adjustment is a bounded, add-only layer on top. Viewable by all
 * roles; only an admin may COMMIT it to scores (`review.canApply`).
 *
 * `showImporter` turns on the real-file import controls (the step owns import; the
 * review deep-link is view/commit only).
 */
import { useRef, useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { readIncidentWorkbook, parseIncidentRows, resolveParticipants } from "@/lib/incidents/import";
import type { IncidentReviewModel, IncidentReviewStudent } from "@/lib/data/types";

export function IncidentReviewSurface({ cycleId, showImporter = false }: { cycleId: string; showImporter?: boolean }) {
  const review = useProviderData((p) => p.getIncidentReview(cycleId), [cycleId]) as IncidentReviewModel | null;
  if (!review) return <div style={{ padding: 32 }} className="hf-sub">No review data for this sitting.</div>;

  const empty = review.counts.incidents === 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ padding: "14px 28px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        <StatRow review={review} />
        <ApplyBar cycleId={cycleId} review={review} empty={empty} />
        {!empty && review.source && <SourceCard cycleId={cycleId} review={review} showImporter={showImporter} />}
      </div>

      <div style={{ flex: 1, overflow: "auto", borderTop: `1px solid ${H.line}`, marginTop: 14 }}>
        {empty ? (
          <EmptyState cycleId={cycleId} showImporter={showImporter} />
        ) : (
          <div style={{ padding: "18px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
            <StudentTable title="Adjusted students" rows={review.students} perStudentCap={review.perStudentCap} />
            {review.unmatched.length > 0 && (
              <div>
                <div className="hf-h2" style={{ marginBottom: 8, color: H.warn }}>
                  <Mark kind="warn" size={13} /> Unmatched incidents ({review.unmatched.length})
                </div>
                <div className="hf-sub" style={{ fontSize: 11.5, marginBottom: 8, maxWidth: 620 }}>
                  These incident rows did not resolve to a cohort participant, so no adjustment is
                  applied. Fix the Student ID in the source file (or the import mapping) and re-import,
                  or handle them on the manual-override step.
                </div>
                <StudentTable title="" rows={review.unmatched} perStudentCap={review.perStudentCap} unmatched />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatRow({ review }: { review: IncidentReviewModel }) {
  const attention = review.counts.unclassified + review.counts.error + review.counts.unmatched;
  return (
    <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
      <Stat n={String(review.counts.incidents)} label="Incidents" />
      <Stat n={String(review.counts.students)} label="Students" />
      <Stat n={String(review.counts.perCodeCapHits)} label="Per-code cap hits" accent={review.counts.perCodeCapHits > 0} />
      <Stat n={String(review.counts.perStudentCapHits)} label="Student-cap hits" accent={review.counts.perStudentCapHits > 0} />
      <Stat n={String(attention)} label="Need attention" accent={attention > 0} />
    </div>
  );
}

// The imported source (real incident file) with a Remove control.
function SourceCard({ cycleId, review, showImporter }: { cycleId: string; review: IncidentReviewModel; showImporter: boolean }) {
  const provider = useProvider();
  const src = review.source!;
  return (
    <div className="hf-card" style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", background: H.tint, flexWrap: "wrap" }}>
      <Mark kind="pass" size={16} />
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{src.fileName}</span>
      <span style={{ flex: 1 }} />
      {showImporter && (
        <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.clearIncidentRows(cycleId)}>
          <Icon name="trash" size={13} />Remove
        </Button>
      )}
    </div>
  );
}

function ApplyBar({ cycleId, review, empty }: { cycleId: string; review: IncidentReviewModel; empty: boolean }) {
  const provider = useProvider();
  const applied = review.applied;
  return (
    <div
      className="hf-card"
      style={{
        display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", flexWrap: "wrap",
        borderColor: applied ? H.good : H.line,
        background: applied ? "rgba(16,185,129,0.05)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 240 }}>
        {applied ? <Mark kind="pass" size={15} /> : <Icon name="doc" color={H.ink3} />}
        <div>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>
            {applied ? "Adjustments applied to scores" : "Adjustments not yet applied"}
          </div>
          <div className="hf-sub" style={{ fontSize: 11.5 }}>
            {applied
              ? <>Committed by {review.appliedBy}{review.appliedAt ? ` · ${new Date(review.appliedAt).toLocaleString()}` : ""}. Base scores unchanged.</>
              : <>Base scores stand alone — Raw / Candidate Scores exports reconcile with the raw oracle. {review.perStudentCap === null ? "No per-student cap set." : `Per-student cap: ${review.perStudentCap} marks.`}</>}
          </div>
        </div>
      </div>
      {review.canApply ? (
        <div style={{ display: "flex", gap: 8 }}>
          {applied ? (
            <Button variant="ghost" onClick={() => provider.unapplyIncidentAdjustments(cycleId)}>Revert</Button>
          ) : (
            <Button variant="pri" disabled={empty} onClick={() => provider.applyIncidentAdjustments(cycleId)}>Apply adjustments</Button>
          )}
        </div>
      ) : (
        <Badge tone="neutral">Admin only</Badge>
      )}
    </div>
  );
}

function StudentTable({ title, rows, perStudentCap, unmatched }: { title: string; rows: IncidentReviewStudent[]; perStudentCap: number | null; unmatched?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div>
      {title && <div className="hf-h2" style={{ marginBottom: 8 }}>{title}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((s) => (
          <StudentRow key={s.participantKey} s={s} perStudentCap={perStudentCap} unmatched={unmatched} />
        ))}
      </div>
    </div>
  );
}

function StudentRow({ s, perStudentCap, unmatched }: { s: IncidentReviewStudent; perStudentCap: number | null; unmatched?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hf-card" style={{ padding: "12px 14px", borderColor: unmatched ? H.warn : s.perStudentCapHit || s.perCodeCapHit ? H.line2 : H.line }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</span>
          {unmatched && <Badge tone="warn">UNMATCHED</Badge>}
          {s.perStudentCapHit && <Badge tone="warn">Student cap</Badge>}
          {s.perCodeCapHit && <Badge tone="neutral">Per-code cap</Badge>}
        </div>
        {/* base + adjustment = adjusted, always decomposed */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <NumCol label="Base" value={fmt(s.base)} />
          <span style={{ color: H.ink3, fontWeight: 700 }}>+</span>
          <NumCol label="Adjustment" value={`+${fmt(s.adjustment)}`} accent={s.adjustment > 0} strike={s.perStudentCapHit ? fmt(s.uncappedAdjustment) : undefined} />
          <span style={{ color: H.ink3, fontWeight: 700 }}>=</span>
          <NumCol label="Adjusted" value={fmt(s.adjusted)} bold />
          <Button variant="ghost" style={{ fontSize: 11.5 }} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Breakdown"} ({s.contributions.length})
          </Button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${H.line}`, display: "flex", flexDirection: "column", gap: 6 }}>
          {s.perStudentCapHit && (
            <div className="hf-sub" style={{ fontSize: 11, color: H.warn }}>
              <Mark kind="warn" size={11} /> Per-student global cap bound: {fmt(s.uncappedAdjustment)} → {fmt(s.adjustment)}{perStudentCap !== null ? ` (cap ${perStudentCap})` : ""}.
            </div>
          )}
          {s.contributions.map((c) => (
            <div key={c.rowNumber} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, flexWrap: "wrap" }}>
              <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink3, minWidth: 34 }}>#{c.rowNumber}</span>
              <span style={{ minWidth: 130 }}>{c.incidentType || "—"}</span>
              {c.code ? (
                <span className="hf-mono" style={{ fontSize: 10.5, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 6px" }}>{c.code}</span>
              ) : (
                <Badge tone={c.status === "error" ? "warn" : "neutral"}>{c.status === "error" ? "ERROR" : "UNCLASSIFIED"}</Badge>
              )}
              {c.durationMinutes !== null && <span className="hf-sub" style={{ fontSize: 11 }}>{c.durationMinutes} min</span>}
              <span style={{ flex: 1 }} />
              {c.perCodeCapHit && (
                <span className="hf-sub" style={{ fontSize: 10.5, color: H.warn }}>
                  raw {fmt(c.rawMarks)} → cap {c.perCodeCap}
                </span>
              )}
              <span className="hf-mono" style={{ fontWeight: 700, color: c.marks > 0 ? H.good : H.ink3, minWidth: 44, textAlign: "right" }}>
                +{fmt(c.marks)}
              </span>
            </div>
          ))}
          {s.contributions.some((c) => c.errors.length > 0) && (
            <div className="hf-sub" style={{ fontSize: 10.5, color: H.warn, marginTop: 2 }}>
              {s.contributions.flatMap((c) => c.errors).join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NumCol({ label, value, accent, bold, strike }: { label: string; value: string; accent?: boolean; bold?: boolean; strike?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, minWidth: 58 }}>
      <span className="hf-mono" style={{ fontSize: bold ? 15 : 13.5, fontWeight: bold ? 700 : 600, color: accent ? H.good : H.ink }}>
        {strike && <span style={{ textDecoration: "line-through", color: H.ink3, fontWeight: 400, marginRight: 4, fontSize: 11 }}>+{strike}</span>}
        {value}
      </span>
      <span className="hf-lbl" style={{ fontSize: 9 }}>{label}</span>
    </div>
  );
}

function Stat({ n, label, accent }: { n: string; label: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="hf-mono" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1, color: accent ? H.pink : H.ink }}>{n}</span>
      <span className="hf-lbl" style={{ marginTop: 3 }}>{label}</span>
    </div>
  );
}

function EmptyState({ cycleId, showImporter }: { cycleId: string; showImporter: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "60px 30px", textAlign: "center" }}>
      <div style={{ width: 54, height: 54, borderRadius: 999, border: `1.5px dashed ${H.line2}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="doc" color={H.ink3} />
      </div>
      <div className="hf-h2">No incidents imported</div>
      <div className="hf-sub" style={{ maxWidth: 540, lineHeight: 1.5 }}>
        Import an incident log to auto-match each incident to a configured code
        (Settings › Incident adjustments) and compute capped, add-only mark changes.
        Nothing is applied to scores until an admin commits it.
      </div>
      {showImporter && <IncidentImporter cycleId={cycleId} />}
    </div>
  );
}

/**
 * Real-file import wired to the CONFIG: reads the workbook, parses+classifies rows
 * against the admin column mapping + incident codes (`parseIncidentRows`), resolves
 * each row to a cohort participant on P-A's stable id (`resolveParticipants`), then
 * hands the resolved rows to the provider — where the apply engine computes the
 * capped, add-only per-student adjustment. Replaces the sample with real data.
 */
export function IncidentImporter({ cycleId }: { cycleId: string }) {
  const provider = useProvider();
  const config = useProviderData((p) => p.getIncidentConfig(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const rawRows = await readIncidentWorkbook(file);
      const parsed = parseIncidentRows(rawRows, config.mapping, config.codes);
      if (parsed.rows.length === 0) {
        setError("No incident rows found. Check the sheet and the column mapping (Settings › Incident adjustments).");
        return;
      }
      const roster = provider.getIncidentRoster(cycleId);
      const resolved = resolveParticipants(parsed.rows, roster);
      provider.importIncidentRows(cycleId, resolved, { fileName: file.name, sample: false });
    } catch {
      setError("Couldn’t read that file. Use a .xlsx/.csv whose columns match the configured mapping.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <Button onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={13} />{busy ? "Reading…" : "Import incident log"}</Button>
      {error && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>{error}</span>}
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
