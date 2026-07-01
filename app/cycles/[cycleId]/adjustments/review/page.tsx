"use client";

/**
 * Screen — Incident adjustments · Review (02b, grade-bearing half).
 *
 * The team's sanity-check surface for the auto-apply engine before results are
 * finalised. For each student it shows the BASE engine score, the cumulative
 * (capped) incident mark change, and the ADJUSTED total — always decomposable as
 * `base + adjustment` — with a per-incident breakdown and clear flags where a
 * per-code cap or the per-student global cap was binding. Unclassified / errored /
 * unmatched incidents grant ZERO and are surfaced for manual attention.
 *
 * Viewable by ALL roles. Only an admin may COMMIT/apply the adjustments to scores
 * (`review.canApply` — provider-gated on `hasRole(user, 'admin')`); application is
 * an explicit admin action, never automatic on import. Committing never touches
 * base scores (they reconcile 1:1 with the raw oracle) — the adjustment is a
 * bounded layer stored on top.
 */
import { useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import type { IncidentReviewModel, IncidentReviewStudent } from "@/lib/data/types";

export default function IncidentReviewPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const review = useProviderData((p) => p.getIncidentReview(cycleId), [cycleId]) as IncidentReviewModel | null;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";

  const shellProps = {
    cycleId,
    cycleName,
    page: "Incident adjustments · Review",
    stageIndex: 5,
    primary: (
      <Link href={`/cycles/${cycleId}/score`}>
        <Button variant="pri" title="Continue to scoring">Continue<Icon name="arrow" color="#fff" /></Button>
      </Link>
    ),
  };

  if (!review) {
    return (
      <CycleShell {...shellProps}>
        <div style={{ padding: 32 }} className="hf-sub">No review data for this sitting.</div>
      </CycleShell>
    );
  }

  const empty = review.counts.incidents === 0;

  return (
    <CycleShell {...shellProps}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="hf-pad" style={{ display: "flex", alignItems: "flex-end", gap: 20, padding: "22px 28px 0", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="hf-h1">Incident adjustments · Review</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 680 }}>
              Team sign-off surface. Each student’s <b>base</b> engine score, the cumulative
              <b> incident mark change</b> (capped, add-only), and the <b>adjusted</b> total —
              decomposable at all times. Base scores are untouched; the adjustment is a bounded
              layer applied on top. Only an admin may commit it to scores.
            </div>
          </div>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
            <Stat n={String(review.counts.incidents)} label="Incidents" />
            <Stat n={String(review.counts.students)} label="Students" />
            <Stat n={String(review.counts.perCodeCapHits)} label="Per-code cap hits" accent={review.counts.perCodeCapHits > 0} />
            <Stat n={String(review.counts.perStudentCapHits)} label="Student-cap hits" accent={review.counts.perStudentCapHits > 0} />
            <Stat n={String(review.counts.unclassified + review.counts.error + review.counts.unmatched)} label="Need attention" accent={review.counts.unclassified + review.counts.error + review.counts.unmatched > 0} />
          </div>
        </div>

        <div style={{ padding: "14px 28px 0" }}>
          <ApplyBar cycleId={cycleId} review={review} empty={empty} />
        </div>

        <div style={{ flex: 1, overflow: "auto", borderTop: `1px solid ${H.line}`, marginTop: 14 }}>
          {empty ? (
            <EmptyState cycleId={cycleId} />
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
                    applied. Fix the Student ID in the source file (or the import mapping) and re-import.
                  </div>
                  <StudentTable title="" rows={review.unmatched} perStudentCap={review.perStudentCap} unmatched />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </CycleShell>
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

function EmptyState({ cycleId }: { cycleId: string }) {
  const provider = useProvider();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "60px 30px", textAlign: "center" }}>
      <div style={{ width: 54, height: 54, borderRadius: 999, border: `1.5px dashed ${H.line2}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="doc" color={H.ink3} />
      </div>
      <div className="hf-h2">No incidents imported</div>
      <div className="hf-sub" style={{ maxWidth: 520, lineHeight: 1.5 }}>
        Import an incident log (configured under Settings › Incident adjustments) to compute
        capped, add-only mark changes, or load a labelled sample to see the review surface.
      </div>
      <div style={{ display: "flex", gap: 9 }}>
        <Button onClick={() => provider.loadSampleIncidentRows(cycleId)}>Load sample (labelled)</Button>
        <Link href={`/cycles/${cycleId}/adjustments`}><Button variant="ghost">Back to triage</Button></Link>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
