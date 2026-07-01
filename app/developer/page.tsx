"use client";

/**
 * Developer data-flow view (task 15) — admin/developer-only, strictly READ-ONLY.
 *
 * Reveals the REAL data underneath the pipeline for the current (live) cycle and
 * the transformation applied at each stage, so a participant/item collapse or drop
 * is obvious the moment it occurs. It never writes or recomputes anything — every
 * figure and row is read from the provider's own computed artifacts (see
 * lib/data/data-flow.ts), keyed on the internal participant id.
 *
 * Layout:
 *   1. Stage strip (top, always visible): per subject, distinct-participant + item
 *      counts at every stage (Ingested → Cleaned cohort → Score matrix → Computed
 *      scores), highlighting any stage where a subject's participant count drops.
 *   2. Per-stage detail: expand a stage to see Input → Transformation → Output.
 *   3. Drill: filter to one subject and/or one participant and follow them across
 *      every stage.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useProvider, useProviderData } from "@/lib/data/context";
import { hasRole } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Badge, Card } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { buildDataFlow, type DataFlowStageKey, type DataFlowSubject, type DataFlowTable } from "@/lib/data/data-flow";

const STAGE_ORDER: DataFlowStageKey[] = ["ingested", "cleaned", "matrix", "computed"];
const ALL_PARTICIPANTS = "__all__";

export default function DeveloperPage() {
  const provider = useProvider();
  const router = useRouter();
  const isAdmin = useProviderData((p) => hasRole(p.getCurrentUser().role, "admin"));

  // Admin-gated: authenticated-but-not-admin users are sent to the access-denied
  // screen (the whole surface is restricted, not just individual controls).
  useEffect(() => {
    if (!isAdmin) router.replace("/access-denied");
  }, [isAdmin, router]);

  // The developer view targets the CURRENT (live) cycle — no cycle picker.
  const liveCycleId = useProviderData((p) => p.listCycles().find((c) => c.live)?.id ?? null);
  const model = useProviderData((p) => (liveCycleId ? buildDataFlow(p, liveCycleId) : null), [liveCycleId]);

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [participant, setParticipant] = useState<string>(ALL_PARTICIPANTS);
  const [openStage, setOpenStage] = useState<DataFlowStageKey | null>("ingested");

  // Default the selected subject to the first one that shows a participant drop
  // (the thing you came here to see), else the first subject.
  const subjects = model?.subjects ?? [];
  const defaultSubjectId = useMemo(() => {
    const first = subjects[0];
    if (!first) return null;
    return (subjects.find((s) => s.hasParticipantDrop) ?? first).assessmentId;
  }, [subjects]);
  const activeSubjectId = subjectId ?? defaultSubjectId;
  const subject = subjects.find((s) => s.assessmentId === activeSubjectId) ?? null;

  // Participant options come from the selected subject's ingested (fullest) roster.
  const participantOptions = useMemo(() => {
    if (!subject) return [] as { id: string; name: string }[];
    const t = subject.tables.ingested;
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    t.participantIds.forEach((id, i) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, name: String(t.rows[i]?.[0] ?? id) });
    });
    return out;
  }, [subject]);
  const drillId = participant === ALL_PARTICIPANTS ? null : participant;

  if (!isAdmin) {
    return (
      <Shell active="Developer" crumb={[{ label: "Developer" }]}>
        <div style={{ padding: 32, color: H.ink3, fontSize: 13 }}>Redirecting…</div>
      </Shell>
    );
  }

  return (
    <Shell
      active="Developer"
      crumb={[{ label: "Developer" }, { label: "Data flow" }]}
      status={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Badge tone="neutral">
            <Icon name="lock" size={11} color={H.ink2} /> Read-only
          </Badge>
          <Badge tone="accent">Admin</Badge>
        </span>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "22px 28px", gap: 18, flex: 1, minWidth: 0 }}>
        <div>
          <div className="hf-h1">Developer · data flow</div>
          <div className="hf-sub" style={{ marginTop: 6, fontSize: 13, maxWidth: 820, lineHeight: 1.5 }}>
            The real data underneath the pipeline for the current sitting, and the transformation applied at every
            stage. Read-only — this reflects the app’s actual persisted/computed artifacts (keyed on the internal
            participant id); it never writes or recomputes anything.
          </div>
        </div>

        {!model || subjects.length === 0 ? (
          <Card style={{ padding: "18px 20px", color: H.ink2, fontSize: 13 }}>
            No ingested data for the current sitting yet. Upload a raw export to populate the pipeline, then return
            here to trace it stage by stage.
          </Card>
        ) : (
          <>
            <StageStrip
              subjects={subjects}
              activeSubjectId={activeSubjectId}
              onPick={(id) => {
                setSubjectId(id);
                setParticipant(ALL_PARTICIPANTS);
              }}
            />

            {/* ── Drill controls ─────────────────────────────────────────────── */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span className="hf-lbl">Subject</span>
                <select
                  value={activeSubjectId ?? ""}
                  onChange={(e) => {
                    setSubjectId(e.target.value);
                    setParticipant(ALL_PARTICIPANTS);
                  }}
                  style={selectStyle}
                >
                  {subjects.map((s) => (
                    <option key={s.assessmentId} value={s.assessmentId}>
                      {s.shortName}
                      {s.hasParticipantDrop ? "  ⚠ drop" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span className="hf-lbl">Participant</span>
                <select value={participant} onChange={(e) => setParticipant(e.target.value)} style={selectStyle}>
                  <option value={ALL_PARTICIPANTS}>All participants</option>
                  {participantOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.id}
                    </option>
                  ))}
                </select>
              </label>
              {drillId && (
                <span className="hf-sub" style={{ fontSize: 11.5, fontStyle: "italic" }}>
                  Following <b style={{ color: H.pink }}>{drillId}</b> across every stage — highlighted below.
                </span>
              )}
            </div>

            {drillId && subject && <DrillTrace subject={subject} participantId={drillId} />}

            {/* ── Per-stage detail (Input → Transform → Output) ─────────────── */}
            {subject && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {STAGE_ORDER.map((key, i) => {
                  const stage = model.stages.find((s) => s.key === key)!;
                  const count = subject.counts[key];
                  const prevKey = i > 0 ? STAGE_ORDER[i - 1] : null;
                  return (
                    <StagePanel
                      key={key}
                      index={i}
                      stageLabel={stage.label}
                      transform={stage.transform}
                      operatesOn={stage.operatesOn}
                      source={stage.source}
                      count={count}
                      open={openStage === key}
                      onToggle={() => setOpenStage((cur) => (cur === key ? null : key))}
                      inputTable={prevKey ? subject.tables[prevKey] : null}
                      inputLabel={prevKey ? model.stages.find((s) => s.key === prevKey)!.label : "Raw Questionmark export"}
                      inputProvenance={prevKey ? null : model.ingest}
                      outputTable={subject.tables[key]}
                      drillId={drillId}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

const selectStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "5px 8px",
  borderRadius: 7,
  border: `1px solid ${H.line2}`,
  background: H.paper,
  color: H.ink,
};

/**
 * The at-a-glance collapse detector: per subject, participant + item counts at
 * every stage. A stage cell is highlighted (magenta, ⤓) whenever its participant
 * count dropped from the previous stage.
 */
function StageStrip({
  subjects,
  activeSubjectId,
  onPick,
}: {
  subjects: DataFlowSubject[];
  activeSubjectId: string | null;
  onPick: (id: string) => void;
}) {
  const labels: Record<DataFlowStageKey, string> = {
    ingested: "Ingested",
    cleaned: "Cleaned cohort",
    matrix: "Score matrix",
    computed: "Computed scores",
  };
  return (
    <Card style={{ padding: 0, overflow: "auto" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${H.line2}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="hf-h2" style={{ fontSize: 14 }}>Stage strip</span>
        <span className="hf-sub" style={{ fontSize: 11 }}>participants · items, per subject, left → right</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: H.pink, fontWeight: 700 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: H.pinkSoft, border: `1px solid ${H.pink}` }} /> participant drop
        </span>
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 620 }}>
        <thead>
          <tr style={{ background: H.canvas }}>
            <th style={{ textAlign: "left", padding: "8px 14px", borderBottom: `1px solid ${H.line2}`, color: H.ink2, fontWeight: 700 }}>Subject</th>
            {STAGE_ORDER.map((k, i) => (
              <th key={k} style={{ textAlign: "center", padding: "8px 14px", borderBottom: `1px solid ${H.line2}`, color: H.ink2, fontWeight: 700 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {i > 0 && <Icon name="arrow" size={11} color={H.ink3} />}
                  {labels[k]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subjects.map((s) => {
            const on = s.assessmentId === activeSubjectId;
            return (
              <tr
                key={s.assessmentId}
                onClick={() => onPick(s.assessmentId)}
                style={{ cursor: "pointer", background: on ? H.pinkSoft2 : "transparent", borderBottom: `1px solid ${H.line}` }}
              >
                <td style={{ padding: "8px 14px", fontWeight: 600, color: on ? H.pink : H.ink, whiteSpace: "nowrap" }} dir={s.rtl ? "rtl" : undefined}>
                  {s.shortName}
                  {s.hasParticipantDrop && <span title="Participant count drops between stages" style={{ marginInlineStart: 6, color: H.pink }}>⚠</span>}
                </td>
                {STAGE_ORDER.map((k) => {
                  const c = s.counts[k];
                  const drop = c.participantDrop;
                  return (
                    <td
                      key={k}
                      style={{
                        padding: "8px 14px",
                        textAlign: "center",
                        background: drop ? H.pinkSoft : "transparent",
                        borderInline: drop ? `1px solid ${H.pink}` : "1px solid transparent",
                      }}
                      title={
                        drop && c.prevParticipants != null
                          ? `Participants dropped ${c.prevParticipants} → ${c.participants} from the previous stage`
                          : undefined
                      }
                    >
                      <span className="hf-mono" style={{ fontSize: 14, fontWeight: 700, color: drop ? H.pink : H.ink }}>
                        {c.participants}
                        {drop && <span aria-hidden style={{ fontSize: 11 }}> ⤓</span>}
                      </span>
                      <span className="hf-mono" style={{ display: "block", fontSize: 10.5, color: H.ink3 }}>{c.items} items</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/** Trace one participant across every stage of the selected subject (present/absent + key figures). */
function DrillTrace({ subject, participantId }: { subject: DataFlowSubject; participantId: string }) {
  const cell = (t: DataFlowTable) => {
    const idx = t.participantIds.indexOf(participantId);
    if (idx < 0) return { present: false, struck: false, row: null as (string | number | null)[] | null, headers: t.headers };
    return { present: true, struck: t.struckRows.includes(idx), row: t.rows[idx] ?? null, headers: t.headers };
  };
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span className="hf-h2" style={{ fontSize: 14 }}>Trace</span>
        <span className="hf-mono" style={{ fontSize: 12, color: H.pink, fontWeight: 700 }}>{participantId}</span>
        <span className="hf-sub" style={{ fontSize: 11 }}>· {subject.shortName} · across every stage</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {STAGE_ORDER.map((k) => {
          const info = cell(subject.tables[k]);
          const label: Record<DataFlowStageKey, string> = { ingested: "Ingested", cleaned: "Cleaned cohort", matrix: "Score matrix", computed: "Computed scores" };
          return (
            <div key={k} style={{ border: `1px solid ${H.line2}`, borderRadius: 9, padding: "10px 12px", background: H.paper, minWidth: 0 }}>
              <div className="hf-lbl" style={{ fontSize: 10 }}>{label[k]}</div>
              {!info.present ? (
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: H.bad }}>Absent</div>
              ) : (
                <>
                  <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: info.struck ? H.bad : H.good }}>
                    {info.struck ? "Present (excluded)" : "Present"}
                  </div>
                  {k === "computed" && info.row ? (
                    <div className="hf-mono" style={{ marginTop: 6, fontSize: 11.5, color: H.ink2, lineHeight: 1.5 }}>
                      MCQ {info.row[2]} · Essay {info.row[3]} · Alt {info.row[4]}
                      <br />
                      <b style={{ color: H.ink }}>Total {info.row[5]}/{info.row[6]} ({info.row[7]}%)</b>
                    </div>
                  ) : (
                    <div className="hf-mono" style={{ marginTop: 6, fontSize: 11, color: H.ink3 }}>
                      {info.row ? `${info.row.slice(2).filter((v) => v !== "·" && v !== 0 && v != null).length} scored / ${info.row.length - 2} items` : ""}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** One expandable stage: header (label · counts · drop) → Input · Transformation · Output. */
function StagePanel({
  index,
  stageLabel,
  transform,
  operatesOn,
  source,
  count,
  open,
  onToggle,
  inputTable,
  inputLabel,
  inputProvenance,
  outputTable,
  drillId,
}: {
  index: number;
  stageLabel: string;
  transform: string;
  operatesOn: string;
  source: string;
  count: DataFlowSubject["counts"][DataFlowStageKey];
  open: boolean;
  onToggle: () => void;
  inputTable: DataFlowTable | null;
  inputLabel: string;
  inputProvenance: import("@/lib/data/data-flow").DataFlowModel["ingest"];
  outputTable: DataFlowTable;
  drillId: string | null;
}) {
  return (
    <Card style={{ padding: 0, overflow: "hidden", borderColor: count.participantDrop ? H.pink : undefined }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: open ? H.canvas : H.paper,
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span className="hf-mono" style={{ width: 20, height: 20, borderRadius: 6, background: H.tint2, color: H.ink2, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
          {index + 1}
        </span>
        <span className="hf-h2" style={{ fontSize: 14 }}>{stageLabel}</span>
        <span className="hf-mono" style={{ fontSize: 12, color: H.ink2 }}>
          {count.participants} participants · {count.items} items
        </span>
        {count.participantDrop && count.prevParticipants != null && (
          <Badge tone="bad">▼ {count.prevParticipants} → {count.participants}</Badge>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <Icon name="chev" size={13} color={H.ink3} />
        </span>
      </button>

      {open && (
        <div style={{ padding: "6px 16px 16px", display: "flex", flexDirection: "column", gap: 14, borderTop: `1px solid ${H.line2}` }}>
          {/* Transformation */}
          <div style={{ background: H.canvas, borderRadius: 8, padding: "10px 12px" }}>
            <span className="hf-lbl">Transformation</span>
            <div style={{ fontSize: 12.5, color: H.ink, marginTop: 4, lineHeight: 1.5 }}>{transform}</div>
            <div className="hf-mono" style={{ fontSize: 11, color: H.ink2, marginTop: 6 }}>{operatesOn}</div>
            <div className="hf-sub" style={{ fontSize: 10.5, marginTop: 4 }}>source · {source}</div>
          </div>

          {/* Input */}
          <div>
            <span className="hf-lbl">Input — {inputLabel}</span>
            {inputTable ? (
              <MatrixTable table={inputTable} drillId={drillId} />
            ) : inputProvenance ? (
              <div style={{ marginTop: 6, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: H.ink2 }}>
                <Provenance label="Raw rows" value={inputProvenance.rawRows} />
                <Provenance label="MCQ rows kept" value={inputProvenance.mcqRows} />
                <Provenance label="Survey rows dropped" value={inputProvenance.droppedSurveyRows} />
                <Provenance label="Non-MCQ dropped" value={inputProvenance.droppedNonMcqRows} />
                <Provenance label="Participants" value={inputProvenance.participants} />
                <Provenance label="Items" value={inputProvenance.items} />
              </div>
            ) : (
              <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 6 }}>No upstream table.</div>
            )}
          </div>

          {/* Output */}
          <div>
            <span className="hf-lbl">Output — {stageLabel}</span>
            <MatrixTable table={outputTable} drillId={drillId} />
          </div>
        </div>
      )}
    </Card>
  );
}

function Provenance({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column" }}>
      <span className="hf-mono" style={{ fontSize: 15, fontWeight: 700, color: H.ink }}>{value.toLocaleString()}</span>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{label}</span>
    </span>
  );
}

/**
 * A stage artifact table (the actual rows), striking excluded rows and highlighting
 * the drilled participant. Rows are capped for display; the count is stated.
 */
function MatrixTable({ table, drillId }: { table: DataFlowTable; drillId: string | null }) {
  const CAP = 60;
  const struck = new Set(table.struckRows);
  const rows = table.rows.slice(0, CAP);
  return (
    <div style={{ marginTop: 6 }}>
      {table.note && <div className="hf-sub" style={{ fontSize: 10.5, marginBottom: 5 }}>{table.note}</div>}
      <div style={{ overflow: "auto", border: `1px solid ${H.line2}`, borderRadius: 8, maxHeight: 340 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11.5, minWidth: "100%" }}>
          <thead>
            <tr style={{ background: H.canvas }}>
              {table.headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    position: i < 2 ? "sticky" : undefined,
                    left: i < 2 ? 0 : undefined,
                    background: H.canvas,
                    textAlign: i < 2 ? "left" : "center",
                    padding: "6px 9px",
                    borderBottom: `1px solid ${H.line2}`,
                    color: H.ink2,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isStruck = struck.has(ri);
              const isDrill = drillId != null && table.participantIds[ri] === drillId;
              const bg = isDrill ? H.pinkSoft : isStruck ? H.badSoft : "transparent";
              return (
                <tr key={ri} style={{ background: bg, borderBottom: `1px solid ${H.line}` }}>
                  {row.map((v, ci) => (
                    <td
                      key={ci}
                      style={{
                        position: ci < 2 ? "sticky" : undefined,
                        left: ci < 2 ? 0 : undefined,
                        background: ci < 2 ? (isDrill ? H.pinkSoft : isStruck ? H.badSoft : H.paper) : undefined,
                        padding: "5px 9px",
                        textAlign: ci < 2 ? "left" : "center",
                        whiteSpace: "nowrap",
                        color: isStruck ? H.bad : ci < 2 ? H.ink : H.ink2,
                        textDecoration: isStruck ? "line-through" : undefined,
                        fontWeight: isDrill && ci < 2 ? 700 : undefined,
                      }}
                      className={ci >= 2 ? "hf-mono" : undefined}
                    >
                      {v == null ? "" : v}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hf-sub" style={{ fontSize: 10.5, marginTop: 4 }}>
        {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
        {table.rows.length > CAP ? ` · showing first ${CAP}` : ""}
      </div>
    </div>
  );
}
