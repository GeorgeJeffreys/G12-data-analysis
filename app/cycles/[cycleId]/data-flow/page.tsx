"use client";

/**
 * Data flow — the pipeline inspector for ONE exam cycle (task 15). A read-only,
 * admin-gated developer view reached from the cycle's top-right nav (alongside
 * Critical Path / Audit log / Diagnostics). Its single job: make participant loss
 * between the four processing stages impossible to miss.
 *
 * Ported faithfully from the provided Claude Design (hfDataFlow.jsx) into the app's
 * stack — same layout, hierarchy, spacing and palette (the app's shared H tokens +
 * hf-* classes; IBM Plex Mono for the figures) — but wired to the cycle's REAL
 * per-stage data (lib/data/data-flow.ts), keyed on the internal participant id. The
 * three states (empty / healthy / collapse) are data-driven conditions on that
 * model, never placeholder or recomputed-correct numbers.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { hasRole } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { Badge, Button, Avatar } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import {
  buildDataFlow,
  DF_STAGES,
  DF_STAGE_INDEX,
  type DataFlowCell,
  type DataFlowModel,
  type DataFlowPerson,
  type DataFlowStageKey,
  type DataFlowSubject,
} from "@/lib/data/data-flow";

// ── transformation copy — the real key each stage operates on (from the code path) ──
const STAGE_TX: Record<DataFlowStageKey, { op: string; key: string }> = {
  ingested: {
    op: "Parse the Questionmark export, keep MCQ rows, and resolve every result to a participant — minting a stable internal id from the collision-free email, never a name/initial/DOB.",
    key: "email → internalParticipantId",
  },
  cleaned: {
    op: "Drop cohort-wide exclusions (staff/test/withdrawn — from the editable per-cohort exclusion list) and any per-subject soft-deleted rows.",
    key: "cohort_exclusions · clean_exclusions",
  },
  matrix: {
    op: "Pivot the cleaned cohort to students × QuestionId, dedupe (student, QuestionId) keeping the last, and fill missing cells with 0.",
    key: "(student, QuestionId)",
  },
  computed: {
    op: "Run the engine over the matrix: sum each student's scores on the retained MCQ items, then add essay marks and alterations → one subject total.",
    key: "(student, assessmentId)",
  },
};

const DF_LABELW = 208;
const DF_NODEW = 108;
const NAMEW = 156;
const IDW = 236;

// ══════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════
export default function DataFlowCyclePage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const router = useRouter();
  const isAdmin = useProviderData((p) => hasRole(p.getCurrentUser?.()?.role ?? "viewer", "admin"));
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";
  const model = useProviderData((p) => buildDataFlow(p, cycleId), [cycleId]);

  // Admin-gated: the whole surface is restricted, not just individual controls.
  useEffect(() => {
    if (!isAdmin) router.replace("/access-denied");
  }, [isAdmin, router]);

  if (!isAdmin) {
    return (
      <CycleShell cycleId={cycleId} cycleName={cycleName} page="Data flow" area="dataflow">
        <div style={{ padding: 32, color: H.ink3, fontSize: 13 }}>Redirecting…</div>
      </CycleShell>
    );
  }

  return (
    <CycleShell cycleId={cycleId} cycleName={cycleName} page="Data flow" area="dataflow">
      {!model || model.state === "empty" ? (
        <EmptyState cycleId={cycleId} />
      ) : (
        <Inspector model={model} />
      )}
    </CycleShell>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// INSPECTOR — the interactive body shared by the healthy and collapse states.
// Both always render the same three sections: the hero flow strip (counts), the
// per-stage DATA TABLE (input → transformation → output — the real rows read from
// the cycle's live artifacts, keyed on the canonical participant id / ResultId /
// QuestionId), and the participant drill. Only the header badge, subtitle and
// summary band differ by state, so the full per-stage tables are reachable on
// every ingested cycle — not only when a collapse is detected.
// ══════════════════════════════════════════════════════════════════════════
function Inspector({ model }: { model: DataFlowModel }) {
  const rows = model.subjects;
  const collapsed = model.state === "collapse";
  const { ingested, cleaned, computed, lost, worstStage, removedByCleaning } = model;
  // Subjects with an UNEXPECTED drop (a cleaned sitter that never scored), not the
  // expected staff removal at Clean.
  const affected = rows.filter((r) => r.counts[2]! < r.counts[1]! || r.counts[3]! < r.counts[2]!).length;

  // Default the selected subject to one with an UNEXPECTED drop when a collapse
  // exists, else the first subject. Default the stage to the worst transition on a
  // collapse, else the source (Ingested) so the raw response matrix shows first.
  const [selSubj, setSelSubj] = useState<string>(
    (collapsed ? rows.find((r) => r.counts[2]! < r.counts[1]! || r.counts[3]! < r.counts[2]!)?.key : undefined) ??
      rows[0]?.key ??
      "",
  );
  const [selStage, setSelStage] = useState<DataFlowStageKey>(collapsed ? "matrix" : "ingested");
  const selRow = rows.find((r) => r.key === selSubj) ?? rows[0]!;

  const stats: { n: string | number; label: string; sub: string; bad?: boolean; good?: boolean; small?: boolean }[] = collapsed
    ? [
        { n: ingested, label: "Participants ingested", sub: `distinct · staff/test incl.` },
        { n: computed, label: "Scores computed", sub: "reached the final stage" },
        { n: `−${lost}`, label: "Lost after Clean", sub: `${cleaned ? Math.round((lost / cleaned) * 100) : 0}% of cleaned · ${affected} subject(s) affected`, bad: true },
        worstStage
          ? { n: worstStage.name, label: "Worst stage", sub: `${worstStage.delta} here (${worstStage.from} → ${worstStage.to})`, bad: true, small: true }
          : { n: "—", label: "Worst stage", sub: "no single stage dominates", small: true },
      ]
    : [
        { n: ingested, label: "Participants ingested", sub: `distinct across ${rows.length} subjects · staff/test incl.` },
        { n: removedByCleaning, label: "Removed at Clean", sub: "staff/test + soft-deletes (expected)" },
        { n: computed, label: "Scores computed", sub: "reached the final stage" },
        { n: lost, label: "Participants lost", sub: lost === 0 ? "no loss after Clean" : "after Clean", good: lost === 0 },
      ];

  return (
    // Plain block scroll container (matches the app's standard page scroll — cf.
    // the Diagnostics / Clean pages): `minHeight: 0` lets it shrink inside the flex
    // Shell, and `overflow: auto` scrolls the natural-height body below. The old
    // `flex: 1` hf-col scroll root squeezed its cards (whose `overflow: hidden`
    // then clipped them), so lower subjects and the stage tables were unreachable.
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div className="hf-col" style={{ padding: "24px 30px", gap: 18 }}>
        {/* header */}
        <div>
          <div className="hf-row" style={{ gap: 11, alignItems: "center", flexWrap: "wrap" }}>
            <div className="hf-h1">Data flow</div>
            <Badge tone="neutral"><Icon name="eye" size={11} color={H.ink2} />Read-only · reflects live data</Badge>
            {collapsed ? (
              <Badge tone="bad"><Mark kind="fail" size={11} />Collapse detected</Badge>
            ) : (
              <Badge tone="good"><Mark kind="pass" size={11} />No unexpected loss</Badge>
            )}
          </div>
          <div className="hf-sub" style={{ marginTop: 7, maxWidth: 760 }}>
            {collapsed ? (
              <>
                What happens to this sitting&apos;s data as it moves through each processing stage. Participants are lost
                between stages{worstStage ? <> — most at the <b style={{ color: H.ink }}>{worstStage.name}</b></> : ""}. Read a
                row across to see where, then open any stage below to inspect its real rows.
              </>
            ) : (
              <>
                What happens to this sitting&apos;s data as it moves through each processing stage.{" "}
                {removedByCleaning > 0
                  ? `${ingested} ingested → ${removedByCleaning} staff/test + soft-deleted removed at Clean → ${cleaned} scored. No participant is lost after Clean.`
                  : "Every subject holds its participant count from Ingested through Computed scores."}{" "}
                Open any stage below to inspect its real rows.
              </>
            )}
          </div>
        </div>

        {/* summary band */}
        <div className="hf-card">
          <div className="hf-row" style={{ alignItems: "stretch", flexWrap: "wrap" }}>
            {stats.map((c, i) => (
              <div key={i} className="hf-col" style={{ flex: 1, minWidth: 150, gap: 4, padding: "16px 22px", borderLeft: i ? `1px solid ${H.line}` : "none" }}>
                <span className="hf-mono" style={{ fontSize: c.small ? 19 : 27, fontWeight: 600, lineHeight: 1, color: c.bad ? H.bad : c.good ? H.good : H.ink }}>{c.n}</span>
                <span className="hf-lbl" style={{ marginTop: 5 }}>{c.label}</span>
                <span className="hf-sub" style={{ fontSize: 11 }}>{c.sub}</span>
              </div>
            ))}
          </div>
        </div>

        {/* HERO — flow strip */}
        <SectionCard
          n="1"
          title="Where did data go"
          sub="Participant count at every stage · click a stage to inspect it, a subject to follow it below"
          right={
            <div className="hf-row" style={{ gap: 14 }}>
              <span className="hf-row" style={{ gap: 6, fontSize: 11, color: H.ink2 }}><span style={{ width: 20, borderTop: `2px solid ${H.line2}` }} />holds</span>
              <span className="hf-row" style={{ gap: 6, fontSize: 11, color: H.bad, fontWeight: 600 }}><span style={{ width: 20, borderTop: `2px dashed ${H.bad}` }} />participants lost</span>
            </div>
          }
        >
          <FlowStrip rows={rows} selSubj={selSubj} onSubj={setSelSubj} selStage={selStage} onStage={setSelStage} totals={model.totals} />
          <div className="hf-sub" style={{ fontSize: 11, marginTop: 12, color: H.ink3 }}>
            Large number = participants at that stage. Items are fixed per subject ({selRow.items} for {selRow.subj}) and hold across every stage — only participants are lost.
          </div>
        </SectionCard>

        {/* STAGE DETAIL — the full per-stage data table for the selected stage + subject */}
        <SectionCard
          n="2"
          title={`Inside a stage — ${DF_STAGES[DF_STAGE_INDEX[selStage]]!.name}`}
          sub={`Input → transformation → output for ${selRow.subj} — the real rows at this step`}
          right={
            <div className="hf-row" style={{ gap: 6, flexWrap: "wrap" }}>
              {DF_STAGES.map((st) => (
                <span key={st.key} className={`hf-chip ${st.key === selStage ? "on" : ""}`} onClick={() => setSelStage(st.key)} style={{ fontSize: 11 }}>{st.name}</span>
              ))}
            </div>
          }
        >
          <StageDetail row={selRow} stage={selStage} />
        </SectionCard>

        {/* PARTICIPANT DRILL */}
        <SectionCard n="3" title="Drill by participant" sub="Follow one test-taker across all four stages — green where present, red where dropped">
          <ParticipantDrill rows={rows} selSubj={selSubj} onSubj={setSelSubj} />
        </SectionCard>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// EMPTY — not yet ingested
// ══════════════════════════════════════════════════════════════════════════
function EmptyState({ cycleId }: { cycleId: string }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div className="hf-col" style={{ padding: "24px 30px", gap: 18 }}>
      <div className="hf-row" style={{ gap: 11, alignItems: "center" }}>
        <div className="hf-h1">Data flow</div>
        <Badge tone="neutral"><Icon name="eye" size={11} color={H.ink2} />Read-only · reflects live data</Badge>
      </div>

      <div className="hf-card" style={{ padding: "40px 30px" }}>
        {/* faint pipeline skeleton */}
        <div className="hf-row" style={{ justifyContent: "center", alignItems: "center", gap: 0, marginBottom: 34, opacity: 0.8 }}>
          {DF_STAGES.map((st, i) => (
            <div key={st.key} className="hf-row" style={{ alignItems: "flex-start" }}>
              <div className="hf-col" style={{ alignItems: "center", gap: 8 }}>
                <div style={{ width: 60, height: 48, borderRadius: 10, border: `1.5px dashed ${H.line2}`, background: `repeating-linear-gradient(135deg, transparent 0 8px, ${H.tint2} 8px 9px)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="hf-mono" style={{ fontSize: 20, color: H.ink3 }}>—</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: H.ink3, whiteSpace: "nowrap" }}>{st.name}</span>
              </div>
              {i < DF_STAGES.length - 1 && <div style={{ width: 70, borderTop: `2px dashed ${H.line2}`, margin: "24px 4px 0" }} />}
            </div>
          ))}
        </div>
        <div className="hf-col" style={{ alignItems: "center", gap: 8, textAlign: "center" }}>
          <span className="hf-h2" style={{ color: H.ink }}>Nothing has entered this pipeline yet</span>
          <span className="hf-sub" style={{ maxWidth: 420 }}>This sitting hasn&apos;t been ingested. Per-stage participant counts and drop detection will appear here as soon as the first upload lands.</span>
          <div className="hf-row" style={{ gap: 10, marginTop: 10 }}>
            <Link href={`/cycles/${cycleId}/import`}><Button variant="pri"><Icon name="upload" color="#fff" />Go to Ingest</Button></Link>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// FLOW STRIP — the hero
// ══════════════════════════════════════════════════════════════════════════
function CountBox({ v, drop }: { v: number; drop: boolean }) {
  return (
    <div style={{ width: 76, height: 48, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: `1.5px solid ${drop ? H.bad : H.line2}`, background: drop ? H.badSoft : H.paper }}>
      <span className="hf-mono" style={{ fontSize: 23, fontWeight: 600, lineHeight: 1, color: drop ? H.bad : H.ink }}>{v}</span>
    </div>
  );
}

function Connector({ delta, header }: { delta: number; header?: boolean }) {
  const drop = delta < 0;
  const col = drop ? H.bad : H.line2;
  return (
    <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", minWidth: 34 }}>
      <div style={{ flex: 1, borderTop: `2px ${drop ? "dashed" : "solid"} ${col}` }} />
      <span style={{ width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: `6px solid ${col}`, flex: "0 0 auto" }} />
      {drop && (
        <span className="hf-mono" style={{ position: "absolute", left: "50%", top: header ? -9 : -10, transform: "translateX(-50%)", fontSize: header ? 11.5 : 11, fontWeight: 700, color: "#fff", background: H.bad, padding: "2px 7px", borderRadius: 999, letterSpacing: "-.2px", boxShadow: "0 1px 2px rgba(192,57,43,.35)" }}>{delta}</span>
      )}
    </div>
  );
}

function FlowStrip({
  rows,
  selSubj,
  onSubj,
  selStage,
  onStage,
  totals: distinctTotals,
}: {
  rows: DataFlowSubject[];
  selSubj: string | null;
  onSubj?: (k: string) => void;
  selStage: DataFlowStageKey | null;
  onStage?: (k: DataFlowStageKey) => void;
  /** Per-stage DISTINCT participant totals (from the model). A participant sitting
   *  several subjects counts once — so the strip's total row reads the real headcount
   *  (18 → 16), not the sum of per-subject rows (which double-counts). */
  totals?: number[];
}) {
  const totals = distinctTotals ?? DF_STAGES.map((_, i) => rows.reduce((a, r) => a + r.counts[i]!, 0));
  return (
    <div className="hf-col" style={{ gap: 0 }}>
      {/* stage header */}
      <div className="hf-row" style={{ alignItems: "flex-start" }}>
        <div style={{ width: DF_LABELW, flex: "0 0 auto" }} />
        {DF_STAGES.map((st, i) => {
          const on = st.key === selStage;
          const tDelta = i > 0 ? totals[i]! - totals[i - 1]! : 0;
          return (
            <div key={st.key} className="hf-row" style={{ alignItems: "flex-start", flex: i < DF_STAGES.length - 1 ? 1 : "0 0 auto" }}>
              <div className="hf-col" style={{ width: DF_NODEW, flex: "0 0 auto", alignItems: "center", gap: 5, cursor: onStage ? "pointer" : "default" }} onClick={() => onStage?.(st.key)}>
                <div style={{ height: 34, display: "flex", alignItems: "center" }}>
                  <span className="hf-mono" style={{ width: 30, height: 30, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", border: `1.5px solid ${on ? H.pink : H.line2}`, background: on ? H.pink : H.paper, color: on ? "#fff" : H.ink2, fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 600, color: on ? H.pink : H.ink, textAlign: "center", whiteSpace: "nowrap" }}>{st.name}</span>
                <span className="hf-col" style={{ alignItems: "center", gap: 1 }}>
                  <span className="hf-mono" style={{ fontSize: 15, fontWeight: 600, color: tDelta < 0 ? H.bad : H.ink2 }}>{totals[i]}</span>
                  <span className="hf-lbl" style={{ fontSize: 8 }}>total</span>
                </span>
              </div>
              {i < DF_STAGES.length - 1 && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 34 }}>
                  <div style={{ height: 34, display: "flex", alignItems: "center" }}><Connector delta={tDelta} header /></div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ height: 1, background: H.line, margin: "14px 0 6px" }} />

      {/* one row per subject */}
      {rows.map((r) => {
        const on = r.key === selSubj;
        const lost = r.counts[0]! - r.counts[r.counts.length - 1]!;
        return (
          <div key={r.key} className="hf-row" style={{ alignItems: "center", padding: "9px 0", borderRadius: 10, background: on ? H.pinkSoft2 : "transparent", cursor: onSubj ? "pointer" : "default", boxShadow: on ? `inset 3px 0 0 ${H.pink}` : "none" }} onClick={() => onSubj?.(r.key)}>
            <div className="hf-col" style={{ width: DF_LABELW, flex: "0 0 auto", gap: 2, paddingLeft: 14 }}>
              <span style={{ fontSize: 13.5, fontWeight: on ? 700 : 600, color: H.ink }} dir={r.rtl ? "rtl" : undefined}>{r.subj}{r.rtl && <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 6 }}>RTL</span>}</span>
              <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink3 }}>{r.items} items{lost > 0 && <span style={{ color: H.bad, fontWeight: 700 }}> · −{lost}</span>}</span>
            </div>
            {r.counts.map((c, i) => (
              <div key={i} className="hf-row" style={{ alignItems: "center", flex: i < r.counts.length - 1 ? 1 : "0 0 auto" }}>
                <div style={{ width: DF_NODEW, flex: "0 0 auto", display: "flex", justifyContent: "center" }}>
                  <CountBox v={c} drop={i > 0 && c < r.counts[i - 1]!} />
                </div>
                {i < r.counts.length - 1 && <Connector delta={r.counts[i + 1]! - c} />}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MATRIX TABLE — the raw response rows for a stage's input / output
// ══════════════════════════════════════════════════════════════════════════
interface MatrixRow { id: string; name: string; email: string; cells: DataFlowCell[]; __drop?: boolean; staff?: boolean; tag?: string }

function MatrixTable({ rows, items, fillZero, maxH = 300 }: { rows: MatrixRow[]; items: number; fillZero?: boolean; maxH?: number }) {
  const thBase: React.CSSProperties = { position: "sticky", top: 0, background: H.tint, zIndex: 3 };
  return (
    <div style={{ border: `1px solid ${H.line2}`, borderRadius: 10, overflow: "auto", maxHeight: maxH, background: H.paper }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12, width: "max-content" }}>
        <thead>
          <tr>
            <th className="hf-th" style={{ ...thBase, left: 0, zIndex: 7, minWidth: NAMEW, width: NAMEW }}>Participant</th>
            <th className="hf-th" style={{ ...thBase, left: NAMEW, zIndex: 7, minWidth: IDW, width: IDW, boxShadow: `2px 0 0 ${H.line2}` }}>Student ID</th>
            {Array.from({ length: items }).map((_, qi) => (
              <th key={qi} className="hf-th" style={{ ...thBase, minWidth: 34, width: 34, textAlign: "center", padding: "9px 4px", color: H.ink3 }}>Q{qi + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const bg = p.staff ? H.tint2 : p.__drop ? H.badSoft : H.paper;
            const nameCol = p.staff ? H.ink3 : p.__drop ? H.bad : H.ink;
            return (
              <tr key={p.id}>
                <td className="hf-td" style={{ position: "sticky", left: 0, zIndex: 2, background: bg, minWidth: NAMEW, width: NAMEW, whiteSpace: "nowrap" }}>
                  <div className="hf-row" style={{ gap: 7, alignItems: "center" }}>
                    {p.__drop && !p.staff && <span style={{ width: 6, height: 6, borderRadius: 999, background: H.bad, flex: "0 0 auto" }} />}
                    <span style={{ fontWeight: 600, color: nameCol, textDecoration: p.staff ? "line-through" : "none" }}>{p.name}</span>
                    {p.staff && <span className="hf-lbl" style={{ fontSize: 8, color: H.ink3 }}>{p.tag}</span>}
                  </div>
                </td>
                <td className="hf-td hf-mono" style={{ position: "sticky", left: NAMEW, zIndex: 2, background: bg, minWidth: IDW, width: IDW, fontSize: 11, color: p.__drop ? H.bad : p.staff ? H.ink3 : H.ink2, whiteSpace: "nowrap", boxShadow: `2px 0 0 ${H.line2}`, textDecoration: p.staff ? "line-through" : "none" }}>{p.email}</td>
                {Array.from({ length: items }).map((_, qi) => {
                  const raw = p.cells[qi] ?? "·";
                  const v: DataFlowCell = fillZero && raw === "·" ? 0 : raw;
                  const col = v === 1 ? H.ink : v === 0 ? H.ink3 : H.line2;
                  return <td key={qi} className="hf-mono" style={{ textAlign: "center", padding: "9px 4px", borderBottom: `1px solid ${H.line}`, background: bg, color: p.staff ? H.ink3 : col, fontWeight: v === 1 ? 600 : 400, fontSize: 11.5 }}>{v}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// STAGE DETAIL — input → transformation → output
// ══════════════════════════════════════════════════════════════════════════
function KeyPill({ children }: { children: React.ReactNode }) {
  return <span className="hf-mono" style={{ fontSize: 12, fontWeight: 600, color: H.pink, background: H.pinkSoft, border: `1px solid ${H.pink}22`, padding: "3px 9px", borderRadius: 7 }}>{children}</span>;
}
function MiniTh({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className="hf-th" style={{ textAlign: right ? "right" : "left", padding: "8px 11px" }}>{children}</th>;
}

const asMatrixRow = (p: DataFlowPerson, drop?: boolean): MatrixRow => ({ id: p.id, name: p.name, email: p.email, cells: p.cells, __drop: drop, staff: p.staff, tag: p.tag });

function StageDetail({ row, stage }: { row: DataFlowSubject; stage: DataFlowStageKey }) {
  const [droppedOnly, setDroppedOnly] = useState(false);
  const tx = STAGE_TX[stage];
  const idx = DF_STAGE_INDEX[stage];
  const people = row.people;
  const inCount = idx === 0 ? row.counts[0]! : row.counts[idx - 1]!;
  const outCount = row.counts[idx]!;
  const delta = outCount - inCount;

  const atStage = (si: number) => people.filter((p) => p.last >= si);
  const inputRows = idx === 0 ? people : atStage(idx - 1);
  const dropped = idx === 0 ? [] : inputRows.filter((p) => p.last < idx);
  const outRows = atStage(idx);

  const callout =
    stage === "matrix"
      ? delta < 0
        ? `${dropped.length} student(s) entered the Score matrix but produced no row — no response rows survived cleaning, so the pivot emitted nothing for them.`
        : "Every cleaned participant produced a matrix row — the pivot dropped no one."
      : stage === "computed"
        ? delta < 0
          ? `${dropped.length} student(s) had a matrix row but no engine score was produced.`
          : "Every matrix row produced a computed subject score."
        : stage === "cleaned"
          ? row.staff.length > 0
            ? `No participants were lost here. ${row.staff.length} staff/test account(s) were removed, but they were never counted as participants.${delta < 0 ? ` ${-delta} soft-deleted row(s) were also dropped.` : ""}`
            : delta < 0
              ? `${-delta} soft-deleted row(s) were removed from the cohort here.`
              : "No participants were lost here."
          : "This is the source stage — rows arrive here and are resolved to participants.";

  // Input display: mark dropped rows; insert staff (struck) at the Cleaned stage.
  const inputBase: MatrixRow[] = inputRows.map((p) => asMatrixRow(p, p.last < idx));
  const withStaff = stage === "cleaned" ? [...inputBase.slice(0, 4), ...row.staff.map((p) => asMatrixRow(p)), ...inputBase.slice(4)] : inputBase;
  const inputDisplay = droppedOnly ? withStaff.filter((p) => p.__drop || p.staff) : withStaff;
  const prevName = idx === 0 ? "raw upload" : DF_STAGES[idx - 1]!.name;
  const removedCount = dropped.length + (stage === "cleaned" ? row.staff.length : 0);
  const hint =
    stage === "matrix" ? " · red rows produced no response and vanish at the pivot"
      : stage === "cleaned" ? " · struck rows are staff/test accounts, excluded cohort-wide"
        : stage === "computed" ? " · red rows produced no engine score" : "";

  return (
    <div className="hf-col" style={{ gap: 16 }}>
      {/* transformation band */}
      <div className="hf-row" style={{ gap: 0, alignItems: "stretch", border: `1px solid ${H.line2}`, borderRadius: 11, overflow: "hidden", background: H.paper, flexWrap: "wrap" }}>
        <div className="hf-col" style={{ flex: 1, minWidth: 280, gap: 8, padding: "15px 18px" }}>
          <span className="hf-lbl">Transformation</span>
          <span style={{ fontSize: 13.5, color: H.ink, lineHeight: 1.5, maxWidth: 620 }}>{tx.op}</span>
          <div className="hf-row" style={{ gap: 9, marginTop: 2, alignItems: "center" }}>
            <span className="hf-lbl" style={{ fontSize: 9.5 }}>Operates on key</span>
            <KeyPill>{tx.key}</KeyPill>
          </div>
        </div>
        <div className="hf-row" style={{ flex: "0 0 auto", alignItems: "center", gap: 16, padding: "0 22px", borderLeft: `1px solid ${H.line}`, background: H.canvas }}>
          <div className="hf-col" style={{ alignItems: "center", gap: 2 }}>
            <span className="hf-mono" style={{ fontSize: 24, fontWeight: 600, color: H.ink }}>{inCount}</span>
            <span className="hf-lbl" style={{ fontSize: 8.5 }}>in</span>
          </div>
          <Icon name="arrow" size={18} color={delta < 0 ? H.bad : H.ink3} />
          <div className="hf-col" style={{ alignItems: "center", gap: 2 }}>
            <span className="hf-mono" style={{ fontSize: 24, fontWeight: 600, color: delta < 0 ? H.bad : H.ink }}>{outCount}</span>
            <span className="hf-lbl" style={{ fontSize: 8.5 }}>out</span>
          </div>
          {delta < 0 && <span className="hf-mono" style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: H.bad, padding: "4px 10px", borderRadius: 999 }}>{delta}</span>}
        </div>
      </div>

      {/* count-mismatch callout */}
      <div className="hf-row" style={{ gap: 10, alignItems: "flex-start", padding: "11px 15px", borderRadius: 10, background: delta < 0 ? H.badSoft : H.goodSoft, border: `1px solid ${delta < 0 ? H.bad + "33" : H.good + "33"}` }}>
        <Mark kind={delta < 0 ? "fail" : "pass"} size={16} />
        <span style={{ fontSize: 12.5, color: delta < 0 ? H.bad : H.good, lineHeight: 1.5, fontWeight: 500 }}>{callout}</span>
      </div>

      {/* INPUT */}
      <div className="hf-col" style={{ gap: 8 }}>
        <div className="hf-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="hf-lbl">Input · {prevName}</span>
          <span className="hf-mono" style={{ fontSize: 11, color: H.ink3 }}>{inCount} participants × {row.items} items</span>
          <div style={{ flex: 1 }} />
          {removedCount > 0 && (
            <span className={`hf-chip ${droppedOnly ? "on" : ""}`} onClick={() => setDroppedOnly((v) => !v)} style={{ fontSize: 10.5 }}>
              Show removed only <span className="hf-mono" style={{ marginLeft: 2 }}>{removedCount}</span>
            </span>
          )}
        </div>
        <MatrixTable rows={inputDisplay} items={row.items} maxH={300} />
        <span className="hf-sub" style={{ fontSize: 10.5, color: H.ink3 }}><span className="hf-mono">1</span> correct · <span className="hf-mono">0</span> incorrect · <span className="hf-mono">·</span> not attempted{hint}</span>
      </div>

      {/* divider */}
      <div className="hf-row" style={{ gap: 12, alignItems: "center", justifyContent: "center" }}>
        <div style={{ flex: 1, borderTop: `1px dashed ${H.line2}` }} />
        <span className="hf-row" style={{ gap: 7, alignItems: "center", fontSize: 11, color: H.ink2, fontWeight: 600, whiteSpace: "nowrap" }}>
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 3v9M4.5 8.5L8 12l3.5-3.5" fill="none" stroke={H.ink3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          transform on <span className="hf-mono" style={{ color: H.pink }}>{tx.key}</span>
        </span>
        <div style={{ flex: 1, borderTop: `1px dashed ${H.line2}` }} />
      </div>

      {/* OUTPUT */}
      <div className="hf-col" style={{ gap: 8 }}>
        <div className="hf-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="hf-lbl">Output · {DF_STAGES[idx]!.name}</span>
          <span className="hf-mono" style={{ fontSize: 11, color: H.ink3 }}>{outCount} participants{stage !== "computed" ? ` × ${row.items} items` : ""}</span>
          <div style={{ flex: 1 }} />
          {delta < 0 ? <Badge tone="bad"><Mark kind="fail" size={10} />{delta} not carried forward</Badge> : <Badge tone="good"><Mark kind="pass" size={10} />no participant loss</Badge>}
        </div>
        {stage === "computed" ? (
          <div style={{ border: `1px solid ${H.line2}`, borderRadius: 10, overflow: "hidden", background: H.paper }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5 }}>
              <thead><tr><MiniTh>Participant</MiniTh><MiniTh>Student ID</MiniTh><MiniTh right>Items attempted</MiniTh><MiniTh right>Raw score</MiniTh></tr></thead>
              <tbody>
                {outRows.map((p) => (
                  <tr key={p.id} className="hf-hover">
                    <td className="hf-td" style={{ padding: "9px 11px", fontWeight: 600, whiteSpace: "nowrap" }}>{p.name}</td>
                    <td className="hf-td hf-mono" style={{ padding: "9px 11px", fontSize: 11, color: H.ink2, whiteSpace: "nowrap" }}>{p.email}</td>
                    <td className="hf-td hf-mono" style={{ padding: "9px 11px", textAlign: "right", color: H.ink }}>{p.att}<span style={{ color: H.ink3 }}>/{p.items}</span></td>
                    <td className="hf-td hf-mono" style={{ padding: "9px 11px", textAlign: "right", fontWeight: 600, color: H.ink }}>{p.score ?? "—"}<span style={{ color: H.ink3, fontWeight: 400 }}>/{p.items}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <MatrixTable rows={outRows.map((p) => asMatrixRow(p))} items={row.items} fillZero={stage === "matrix"} maxH={300} />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PARTICIPANT DRILL — follow one participant across all four stages
// ══════════════════════════════════════════════════════════════════════════
function JourneyDots({ last, big }: { last: number; big?: boolean }) {
  const R = big ? 16 : 12;
  const seg = big ? 108 : 30;
  const dropStage = last + 1;
  return (
    <div className="hf-row" style={{ gap: 0, alignItems: "center" }}>
      {DF_STAGES.map((_, i) => {
        const present = i <= last;
        const isDrop = i === dropStage;
        const dotBorder = present ? H.good : isDrop ? H.bad : H.line2;
        const dotBg = present ? H.good : isDrop ? H.badSoft : H.paper;
        return (
          <div key={i} className="hf-row" style={{ alignItems: "center" }}>
            {i > 0 && <div style={{ width: seg, borderTop: `2px ${i > last ? "dashed" : "solid"} ${i <= last ? H.good : i === dropStage ? H.bad : H.line2}`, flex: "0 0 auto" }} />}
            <span title={DF_STAGES[i]!.name} style={{ width: R, height: R, borderRadius: 999, flex: "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center", border: `2px solid ${dotBorder}`, background: dotBg }}>
              {present && <svg width={R * 0.55} height={R * 0.55} viewBox="0 0 12 12"><path d="M2.5 6.2l2.2 2.2L9.5 3.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              {isDrop && <svg width={R * 0.5} height={R * 0.5} viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke={H.bad} strokeWidth="2.2" strokeLinecap="round" /></svg>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function statusOf(last: number): { label: string; tone: "good" | "bad" } {
  if (last === 3) return { label: "Complete", tone: "good" };
  return { label: `Dropped at ${DF_STAGES[last + 1]!.name}`, tone: "bad" };
}

function ParticipantDrill({ rows, selSubj, onSubj }: { rows: DataFlowSubject[]; selSubj: string; onSubj: (k: string) => void }) {
  const [filter, setFilter] = useState<"all" | "dropped" | "complete">("all");
  const row = rows.find((r) => r.key === selSubj) ?? rows[0]!;
  const people = row.people;
  const featured = people.find((p) => p.last > 0 && p.last < 3) ?? people.find((p) => p.last < 3) ?? people[0];
  const counts = { all: people.length, dropped: people.filter((p) => p.last < 3).length, complete: people.filter((p) => p.last === 3).length };
  const list = people.filter((p) => (filter === "all" ? true : filter === "dropped" ? p.last < 3 : p.last === 3));

  return (
    <div className="hf-col" style={{ gap: 14 }}>
      {/* subject filter */}
      <div className="hf-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="hf-lbl" style={{ marginRight: 2 }}>Follow subject</span>
        {rows.map((r) => (
          <span key={r.key} className={`hf-chip ${r.key === selSubj ? "on" : ""}`} onClick={() => onSubj(r.key)}>{r.subj}</span>
        ))}
      </div>

      {/* featured journey */}
      {featured && (
        <div className="hf-row" style={{ gap: 20, alignItems: "center", padding: "16px 20px", border: `1px solid ${H.line2}`, borderRadius: 12, background: H.canvas, flexWrap: "wrap" }}>
          <Avatar name={featured.name} size={40} />
          <div className="hf-col" style={{ gap: 3, minWidth: 190 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: H.ink }}>{featured.name}</span>
            <span className="hf-mono" style={{ fontSize: 11, color: H.ink2 }}>{featured.email}</span>
          </div>
          <div className="hf-col" style={{ gap: 8, flex: 1, minWidth: 280 }}>
            <JourneyDots last={featured.last} big />
            <div className="hf-row" style={{ gap: 0 }}>
              {DF_STAGES.map((st, i) => (
                <span key={st.key} style={{ width: i === 0 ? 16 : 62, fontSize: 9.5, fontWeight: i <= featured.last ? 600 : 500, letterSpacing: ".2px", color: i <= featured.last ? H.ink2 : i === featured.last + 1 ? H.bad : H.ink3, whiteSpace: "nowrap", flex: "0 0 auto" }}>{st.name}</span>
              ))}
            </div>
          </div>
          <div className="hf-col" style={{ gap: 5, alignItems: "flex-end", flex: "0 0 auto" }}>
            {(() => { const s = statusOf(featured.last); return <Badge tone={s.tone}>{s.tone === "good" ? <Mark kind="pass" size={11} /> : <Mark kind="fail" size={11} />}{s.label}</Badge>; })()}
            <span className="hf-sub" style={{ fontSize: 11, maxWidth: 220, textAlign: "right" }}>
              {featured.last === 3 ? "Present through every stage." : `Present up to ${DF_STAGES[featured.last]!.name}, then vanishes entering ${DF_STAGES[featured.last + 1]!.name}.`}
            </span>
          </div>
        </div>
      )}

      {/* full list */}
      <div className="hf-row" style={{ gap: 8, alignItems: "center" }}>
        <span className="hf-lbl">All participants</span>
        <div style={{ flex: 1 }} />
        {([["all", "All"], ["dropped", "Dropped"], ["complete", "Complete"]] as const).map(([k, lbl]) => (
          <span key={k} className={`hf-chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)} style={{ fontSize: 11 }}>{lbl} <span className="hf-mono" style={{ marginLeft: 2 }}>{counts[k]}</span></span>
        ))}
      </div>
      <div style={{ border: `1px solid ${H.line2}`, borderRadius: 11, overflow: "hidden", background: H.paper }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5 }}>
          <thead><tr>
            <MiniTh>Participant</MiniTh>
            <MiniTh>Email</MiniTh>
            <th className="hf-th" style={{ padding: "8px 11px", textAlign: "center" }}>Journey across stages</th>
            <MiniTh>Outcome</MiniTh>
          </tr></thead>
          <tbody>
            {list.map((p) => {
              const s = statusOf(p.last);
              return (
                <tr key={p.id} className="hf-hover">
                  <td className="hf-td" style={{ padding: "9px 11px", fontWeight: 600, whiteSpace: "nowrap" }}>{p.name}</td>
                  <td className="hf-td hf-mono" style={{ padding: "9px 11px", fontSize: 11, color: H.ink2, whiteSpace: "nowrap" }}>{p.email}</td>
                  <td className="hf-td" style={{ padding: "9px 11px" }}><div className="hf-row" style={{ justifyContent: "center" }}><JourneyDots last={p.last} /></div></td>
                  <td className="hf-td" style={{ padding: "9px 11px" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: s.tone === "good" ? H.good : H.bad }}>{s.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── shared section card ──────────────────────────────────────────────────
function SectionCard({ n, title, sub, right, children }: { n: string; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="hf-card" style={{ overflow: "hidden" }}>
      <div className="hf-row" style={{ padding: "14px 24px", borderBottom: `1px solid ${H.line}`, gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span className="hf-mono" style={{ width: 22, height: 22, borderRadius: 7, background: H.tint2, color: H.ink2, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{n}</span>
        <div className="hf-col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <span className="hf-h2">{title}</span>
          {sub && <span className="hf-sub" style={{ fontSize: 11.5 }}>{sub}</span>}
        </div>
        {right}
      </div>
      <div style={{ padding: "20px 24px" }}>{children}</div>
    </div>
  );
}
