"use client";

/**
 * Screen — Adjustments (replaces the old per-student exclusion step). Triage each
 * incident-log / complaint row into an alteration — applied to a specific student,
 * a whole subject (bulk), or no action. Nothing is auto-applied; every alteration
 * is a recorded human decision (audit-logged). The step is optional/skippable when
 * no incident log was added. (The per-student mark composition now lives on the
 * Grades screen — click a student there.)
 */
import { useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import type { AdjustmentIncident, AdjustmentsModel } from "@/lib/data/types";

export default function AdjustmentsPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const adj = useProviderData((p) => p.getAdjustments(cycleId), [cycleId]) as AdjustmentsModel | null;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Cycle";

  const shellProps = {
    cycleId,
    cycleName,
    page: "Adjustments",
    stageIndex: 5,
    done: 2,
    primary: (
      <Link href={`/cycles/${cycleId}/boundaries`}>
        <Button variant="pri">Continue to scoring<Icon name="arrow" color="#fff" /></Button>
      </Link>
    ),
  };

  if (!adj) {
    return (
      <CycleShell {...shellProps}>
        <div style={{ padding: 32 }} className="hf-sub">No adjustment data for this cycle.</div>
      </CycleShell>
    );
  }

  return (
    <CycleShell {...shellProps}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {/* header */}
        <div className="hf-pad" style={{ display: "flex", alignItems: "flex-end", gap: 20, padding: "22px 28px 0", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="hf-h1">Adjustments</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 640 }}>
              Triage each incident into a raw-mark alteration — per student, a whole subject, or no action.
              Nothing is applied automatically. (See each student’s mark composition on the Grades screen.)
            </div>
          </div>
          <div style={{ display: "flex", gap: 22 }}>
            <Stat n={String(adj.counts.incidents)} label="Incidents" />
            <Stat n={String(adj.counts.awaiting)} label="Awaiting" accent={adj.counts.awaiting > 0} />
            <Stat n={String(adj.counts.alterations)} label="Alterations" />
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", borderTop: `1px solid ${H.line}` }}>
          <Triage cycleId={cycleId} adj={adj} />
        </div>
      </div>
    </CycleShell>
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

// ── triage ──────────────────────────────────────────────────────────────────
function Triage({ cycleId, adj }: { cycleId: string; adj: AdjustmentsModel }) {
  const provider = useProvider();
  if (!adj.uploaded || adj.incidents.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "60px 30px", textAlign: "center" }}>
        <div style={{ width: 54, height: 54, borderRadius: 999, border: `1.5px dashed ${H.line2}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="doc" color={H.ink3} />
        </div>
        <div className="hf-h2">No incident log added</div>
        <div className="hf-sub" style={{ maxWidth: 520, lineHeight: 1.5 }}>
          This step is optional. Add an incident log at Ingest to triage faults and complaints into raw-mark
          alterations, or load a labelled sample to see how it works.
        </div>
        <div style={{ display: "flex", gap: 9 }}>
          <Button onClick={() => provider.loadSampleIncidentLog(cycleId)}>Load sample (labelled)</Button>
          <Link href={`/cycles/${cycleId}/import`}><Button variant="ghost">Go to upload</Button></Link>
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: "18px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
      {adj.incidents.map((inc) => (
        <IncidentRow key={inc.id} cycleId={cycleId} inc={inc} adj={adj} />
      ))}
    </div>
  );
}

function IncidentRow({ cycleId, inc, adj }: { cycleId: string; inc: AdjustmentIncident; adj: AdjustmentsModel }) {
  const provider = useProvider();
  const decided = inc.applyTo != null;
  const [editing, setEditing] = useState(false);
  const [applyTo, setApplyTo] = useState<"student" | "subject" | "none">(inc.applyTo ?? "student");
  const [studentId, setStudentId] = useState<string>(inc.studentId ?? inc.suggestedStudentId ?? adj.roster[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState<string>(inc.subjectId ?? adj.subjects[0]?.id ?? "");
  const [marks, setMarks] = useState<string>(String(inc.marks || ""));
  const [reason, setReason] = useState<string>(inc.reason ?? "");

  const needsReason = applyTo !== "none";
  const valid = !needsReason || (reason.trim().length > 0 && Number(marks) !== 0);
  const save = () => {
    provider.decideIncident(cycleId, inc.id, { applyTo, studentId, subjectId, marks: Number(marks) || 0, reason: reason.trim() || null });
    setEditing(false);
  };

  const open = editing || !decided;

  return (
    <div className="hf-card" style={{ padding: "14px 16px", borderColor: decided && !editing ? H.good : H.line }}>
      {/* context */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge tone={inc.source === "complaint" ? "warn" : "neutral"}>{inc.source === "complaint" ? "COMPLAINT" : "INCIDENT"}</Badge>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{inc.studentName || "—"}</span>
            {inc.exam && <span className="hf-mono" style={{ fontSize: 11, color: H.ink2, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 6px" }}>{inc.exam}</span>}
            {inc.staff && <span className="hf-sub" style={{ fontSize: 11 }}>· {inc.staff}</span>}
          </div>
          <div style={{ fontSize: 12.5, marginTop: 6, color: H.ink }}>
            {inc.issueType || inc.description || "—"}
          </div>
          <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>
            {inc.actionTaken && <>Action: {inc.actionTaken} · </>}
            {inc.questionsAffected && inc.questionsAffected.toLowerCase() !== "n/a" && <>Questions: {inc.questionsAffected} · </>}
            {inc.school && <>{inc.school} · </>}
            {inc.email && <span className="hf-mono">{inc.email}</span>}
          </div>
        </div>
        {decided && !editing && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DecidedTag inc={inc} adj={adj} />
            <Button variant="ghost" style={{ fontSize: 11.5 }} onClick={() => setEditing(true)}>Edit</Button>
          </div>
        )}
      </div>

      {/* decision editor */}
      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${H.line}`, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {([["student", "This student"], ["subject", "Whole subject"], ["none", "No action"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setApplyTo(k)} className={`hf-chip ${applyTo === k ? "on" : ""}`}>{label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            {applyTo === "student" && (
              <Field label={`Student${inc.suggestedStudentId ? " (suggested)" : ""}`}>
                <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="hf-select">
                  {adj.roster.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            )}
            {applyTo !== "none" && (
              <>
                <Field label="Subject">
                  <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="hf-select">
                    {adj.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}
                  </select>
                </Field>
                <Field label="Marks (+/−)">
                  <input value={marks} onChange={(e) => setMarks(e.target.value.replace(/[^0-9-]/g, ""))} inputMode="numeric" className="hf-input" style={{ width: 70, textAlign: "left" }} placeholder="e.g. +3" />
                </Field>
                <Field label="Reason (required)" grow>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} className="hf-textinput" placeholder="Why this alteration?" />
                </Field>
              </>
            )}
            <div style={{ display: "flex", gap: 7 }}>
              <Button variant="pri" disabled={!valid} onClick={save}>Save decision</Button>
              {decided && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </div>
          {applyTo === "subject" && (
            <div className="hf-sub" style={{ fontSize: 11, color: H.warn }}>
              <Mark kind="warn" size={12} /> Applies the same {marks || "0"} marks to <b>every</b> student in this subject (audit-logged per student).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DecidedTag({ inc, adj }: { inc: AdjustmentIncident; adj: AdjustmentsModel }) {
  if (inc.applyTo === "none") return <span className="hf-sub" style={{ fontSize: 11.5, color: H.ink3 }}>No action</span>;
  const subj = adj.subjects.find((s) => s.id === inc.subjectId)?.name ?? "—";
  const who = inc.applyTo === "subject" ? "whole subject" : adj.roster.find((r) => r.id === inc.studentId)?.name ?? "student";
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: H.good, fontWeight: 600 }}>
      <Mark kind="pass" size={13} />
      <span className="hf-mono">{inc.marks >= 0 ? "+" : ""}{inc.marks}</span> · {subj} · {who}
    </span>
  );
}

function Field({ label, children, grow }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: grow ? "1 1 220px" : "0 0 auto", minWidth: grow ? 200 : undefined }}>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{label}</span>
      {children}
    </label>
  );
}
