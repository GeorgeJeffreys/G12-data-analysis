"use client";

/**
 * Screen — Adjustments (replaces the old per-student exclusion step). Two jobs:
 *  1. Triage each incident-log / complaint row into an alteration — applied to a
 *     specific student, a whole subject (bulk), or no action. Nothing is
 *     auto-applied; every alteration is a recorded human decision (audit-logged).
 *  2. Show the transparent per-student composition: MCQ + Essay + Alterations =
 *     subject total (out of its max).
 * The step is optional/skippable when no incident log was added.
 */
import { useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { LockBanner } from "@/components/shell/LockBanner";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { cyclesSubnav } from "@/lib/ui/subnav";
import type { AdjustmentIncident, AdjustmentsModel, CompositionModel } from "@/lib/data/types";

export default function AdjustmentsPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const adj = useProviderData((p) => p.getAdjustments(cycleId), [cycleId]) as AdjustmentsModel | null;
  const comp = useProviderData((p) => p.getComposition(cycleId), [cycleId]) as CompositionModel | null;
  const [tab, setTab] = useState<"triage" | "composition">("triage");

  const shellProps = {
    active: "Cycles" as const,
    crumb: [
      { label: "Cycles", href: "/" },
      { label: "May 2026", href: `/cycles/${cycleId}` },
      { label: "Adjustments" },
    ],
    subnav: cyclesSubnav(cycleId, "pipeline"),
    stageIndex: 2,
    done: 2,
    cycleId,
  };
  const continueAction = (
    <Link href={`/cycles/${cycleId}/boundaries`}>
      <Button variant="pri">Continue to scoring<Icon name="arrow" color="#fff" /></Button>
    </Link>
  );

  if (!adj) {
    return (
      <Shell {...shellProps} stageAction={continueAction}>
        <div style={{ padding: 32 }} className="hf-sub">No adjustment data for this cycle.</div>
      </Shell>
    );
  }

  return (
    <Shell {...shellProps} stageAction={continueAction}>
      <LockBanner cycleId={cycleId} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {/* header */}
        <div className="hf-pad" style={{ display: "flex", alignItems: "flex-end", gap: 20, padding: "22px 28px 0", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="hf-h1">Adjustments</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 640 }}>
              Triage each incident into a raw-mark alteration, and check how every subject total is built
              from <b style={{ color: H.ink }}>MCQ + Essay + Alterations</b>. Nothing is applied automatically.
            </div>
          </div>
          <div style={{ display: "flex", gap: 22 }}>
            <Stat n={String(adj.counts.incidents)} label="Incidents" />
            <Stat n={String(adj.counts.awaiting)} label="Awaiting" accent={adj.counts.awaiting > 0} />
            <Stat n={String(adj.counts.alterations)} label="Alterations" />
          </div>
        </div>

        {/* tabs */}
        <div className="hf-pad" style={{ display: "flex", gap: 4, padding: "14px 28px 0", borderBottom: `1px solid ${H.line}` }}>
          {([["triage", "Incident triage"], ["composition", "Mark composition"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{ padding: "9px 14px", fontSize: 13, fontWeight: tab === k ? 700 : 500, color: tab === k ? H.pink : H.ink2, borderBottom: `3px solid ${tab === k ? H.pink : "transparent"}`, background: "transparent", border: "none", cursor: "pointer" }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: "auto" }}>
          {tab === "triage" ? <Triage cycleId={cycleId} adj={adj} /> : <Composition comp={comp} />}
        </div>
      </div>
    </Shell>
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
          <Link href={`/cycles/${cycleId}/import`}><Button variant="ghost">Go to Data import</Button></Link>
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

// ── composition ─────────────────────────────────────────────────────────────
function Composition({ comp }: { comp: CompositionModel | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!comp) return <div style={{ padding: 28 }} className="hf-sub">No composition data.</div>;
  return (
    <div style={{ padding: "18px 28px" }}>
      <div className="hf-sub" style={{ fontSize: 12, marginBottom: 12 }}>
        Each subject total is <b style={{ color: H.ink }}>MCQ + Essay + Alterations</b>, out of its max
        (English/Arabic include the 20 essay marks). Click a student for the line-by-line breakdown.
      </div>
      <div className="hf-card" style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th className="hf-th">Student</th>
              {comp.subjects.map((s) => (
                <th key={s.id} className="hf-th" style={{ textAlign: "right" }}>
                  {s.name.split(" ")[0]}{s.hasEssay && <span style={{ color: H.pink }}> +E</span>}
                </th>
              ))}
              <th className="hf-th" style={{ textAlign: "right" }}>Overall</th>
            </tr>
          </thead>
          <tbody>
            {comp.students.map((st) => (
              <FragmentRow key={st.participantId} st={st} open={open === st.participantId} onToggle={() => setOpen(open === st.participantId ? null : st.participantId)} subjects={comp.subjects} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({ st, open, onToggle, subjects }: { st: CompositionModel["students"][number]; open: boolean; onToggle: () => void; subjects: CompositionModel["subjects"] }) {
  const bySubject = new Map(st.subjects.map((s) => [s.assessmentId, s]));
  return (
    <>
      <tr className="hf-hover" style={{ cursor: "pointer" }} onClick={onToggle}>
        <td className="hf-td">
          <span className="hf-mono" style={{ fontSize: 11, color: H.ink3, marginRight: 8 }}>{st.participantId}</span>
          <span style={{ fontWeight: 600, fontSize: 12.5 }}>{st.name}</span>
        </td>
        {subjects.map((sub) => {
          const c = bySubject.get(sub.id);
          return (
            <td key={sub.id} className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 12 }}>
              {c ? `${c.total}/${c.max}` : "—"}
            </td>
          );
        })}
        <td className="hf-td hf-mono" style={{ textAlign: "right", fontWeight: 700, fontSize: 12.5 }}>{st.overall.pct}%</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={subjects.length + 2} style={{ padding: 0, background: H.canvas }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "12px 16px" }}>
              {st.subjects.map((c) => (
                <div key={c.assessmentId} className="hf-card" style={{ padding: "10px 13px", minWidth: 190 }}>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{c.name}</div>
                  <div className="hf-mono" style={{ fontSize: 12, marginTop: 6, color: H.ink2, lineHeight: 1.7 }}>
                    <div>MCQ <span style={{ float: "right", color: H.ink }}>{c.mcq}</span></div>
                    <div>Essay <span style={{ float: "right", color: c.hasEssay ? H.ink : H.ink3 }}>{c.hasEssay ? c.essay : "—"}</span></div>
                    <div>Alterations <span style={{ float: "right", color: c.alterations ? H.pink : H.ink3 }}>{c.alterations >= 0 ? "+" : ""}{c.alterations}</span></div>
                    <div style={{ borderTop: `1px solid ${H.line2}`, marginTop: 4, paddingTop: 4, fontWeight: 700 }}>Total <span style={{ float: "right", color: H.ink }}>{c.total}/{c.max}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
