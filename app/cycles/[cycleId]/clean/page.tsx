"use client";

/**
 * Screen 02 — Clean data. The cleaning surface: staff/test/invalid results are
 * soft-deleted (struck through, not destroyed) before scoring, with the impact of
 * every removal visible in real time.
 *
 * Layout:
 *   - a prominent, live BEFORE → AFTER "cleaning impact" panel pinned at the top
 *     (Participants / Records / per-subject / per-element), recomputed on every
 *     soft-delete, restore and undo;
 *   - a "Clean" sub-tab: the per-subject participant/result table where rows are
 *     soft-deleted (strike-through) + restored + undone, plus the validation report;
 *   - a "Summary" sub-tab: fuller before-vs-after summary statistics (scored exams
 *     only, engine scored denominator) — no per-row data.
 *
 * Soft-delete writes through the prompt-09 `excludeParticipantFromCohort` mechanism
 * (keyed on the participant's stable id), so a removal propagates to Scores/Grades
 * and survives re-import. The raw file is never touched — removals are a recorded,
 * reversible decision. The question-level cleaned stats table now lives in Question
 * Review (03a) and is no longer shown here.
 */
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { AssessmentTabs } from "@/components/shell/AssessmentTabs";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark, type MarkKind } from "@/components/ui/icons";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";
import { RawSpreadsheet } from "@/components/cycle/RawSpreadsheet";
import { StepIntro } from "@/components/ui/StepIntro";
import { MetricStrip, type MetricDatum } from "@/components/ui/MetricStrip";
import { downloadWorkbook, fileStem } from "@/lib/ui/export";
import type {
  RawDataModel,
  CleaningImpactModel,
  CleaningImpactSubject,
  CleaningSummaryModel,
  CleaningSummarySubject,
} from "@/lib/data/types";

/**
 * A cleaning write is scoped: "subject" removes a single sitting ((participant,
 * this subject)) via the per-subject clean-removal; "cohort" removes the
 * participant from EVERY subject. One queued action may carry ops of both scopes
 * (e.g. "Restore selected" over a mixed selection) and is reversed as a unit.
 */
type CleanScope = "subject" | "cohort";
type CleanOp = { scope: CleanScope; ids: string[]; assessmentId?: string };
type CleanAction = { kind: "remove" | "restore"; ops: CleanOp[] };

/** Sentinel tab id for the cross-subject "Overall" (global) view. */
const OVERALL = "__overall__";

/** useSearchParams() (for the `?tab=` deep-link) needs a Suspense boundary in the
 *  App Router — wrap the client page so `next build` can statically render it. */
export default function CleanPage({ params }: { params: { cycleId: string } }) {
  return (
    <Suspense fallback={null}>
      <CleanPageInner params={params} />
    </Suspense>
  );
}

function CleanPageInner({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";
  const first = useProviderData((p) => p.getCycle(cycleId)?.assessments[0]?.id, [cycleId]);
  // The selected tab: "Overall" (global view) or a subject id. Overall is first,
  // but a `?tab=<assessmentId>` deep-link opens straight on that subject.
  const searchParams = useSearchParams();
  const [scope, setScope] = useState<string>(searchParams?.get("tab") || OVERALL);
  const isOverall = scope === OVERALL;
  // On the Overall tab there is no per-subject model; we still resolve the first
  // assessment id so the shell renders (its per-row model is simply unused there).
  const assessmentId = isOverall ? (first ?? "") : scope;
  const model = useProviderData((p) => (assessmentId ? p.getDataCleaning(cycleId, assessmentId) : null), [cycleId, assessmentId]);
  const raw = useProviderData((p) => (assessmentId ? p.getRawData(cycleId, assessmentId) : null), [cycleId, assessmentId]);
  // Live cleaning-impact figures — cohort-wide (Overall) plus per-subject slices.
  const impact = useProviderData((p) => p.getCleaningImpact(cycleId), [cycleId]);
  const summary = useProviderData((p) => p.getCleaningSummary(cycleId), [cycleId]);
  const { zoom, setZoom, scrollRef, zoomWrapStyle } = useTableZoom();

  // Local, session-scoped selection + undo stack (the exclusion state itself lives
  // in the provider and persists; the stack only lets us reverse the last action).
  const [selRows, setSelRows] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<CleanAction[]>([]);
  // Collapsible detail panels folded into the merged metrics strip: the subject's
  // per-element / per-status breakdown, and the raw-data items breakdown.
  const [detailOpen, setDetailOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // Struck rows, split by scope. `excludedRows` is the union (what the table
  // strikes); `subjectExcluded` are removed from THIS subject only, `cohortExcluded`
  // from every subject. The split lets Restore reverse each row in its own scope.
  const excludedRows = useMemo(() => new Set(model?.excludedRows ?? []), [model]);
  const subjectExcluded = useMemo(() => new Set(model?.subjectExcludedRows ?? []), [model]);
  const cohortExcluded = useMemo(() => new Set(model?.cohortExcludedRows ?? []), [model]);
  const toggleRow = (id: string) =>
    setSelRows((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSel = () => setSelRows(new Set());

  const selectedActive = [...selRows].filter((id) => !excludedRows.has(id));
  const selectedExcluded = [...selRows].filter((id) => excludedRows.has(id));
  const subjectShort = model?.assessment.shortName ?? "this subject";

  // Perform one op (or its reverse). "subject" scope routes through the per-subject
  // clean-removal (keyed on this sitting); "cohort" scope through the whole-cohort
  // exclusion. `remove=false` restores. Every write is non-destructive + reversible.
  const applyOp = (op: CleanOp, remove: boolean) => {
    if (op.ids.length === 0) return;
    if (op.scope === "subject") {
      provider.setCleanRemoval(cycleId, op.assessmentId ?? assessmentId, { rows: op.ids }, remove);
    } else {
      for (const id of op.ids) provider.excludeParticipantFromCohort(cycleId, id, remove, remove ? "Removed from all subjects in cleaning" : undefined);
    }
  };
  const runAction = (action: CleanAction) => {
    const ops = action.ops.filter((o) => o.ids.length > 0);
    if (ops.length === 0) return;
    for (const op of ops) applyOp(op, action.kind === "remove");
    setUndoStack((s) => [...s, { kind: action.kind, ops }]);
    clearSel();
  };

  // Remove the selected participant(s) from THIS subject only — the default, most
  // common scope. Their other subjects are untouched.
  const removeFromSubject = () => {
    if (selectedActive.length === 0) return;
    runAction({ kind: "remove", ops: [{ scope: "subject", ids: selectedActive, assessmentId }] });
  };
  // Remove the selected participant(s) from EVERY subject (staff/test account or a
  // cohort-wide withdrawal) — the explicit, distinct wider scope.
  const removeFromCohort = () => {
    if (selectedActive.length === 0) return;
    runAction({ kind: "remove", ops: [{ scope: "cohort", ids: selectedActive }] });
  };
  // Restore the selected struck row(s), each in the scope it was removed under.
  const restoreSelected = () => {
    if (selectedExcluded.length === 0) return;
    runAction({
      kind: "restore",
      ops: [
        { scope: "subject", ids: selectedExcluded.filter((id) => subjectExcluded.has(id)), assessmentId },
        { scope: "cohort", ids: selectedExcluded.filter((id) => cohortExcluded.has(id)) },
      ],
    });
  };
  // Restore every struck row currently shown for this subject, each in its own scope.
  const restoreAll = () => {
    if (excludedRows.size === 0) return;
    runAction({
      kind: "restore",
      ops: [
        { scope: "subject", ids: [...subjectExcluded], assessmentId },
        { scope: "cohort", ids: [...cohortExcluded] },
      ],
    });
  };
  // Undo the last action (reverse every op in it, in its own scope).
  const undo = () => {
    setUndoStack((s) => {
      const last = s[s.length - 1];
      if (!last) return s;
      const reverse = last.kind === "remove" ? false : true; // undo remove = restore
      for (const op of last.ops) applyOp(op, reverse);
      return s.slice(0, -1);
    });
    clearSel();
  };

  const exportExcel = async () => {
    const ds = provider.getCleanedMasterDataset(cycleId);
    if (!ds) return;
    const { buildCleanedMasterWorkbook } = await import("@/lib/export/cleaned-master");
    const wb = buildCleanedMasterWorkbook(ds.headers, ds.rows);
    await downloadWorkbook(`${fileStem("cleaned_master_dataset", cycleName)}.xlsx`, wb);
    provider.recordExport(cycleId, "Cleaned master dataset (Excel)");
  };

  if (!model) {
    return (
      <CycleShell cycleId={cycleId} cycleName={cycleName} page="Clean data" stageIndex={1}>
        <div style={{ padding: 32 }} className="hf-sub">No data for this sitting.</div>
      </CycleShell>
    );
  }

  const blocked = !model.canProceed;

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Clean data"
      stageIndex={1}
      actions={
        <Button variant="ghost" onClick={exportExcel} title="Export the cleaned master dataset (current post-clean state) to Excel">
          <Icon name="download" />Export to Excel
        </Button>
      }
      primary={
        <Link href={blocked ? "#" : `/cycles/${cycleId}/raw-scores`} tabIndex={blocked ? -1 : undefined}>
          <Button variant="pri" disabled={blocked} title={blocked ? "Resolve the blocker first" : "Clean & continue"}>
            Continue
            <Icon name="arrow" color="#fff" />
          </Button>
        </Link>
      }
      subjectTabs={
        <AssessmentTabs
          activeId={scope}
          tabs={[
            { id: OVERALL, label: "Overall" },
            ...model.assessments.map((a) => ({ id: a.id, label: a.shortName, rtl: a.rtl })),
          ]}
          onSelect={(id) => { setScope(id); clearSel(); }}
          right={isOverall ? undefined : <ZoomControl zoom={zoom} onZoom={setZoom} />}
        />
      }
      intro={
        <StepIntro>
          This step defines who and what counts. We remove staff, test and invalid results and correct
          data-quality issues, because every score, cut point, grade and award downstream is only as trustworthy
          as the cohort and data it is built on. Click a participant row to select it; removed rows are struck
          through (not deleted), stay reversible and logged, and your raw file is never touched.
        </StepIntro>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {isOverall ? (
          /* ── Overall tab: the cross-subject, global view ──────────────────── */
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            {impact && <OverallMetrics model={impact} />}
            <div style={{ flex: 1, padding: "16px 24px", overflow: "auto", minHeight: 0 }}>
              {summary && <SummaryTab model={summary} />}
            </div>
          </div>
        ) : (
          /* ── Subject tab: one merged metrics strip + the cleaning surface ── */
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <SubjectMetrics
              subject={impact?.bySubject.find((s) => s.assessmentId === assessmentId)}
              summary={summary?.subjects.find((s) => s.assessmentId === assessmentId)}
              raw={raw}
              detailOpen={detailOpen}
              onToggleDetail={() => setDetailOpen((v) => !v)}
              breakdownOpen={breakdownOpen}
              onToggleBreakdown={() => setBreakdownOpen((v) => !v)}
            />
            {detailOpen && (
              <SubjectDetail
                subject={impact?.bySubject.find((s) => s.assessmentId === assessmentId)}
                summary={summary?.subjects.find((s) => s.assessmentId === assessmentId)}
              />
            )}
            {breakdownOpen && raw && <RawBreakdown model={raw} />}
            <div style={{ display: "flex", flex: 1, alignItems: "stretch", minHeight: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "12px 24px 16px", gap: 10, minWidth: 0, minHeight: 0 }}>
              {/* selection + soft-delete action bar — attached directly above the table */}
              <div style={{ display: "flex", gap: 10, padding: "9px 15px", borderRadius: 10, background: H.slate, color: H.cream, alignItems: "center", flexWrap: "wrap", flex: "0 0 auto" }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#fff" }}>
                  {selRows.size === 0 ? "Click a participant row to select it" : `${selRows.size} row${selRows.size === 1 ? "" : "s"} selected`}
                </span>
                {excludedRows.size > 0 && <Badge tone="bad">{excludedRows.size} removed</Badge>}
                {excludedRows.size > 0 && (
                  <button type="button" onClick={restoreAll} className="hf-btn ghost" style={{ fontSize: 11, color: H.cream, borderColor: H.slate2 }}>Restore all</button>
                )}
                <div style={{ flex: 1 }} />
                <Button style={{ fontSize: 11.5, background: "transparent", borderColor: H.slate2, color: H.cream }} disabled={selRows.size === 0} onClick={clearSel}>Clear</Button>
                <Button style={{ fontSize: 11.5, background: "transparent", borderColor: H.slate2, color: H.cream }} disabled={undoStack.length === 0} onClick={undo} title="Undo the last remove / restore">
                  <Icon name="refresh" size={12} color={H.cream} />Undo
                </Button>
                <Button style={{ fontSize: 11.5, background: "transparent", borderColor: H.slate2, color: H.cream }} disabled={selectedExcluded.length === 0} onClick={restoreSelected}>
                  Restore selected
                </Button>
                <Button
                  disabled={selectedActive.length === 0}
                  onClick={removeFromCohort}
                  style={{ fontSize: 11.5, background: "transparent", borderColor: H.slate2, color: H.cream }}
                  title="Remove the selected participant(s) from every subject (staff / test / withdrawn)"
                >
                  <Icon name="trash" size={12} color={H.cream} />Remove from all subjects
                </Button>
                <Button variant="danger" disabled={selectedActive.length === 0} onClick={removeFromSubject} style={{ fontSize: 11.5, background: H.paper }} title={`Remove the selected participant(s) from ${subjectShort} only — their other subjects are untouched`}>
                  <Icon name="trash" size={12} color={H.bad} />Remove from {subjectShort}
                </Button>
              </div>

              <RawSpreadsheet
                model={model}
                scrollRef={scrollRef}
                zoomWrapStyle={zoomWrapStyle}
                fill
                rtl={model.assessment.rtl}
                selectable
                selRows={selRows}
                struckRows={excludedRows}
                onToggleRow={toggleRow}
              />
            </div>

            {/* right rail: validation report */}
            <aside style={{ width: 320, flex: "0 0 auto", borderLeft: `1px solid ${H.line2}`, background: H.paper, padding: "18px 18px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="hf-lbl">Validation report</span>
                <div style={{ flex: 1 }} />
                {model.counts.fail > 0 && <Badge tone="bad">{model.counts.fail} must fix</Badge>}
                {model.counts.warn > 0 && <Badge tone="warn">{model.counts.warn} warnings</Badge>}
              </div>
              {model.checks.map((c) => (
                <div key={c.id} className="hf-card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, borderColor: c.status === "fail" ? H.bad : H.line2, background: c.status === "fail" ? H.badSoft : H.paper }}>
                  <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
                    <Mark kind={c.status as MarkKind} size={15} />
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: c.status === "pass" ? 500 : 700 }}>{c.title}</span>
                    {c.count && <span className="hf-mono" style={{ fontSize: 11, color: c.status === "fail" ? H.bad : c.status === "warn" ? H.warn : H.ink3 }}>{c.count}</span>}
                  </div>
                  {c.detail && <div className="hf-sub" style={{ fontSize: 11, paddingLeft: 24 }}>{c.detail}</div>}
                  {c.action && <div style={{ paddingLeft: 24 }}><Button variant={c.status === "fail" ? "pri" : "default"} style={{ fontSize: 11, padding: "5px 11px" }}>{c.action}</Button></div>}
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 10, background: blocked ? H.badSoft : H.goodSoft, alignItems: "center" }}>
                <Mark kind={blocked ? "fail" : "pass"} size={15} />
                <span style={{ fontSize: 11.5, color: H.ink }}>
                  {blocked ? `${model.counts.fail} blocker${model.counts.fail === 1 ? "" : "s"} must be resolved. Warnings are your call.` : "No blockers — warnings are your call. Ready to continue."}
                </span>
              </div>
            </aside>
            </div>
          </div>
        )}
      </div>
    </CycleShell>
  );
}

/** A quiet inline strip toggle (chevron + label), matching the "Show breakdown"
 *  affordance used across the step pages. Label is text (not colour) so the
 *  open/closed state is legible without the accent. */
function StripToggle({ open, onClick, closedLabel, openLabel }: { open: boolean; onClick: () => void; closedLabel: string; openLabel: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="hf-btn ghost"
      style={{ fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
    >
      {open ? openLabel : closedLabel}
      <span style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
        <Icon name="chev" size={12} color={H.ink3} />
      </span>
    </button>
  );
}

/**
 * The single merged metrics strip for a subject tab — replaces the old stacked
 * "cleaning impact" + raw-overview stat blocks. One row of single live values,
 * with a delta token ("was 251") appearing only on the metrics a removal actually
 * changed (Records / Participants / Mean / Median / Std dev); the structural
 * counts (Items / Major elements / Sub-elements / D1·D2·D3) never carry a delta.
 * Participants appears once. "Records excluded" is a quiet inline state, not a
 * card. The two detail toggles ("By element & status", "Show breakdown") sit
 * inline on the right.
 */
function SubjectMetrics({
  subject,
  summary,
  raw,
  detailOpen,
  onToggleDetail,
  breakdownOpen,
  onToggleBreakdown,
}: {
  subject: CleaningImpactSubject | undefined;
  summary: CleaningSummarySubject | undefined;
  raw: RawDataModel | null;
  detailOpen: boolean;
  onToggleDetail: () => void;
  breakdownOpen: boolean;
  onToggleBreakdown: () => void;
}) {
  const metrics: MetricDatum[] = [];
  if (subject) {
    metrics.push({ label: "Records", value: subject.records.after, was: subject.records.before, big: true });
    metrics.push({ label: "Participants", value: subject.participants.after, was: subject.participants.before, big: true });
  }
  if (raw) {
    metrics.push({ label: "Items", value: raw.items });
    metrics.push({ label: "Major elements", value: raw.elementsCount });
    metrics.push({ label: "Sub-elements", value: raw.subElementsCount });
    metrics.push({ label: "D1·D2·D3", value: `${raw.demand.D1}·${raw.demand.D2}·${raw.demand.D3}` });
  }
  if (summary) {
    metrics.push({ label: "Mean %", value: summary.after.mean, was: summary.before.mean, suffix: "%" });
    metrics.push({ label: "Median %", value: summary.after.median, was: summary.before.median, suffix: "%" });
    metrics.push({ label: "Std dev %", value: summary.after.sd, was: summary.before.sd, suffix: "%" });
  }
  const excludedRecords = subject ? subject.records.before - subject.records.after : 0;
  const excludedParticipants = subject ? subject.participants.before - subject.participants.after : 0;
  const hasDetail = (subject?.byElement.length ?? 0) > 0 || (summary?.statusCounts.length ?? 0) > 0;
  const hasBreakdown = !!raw && raw.byElement.length > 0;

  if (metrics.length === 0) {
    return (
      <div style={{ borderBottom: `1px solid ${H.line2}`, background: H.canvas, padding: "12px 24px" }}>
        <span className="hf-sub" style={{ fontSize: 12 }}>No scored records for this subject.</span>
      </div>
    );
  }

  return (
    <MetricStrip
      metrics={metrics}
      note={
        <span style={{ color: excludedRecords ? H.bad : H.ink3, fontWeight: excludedRecords ? 700 : 400 }}>
          {excludedRecords.toLocaleString()} excluded{excludedParticipants ? ` · ${excludedParticipants} participant${excludedParticipants === 1 ? "" : "s"}` : ""}
        </span>
      }
      right={
        <>
          {hasDetail && <StripToggle open={detailOpen} onClick={onToggleDetail} closedLabel="By element & status" openLabel="Hide detail" />}
          {hasBreakdown && <StripToggle open={breakdownOpen} onClick={onToggleBreakdown} closedLabel="Show breakdown" openLabel="Hide breakdown" />}
        </>
      }
    />
  );
}

/**
 * The Overall (cross-subject) metrics strip — cohort participants + total records
 * as single live values with delta-on-change, and a quiet "records excluded"
 * state. The "By subject & element" detail (per-subject / per-element record
 * tables) folds out below on toggle.
 */
function OverallMetrics({ model }: { model: CleaningImpactModel }) {
  const [open, setOpen] = useState(false);
  const metrics: MetricDatum[] = [
    { label: "Participants", value: model.participants.after, was: model.participants.before, big: true },
    { label: "Records (all exams)", value: model.records.after, was: model.records.before, big: true },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <MetricStrip
        metrics={metrics}
        lead={
          <div style={{ display: "flex", flexDirection: "column", paddingRight: 4 }}>
            <span className="hf-h2" style={{ fontSize: 13 }}>Cleaning impact</span>
            <span className="hf-sub" style={{ fontSize: 10 }}>live · single value, delta on change</span>
          </div>
        }
        note={
          <span style={{ color: model.excludedRecords ? H.bad : H.ink3, fontWeight: model.excludedRecords ? 700 : 400 }}>
            {model.excludedRecords.toLocaleString()} excluded{model.excludedParticipants ? ` · ${model.excludedParticipants} participant${model.excludedParticipants === 1 ? "" : "s"}` : ""}
          </span>
        }
        right={<StripToggle open={open} onClick={() => setOpen((v) => !v)} closedLabel="By subject & element" openLabel="Hide detail" />}
      />
      {open && (
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", padding: "12px 24px", borderBottom: `1px solid ${H.line2}`, background: H.paper }}>
          <div style={{ flex: 1, minWidth: 320 }}>
            <span className="hf-lbl">Records per subject</span>
            <DeltaTable rows={model.bySubject.map((s) => ({ key: s.assessmentId, label: s.shortName, before: s.records.before, after: s.records.after }))} />
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <span className="hf-lbl">Records per major element</span>
            <DeltaTable rows={model.byElement.map((e) => ({ key: e.major, label: e.label, before: e.records.before, after: e.records.after }))} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A compact "live value, delta on change" table used inside the collapsible detail
 * panels: one row per item showing the current value and, only when a removal
 * moved it, a muted "was N" token. Never renders the full `before → after` pair.
 */
function DeltaTable({ rows }: { rows: { key: string; label: string; before: number; after: number }[] }) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6, fontSize: 12 }}>
      <tbody>
        {rows.map((r) => {
          const d = r.after - r.before;
          return (
            <tr key={r.key}>
              <td style={{ padding: "3px 8px 3px 0", color: H.ink, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</td>
              <td className="hf-mono" style={{ padding: "3px 6px", textAlign: "right", color: d ? H.pink : H.ink, fontWeight: 600 }}>{r.after.toLocaleString()}</td>
              <td className="hf-mono" style={{ padding: "3px 0 3px 8px", textAlign: "right", color: H.ink3, fontSize: 11, whiteSpace: "nowrap" }}>{d ? `was ${r.before.toLocaleString()}` : "·"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The subject tab's collapsible detail panel (folds out from the "By element &
 * status" toggle on the merged metrics strip): this subject's records per major
 * element and completion by result status, each as a live value with a muted
 * "was N" token only when a removal changed it — never the full before → after
 * pair.
 */
function SubjectDetail({
  subject,
  summary,
}: {
  subject: CleaningImpactSubject | undefined;
  summary: CleaningSummarySubject | undefined;
}) {
  const hasElement = (subject?.byElement.length ?? 0) > 0;
  const hasStatus = (summary?.statusCounts.length ?? 0) > 0;
  if (!hasElement && !hasStatus) return null;
  return (
    <div style={{ display: "flex", gap: 22, flexWrap: "wrap", padding: "12px 24px", borderBottom: `1px solid ${H.line2}`, background: H.paper }}>
      {hasElement && (
        <div style={{ flex: 1, minWidth: 280 }}>
          <span className="hf-lbl">Records per major element</span>
          <DeltaTable rows={subject!.byElement.map((e) => ({ key: e.major, label: e.label, before: e.records.before, after: e.records.after }))} />
        </div>
      )}
      {hasStatus && (
        <div style={{ flex: 1, minWidth: 260 }}>
          <span className="hf-lbl">Completion by result status</span>
          <DeltaTable rows={summary!.statusCounts.map((r) => ({ key: r.status, label: r.status, before: r.before, after: r.after }))} />
        </div>
      )}
    </div>
  );
}

/**
 * The "Summary" sub-tab: fuller before-vs-after summary statistics (no per-row
 * data). Per-subject score distribution (scored exams only, engine scored
 * denominator) and completion counts by ResultStatus.
 */
function SummaryTab({ model }: { model: CleaningSummaryModel }) {
  // One live value; a muted "was N" token only when cleaning moved it — never the
  // full before → after pair.
  const distCell = (before: number, after: number, suffix = "") => {
    const changed = Math.abs(after - before) > 1e-9;
    return (
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, justifyContent: "flex-end" }}>
        <span className="hf-mono" style={{ color: changed ? H.pink : H.ink, fontWeight: 600 }}>{after}{suffix}</span>
        {changed && <span className="hf-mono" style={{ color: H.ink3, fontSize: 11 }}>was {before}{suffix}</span>}
      </span>
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      <div>
        <div className="hf-h2" style={{ fontSize: 16 }}>Summary statistics</div>
        <div className="hf-sub" style={{ fontSize: 12, marginTop: 2 }}>{model.note}</div>
      </div>

      <div>
        <span className="hf-lbl">Score distribution by subject</span>
        <div className="hf-card" style={{ padding: 0, marginTop: 8, overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: H.canvas }}>
                {["Subject", "Students", "Mean %", "Median %", "Std dev"].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 12px", borderBottom: `1px solid ${H.line2}`, fontWeight: 700, color: H.ink2 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.subjects.map((s) => (
                <tr key={s.assessmentId} style={{ borderBottom: `1px solid ${H.line}` }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: H.ink }}>{s.name}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{distCell(s.before.n, s.after.n)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{distCell(s.before.mean, s.after.mean)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{distCell(s.before.median, s.after.median)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{distCell(s.before.sd, s.after.sd)}</td>
                </tr>
              ))}
              {model.subjects.length === 0 && (
                <tr><td colSpan={5} className="hf-sub" style={{ padding: "14px 12px" }}>No scored exams for this sitting.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <span className="hf-lbl">Completion by result status</span>
        <div className="hf-card" style={{ padding: 0, marginTop: 8, overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: H.canvas }}>
                {["Result status", "Sittings"].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 12px", borderBottom: `1px solid ${H.line2}`, fontWeight: 700, color: H.ink2 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.statusCounts.map((r) => (
                <tr key={r.status} style={{ borderBottom: `1px solid ${H.line}` }}>
                  <td style={{ padding: "8px 12px", color: H.ink }}>{r.status}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{distCell(r.before, r.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * The raw-data breakdown panel — folds out from the "Show breakdown" toggle on the
 * merged metrics strip. The summary counts (participants / items / elements /
 * demand split) now live in that strip, so this panel is just the detail: items by
 * major element & sub-element, and items by demand level. Read-only; exactly what
 * was uploaded, before any cleaning.
 */
function RawBreakdown({ model }: { model: RawDataModel }) {
  return (
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", padding: "12px 24px", borderBottom: `1px solid ${H.line2}`, background: H.paper }}>
        <div style={{ flex: 2, minWidth: 280, display: "flex", flexDirection: "column", gap: 9 }}>
          <span className="hf-lbl">Items by major element &amp; sub-element</span>
          {model.byElement.map((el, i) => {
            const max = Math.max(...model.byElement.map((e) => e.items), 1);
            const letter = el.letter ?? String.fromCharCode(65 + i);
            const label = el.label ?? el.major;
            return (
              <div key={el.major} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="hf-mono" style={{ width: 16, height: 16, borderRadius: 5, background: H.tint2, color: H.ink2, fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{letter}</span>
                <span style={{ flex: 1, fontSize: 12, color: H.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${label} — ${el.subs.length} sub-element${el.subs.length === 1 ? "" : "s"}: ${el.subs.join(", ")}`}>
                  {label} <span className="hf-sub" style={{ fontSize: 10.5 }}>· {el.subs.length} sub</span>
                </span>
                <div style={{ width: 90, height: 8, background: H.tint2, borderRadius: 5, flex: "0 0 auto" }}><div style={{ width: `${(el.items / max) * 100}%`, height: "100%", background: H.bar, borderRadius: 5 }} /></div>
                <span className="hf-mono" style={{ width: 22, fontSize: 11.5, textAlign: "right", flex: "0 0 auto" }}>{el.items}</span>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 190, display: "flex", flexDirection: "column", gap: 9, borderLeft: `1px solid ${H.line}`, paddingLeft: 22 }}>
          <span className="hf-lbl">Items by demand level</span>
          {([["D1", model.demand.D1, "Less demanding"], ["D2", model.demand.D2, "Moderately demanding"], ["D3", model.demand.D3, "More demanding"]] as const).map(([d, v, name]) => {
            const dmax = Math.max(model.demand.D1, model.demand.D2, model.demand.D3, 1);
            return (
              <div key={d} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="hf-mono" style={{ fontSize: 11, fontWeight: 700, color: H.ink2, width: 20, flex: "0 0 auto" }}>{d}</span>
                <span style={{ flex: 1, fontSize: 11.5, color: H.ink2, whiteSpace: "nowrap" }}>{name}</span>
                <div style={{ width: 64, height: 8, background: H.tint2, borderRadius: 5, flex: "0 0 auto" }}><div style={{ width: `${(v / dmax) * 100}%`, height: "100%", background: H.bar, borderRadius: 5 }} /></div>
                <span className="hf-mono" style={{ width: 22, fontSize: 11.5, textAlign: "right", flex: "0 0 auto" }}>{v}</span>
              </div>
            );
          })}
        </div>
      </div>
  );
}
