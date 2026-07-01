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
import { downloadWorkbook, fileStem } from "@/lib/ui/export";
import type {
  RawDataModel,
  CleaningImpactModel,
  CleaningImpactStat,
  CleaningImpactSubject,
  CleaningSummaryModel,
  CleaningSummarySubject,
} from "@/lib/data/types";

/** A queued cleaning action, so the last one can be undone. */
type CleanAction = { kind: "remove" | "restore"; ids: string[] };

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

  const excludedRows = useMemo(() => new Set(model?.excludedRows ?? []), [model]);
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

  // Soft-delete: exclude the selected participant(s) from the whole cohort via the
  // prompt-09 mechanism (strike-through + downstream propagation). Non-destructive.
  const removeSelected = () => {
    if (selectedActive.length === 0) return;
    for (const id of selectedActive) provider.excludeParticipantFromCohort(cycleId, id, true, "Removed in cleaning");
    setUndoStack((s) => [...s, { kind: "remove", ids: selectedActive }]);
    clearSel();
  };
  // Restore: put the selected struck-through row(s) back into the cohort.
  const restoreSelected = () => {
    if (selectedExcluded.length === 0) return;
    for (const id of selectedExcluded) provider.excludeParticipantFromCohort(cycleId, id, false);
    setUndoStack((s) => [...s, { kind: "restore", ids: selectedExcluded }]);
    clearSel();
  };
  // Restore every soft-deleted row currently shown for this subject.
  const restoreAll = () => {
    const ids = [...excludedRows];
    if (ids.length === 0) return;
    for (const id of ids) provider.excludeParticipantFromCohort(cycleId, id, false);
    setUndoStack((s) => [...s, { kind: "restore", ids }]);
    clearSel();
  };
  // Undo the last soft-delete / restore (reverse it exactly).
  const undo = () => {
    setUndoStack((s) => {
      const last = s[s.length - 1];
      if (!last) return s;
      const restore = last.kind === "remove"; // undoing a remove = restore
      for (const id of last.ids) provider.excludeParticipantFromCohort(cycleId, id, !restore, restore ? undefined : "Removed in cleaning (redo)");
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
          as the cohort and data it is built on. Removals here are reversible and logged.
        </StepIntro>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {isOverall ? (
          /* ── Overall tab: the cross-subject, global view ──────────────────── */
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            {impact && <ImpactPanel model={impact} />}
            <div style={{ flex: 1, padding: "16px 24px", overflow: "auto", minHeight: 0 }}>
              {summary && <SummaryTab model={summary} />}
            </div>
          </div>
        ) : (
          /* ── Subject tab: this subject's impact + stats + cleaning surface ── */
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            {impact && (
              <SubjectImpactPanel
                subject={impact.bySubject.find((s) => s.assessmentId === assessmentId)}
                summary={summary?.subjects.find((s) => s.assessmentId === assessmentId)}
                fallbackName={model.assessment.shortName}
              />
            )}
            <div style={{ display: "flex", flex: 1, alignItems: "stretch", minHeight: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "16px 24px", gap: 12, minWidth: 0 }}>
              {raw && <RawOverview model={raw} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="hf-h2" style={{ fontSize: 16 }}>Clean data — {model.assessment.shortName}</div>
                <div className="hf-sub" style={{ fontSize: 12, marginTop: 2 }}>
                  Select participant rows and remove staff / test / invalid results. Removed rows are struck through (not deleted) and stay reversible; your raw file is never touched.
                </div>
              </div>

              {/* selection + soft-delete action bar */}
              <div style={{ display: "flex", gap: 10, padding: "9px 15px", borderRadius: 10, background: H.slate, color: H.cream, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#fff" }}>
                  {selRows.size === 0 ? "Click a participant row to select it" : `${selRows.size} row${selRows.size === 1 ? "" : "s"} selected`}
                </span>
                {excludedRows.size > 0 && <Badge tone="bad">{excludedRows.size} removed</Badge>}
                <div style={{ flex: 1 }} />
                <Button style={{ fontSize: 11.5, background: "transparent", borderColor: H.slate2, color: H.cream }} disabled={selRows.size === 0} onClick={clearSel}>Clear</Button>
                <Button style={{ fontSize: 11.5, background: "transparent", borderColor: H.slate2, color: H.cream }} disabled={undoStack.length === 0} onClick={undo} title="Undo the last remove / restore">
                  <Icon name="refresh" size={12} color={H.cream} />Undo
                </Button>
                <Button style={{ fontSize: 11.5, background: "transparent", borderColor: H.slate2, color: H.cream }} disabled={selectedExcluded.length === 0} onClick={restoreSelected}>
                  Restore selected
                </Button>
                <Button variant="danger" disabled={selectedActive.length === 0} onClick={removeSelected} style={{ fontSize: 11.5, background: H.paper }}>
                  <Icon name="trash" size={12} color={H.bad} />Remove selected
                </Button>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="hf-lbl">Participants / results</span>
                {excludedRows.size > 0 && (
                  <button type="button" onClick={restoreAll} className="hf-btn ghost" style={{ fontSize: 11 }}>Restore all removed</button>
                )}
                <div style={{ flex: 1 }} />
                <span className="hf-sub" style={{ fontSize: 11, fontStyle: "italic" }}>struck-through = removed (excluded from scores) · click a row to select</span>
              </div>

              <RawSpreadsheet
                model={model}
                scrollRef={scrollRef}
                zoomWrapStyle={zoomWrapStyle}
                maxHeight={440}
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

/** before → after with the delta highlighted. `suffix` (e.g. "%") is appended to
 *  each figure; when set, the delta line is suppressed (a %-point delta is noise). */
function StatPair({ label, stat, big, suffix }: { label: string; stat: CleaningImpactStat; big?: boolean; suffix?: string }) {
  const delta = stat.after - stat.before;
  const changed = delta !== 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 18px", borderLeft: `1px solid ${H.line}` }}>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="hf-mono" style={{ fontSize: big ? 20 : 15, fontWeight: 600, color: H.ink3 }}>{stat.before.toLocaleString()}{suffix}</span>
        <Icon name="arrow" size={big ? 15 : 12} color={H.ink3} />
        <span className="hf-mono" style={{ fontSize: big ? 20 : 15, fontWeight: 700, color: changed ? H.pink : H.ink }}>{stat.after.toLocaleString()}{suffix}</span>
      </div>
      {changed && !suffix && <span className="hf-mono" style={{ fontSize: 10.5, fontWeight: 700, color: H.pink }}>{delta > 0 ? "+" : ""}{delta.toLocaleString()}</span>}
    </div>
  );
}

/**
 * The subject-scoped counterpart to ImpactPanel, shown at the top of each subject
 * tab. Every figure is THAT subject's own: its records + participants before →
 * after, its records excluded, and (expandable) its per-major-element breakdown,
 * alongside its own summary stats — mean / median / std % and completion by
 * ResultStatus (before → after). No global figures appear here.
 */
function SubjectImpactPanel({
  subject,
  summary,
  fallbackName,
}: {
  subject: CleaningImpactSubject | undefined;
  summary: CleaningSummarySubject | undefined;
  fallbackName: string;
}) {
  const [open, setOpen] = useState(false);
  if (!subject) {
    return (
      <div style={{ borderBottom: `1px solid ${H.line2}`, background: H.canvas, padding: "12px 24px" }}>
        <span className="hf-h2" style={{ fontSize: 14 }}>Cleaning impact — {fallbackName}</span>
        <div className="hf-sub" style={{ fontSize: 11 }}>No scored records for this subject.</div>
      </div>
    );
  }
  const excludedRecords = subject.records.before - subject.records.after;
  const excludedParticipants = subject.participants.before - subject.participants.after;
  const meanStat = summary && { before: summary.before.mean, after: summary.after.mean };
  const medianStat = summary && { before: summary.before.median, after: summary.after.median };
  const sdStat = summary && { before: summary.before.sd, after: summary.after.sd };
  const hasDetail = subject.byElement.length > 0 || (summary?.statusCounts.length ?? 0) > 0;
  return (
    <div style={{ borderBottom: `1px solid ${H.line2}`, background: H.canvas, padding: "12px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", paddingRight: 4 }}>
          <span className="hf-h2" style={{ fontSize: 14 }}>Cleaning impact — {subject.shortName}</span>
          <span className="hf-sub" style={{ fontSize: 10.5 }}>this subject · before → after · live</span>
        </div>
        <StatPair label="Records" stat={subject.records} big />
        <StatPair label="Participants" stat={subject.participants} big />
        <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 18px", borderLeft: `1px solid ${H.line}` }}>
          <span className="hf-lbl" style={{ fontSize: 9.5 }}>Records excluded</span>
          <span className="hf-mono" style={{ fontSize: 20, fontWeight: 700, color: excludedRecords ? H.bad : H.ink }}>
            {excludedRecords.toLocaleString()}
          </span>
          <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink3 }}>{excludedParticipants} participant{excludedParticipants === 1 ? "" : "s"}</span>
        </div>
        {meanStat && <StatPair label="Mean %" stat={meanStat} suffix="%" />}
        {medianStat && <StatPair label="Median %" stat={medianStat} suffix="%" />}
        {sdStat && <StatPair label="Std dev %" stat={sdStat} suffix="%" />}
        <div style={{ flex: 1, minWidth: 12 }} />
        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="hf-btn ghost"
            style={{ fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
          >
            {open ? "Hide detail" : "By element & status"}
            <span style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
              <Icon name="chev" size={12} color={H.ink3} />
            </span>
          </button>
        )}
      </div>

      {open && hasDetail && (
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", paddingTop: 4 }}>
          {subject.byElement.length > 0 && (
            <div style={{ flex: 1, minWidth: 280 }}>
              <span className="hf-lbl">Records per major element (before → after)</span>
              <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6, fontSize: 12 }}>
                <tbody>
                  {subject.byElement.map((e) => {
                    const d = e.records.after - e.records.before;
                    return (
                      <tr key={e.major}>
                        <td style={{ padding: "3px 8px 3px 0", color: H.ink, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.label}>{e.label}</td>
                        <td className="hf-mono" style={{ padding: "3px 6px", textAlign: "right", color: H.ink3 }}>{e.records.before.toLocaleString()}</td>
                        <td style={{ padding: "3px 2px", color: H.ink3 }}>→</td>
                        <td className="hf-mono" style={{ padding: "3px 6px", textAlign: "right", color: d ? H.pink : H.ink, fontWeight: 600 }}>{e.records.after.toLocaleString()}</td>
                        <td className="hf-mono" style={{ padding: "3px 0 3px 8px", textAlign: "right", color: d ? H.bad : H.ink3, fontSize: 11 }}>{d ? d.toLocaleString() : "·"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {summary && summary.statusCounts.length > 0 && (
            <div style={{ flex: 1, minWidth: 260 }}>
              <span className="hf-lbl">Completion by result status (before → after)</span>
              <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6, fontSize: 12 }}>
                <tbody>
                  {summary.statusCounts.map((r) => {
                    const d = r.after - r.before;
                    return (
                      <tr key={r.status}>
                        <td style={{ padding: "3px 8px 3px 0", color: H.ink }}>{r.status}</td>
                        <td className="hf-mono" style={{ padding: "3px 6px", textAlign: "right", color: H.ink3 }}>{r.before.toLocaleString()}</td>
                        <td style={{ padding: "3px 2px", color: H.ink3 }}>→</td>
                        <td className="hf-mono" style={{ padding: "3px 6px", textAlign: "right", color: d ? H.pink : H.ink, fontWeight: 600 }}>{r.after.toLocaleString()}</td>
                        <td className="hf-mono" style={{ padding: "3px 0 3px 8px", textAlign: "right", color: d ? H.bad : H.ink3, fontSize: 11 }}>{d ? d.toLocaleString() : "·"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The prominent, always-visible cleaning-impact panel pinned at the top of Clean.
 * "Before" is the full ingested set; "after" is the set minus currently-excluded
 * rows — both recompute live on every soft-delete / restore / undo.
 */
function ImpactPanel({ model }: { model: CleaningImpactModel }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${H.line2}`, background: H.canvas, padding: "12px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", paddingRight: 4 }}>
          <span className="hf-h2" style={{ fontSize: 14 }}>Cleaning impact</span>
          <span className="hf-sub" style={{ fontSize: 10.5 }}>before → after · live</span>
        </div>
        <StatPair label="Participants" stat={model.participants} big />
        <StatPair label="Records (all exams)" stat={model.records} big />
        <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 18px", borderLeft: `1px solid ${H.line}` }}>
          <span className="hf-lbl" style={{ fontSize: 9.5 }}>Records excluded</span>
          <span className="hf-mono" style={{ fontSize: 20, fontWeight: 700, color: model.excludedRecords ? H.bad : H.ink }}>
            {model.excludedRecords.toLocaleString()}
          </span>
          <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink3 }}>{model.excludedParticipants} participant{model.excludedParticipants === 1 ? "" : "s"}</span>
        </div>
        <div style={{ flex: 1, minWidth: 12 }} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="hf-btn ghost"
          style={{ fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
        >
          {open ? "Hide detail" : "By subject & element"}
          <span style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
            <Icon name="chev" size={12} color={H.ink3} />
          </span>
        </button>
      </div>

      {open && (
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", paddingTop: 4 }}>
          <div style={{ flex: 1, minWidth: 320 }}>
            <span className="hf-lbl">Records per subject (before → after)</span>
            <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6, fontSize: 12 }}>
              <tbody>
                {model.bySubject.map((s) => {
                  const d = s.records.after - s.records.before;
                  return (
                    <tr key={s.assessmentId}>
                      <td style={{ padding: "3px 8px 3px 0", color: H.ink }}>{s.shortName}</td>
                      <td className="hf-mono" style={{ padding: "3px 6px", textAlign: "right", color: H.ink3 }}>{s.records.before.toLocaleString()}</td>
                      <td style={{ padding: "3px 2px", color: H.ink3 }}>→</td>
                      <td className="hf-mono" style={{ padding: "3px 6px", textAlign: "right", color: d ? H.pink : H.ink, fontWeight: 600 }}>{s.records.after.toLocaleString()}</td>
                      <td className="hf-mono" style={{ padding: "3px 0 3px 8px", textAlign: "right", color: d ? H.bad : H.ink3, fontSize: 11 }}>{d ? d.toLocaleString() : "·"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <span className="hf-lbl">Records per major element (before → after)</span>
            <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6, fontSize: 12 }}>
              <tbody>
                {model.byElement.map((e) => {
                  const d = e.records.after - e.records.before;
                  return (
                    <tr key={e.major}>
                      <td style={{ padding: "3px 8px 3px 0", color: H.ink, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.label}>{e.label}</td>
                      <td className="hf-mono" style={{ padding: "3px 6px", textAlign: "right", color: H.ink3 }}>{e.records.before.toLocaleString()}</td>
                      <td style={{ padding: "3px 2px", color: H.ink3 }}>→</td>
                      <td className="hf-mono" style={{ padding: "3px 6px", textAlign: "right", color: d ? H.pink : H.ink, fontWeight: 600 }}>{e.records.after.toLocaleString()}</td>
                      <td className="hf-mono" style={{ padding: "3px 0 3px 8px", textAlign: "right", color: d ? H.bad : H.ink3, fontSize: 11 }}>{d ? d.toLocaleString() : "·"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
  const distCell = (before: number, after: number, suffix = "") => {
    const changed = Math.abs(after - before) > 1e-9;
    return (
      <span>
        <span className="hf-mono" style={{ color: H.ink3 }}>{before}{suffix}</span>
        <span style={{ color: H.ink3 }}> → </span>
        <span className="hf-mono" style={{ color: changed ? H.pink : H.ink, fontWeight: 600 }}>{after}{suffix}</span>
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
        <span className="hf-lbl">Score distribution by subject (before → after cleaning)</span>
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
        <span className="hf-lbl">Completion by result status (before → after cleaning)</span>
        <div className="hf-card" style={{ padding: 0, marginTop: 8, overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: H.canvas }}>
                {["Result status", "Sittings (before → after)"].map((h, i) => (
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
 * Read-only raw-data overview, folded in from the old standalone Raw data step:
 * exactly what was uploaded, before any cleaning — a compact summary band plus the
 * by-element and by-demand breakdowns (collapsed by default).
 */
function RawOverview({ model }: { model: RawDataModel }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const stat = (n: string | number, label: string, accent?: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 16px", borderLeft: `1px solid ${H.line}` }}>
      <span className="hf-mono" style={{ fontSize: String(n).length > 6 ? 15 : 18, fontWeight: 600, color: accent ? H.pink : H.ink }}>{n}</span>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{label}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", border: `1px solid ${H.line2}`, borderRadius: 10, background: H.paper, padding: "9px 0", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 16px" }}>
          <span className="hf-mono" style={{ fontSize: 18, fontWeight: 600 }}>{model.participants}</span>
          <span className="hf-lbl" style={{ fontSize: 9.5 }}>Participants</span>
        </div>
        {stat(model.items, "Items", true)}
        {stat(model.elementsCount, "Major elements")}
        {stat(model.subElementsCount, "Sub-elements")}
        {stat(`${model.demand.D1}·${model.demand.D2}·${model.demand.D3}`, "D1·D2·D3")}
        <div style={{ flex: 1, minWidth: 12 }} />
        <button
          type="button"
          onClick={() => setShowBreakdown((v) => !v)}
          aria-expanded={showBreakdown}
          className="hf-btn ghost"
          style={{ fontSize: 11.5, margin: "0 14px", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
        >
          {showBreakdown ? "Hide breakdown" : "Show breakdown"}
          <span style={{ display: "inline-flex", transform: showBreakdown ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
            <Icon name="chev" size={12} color={H.ink3} />
          </span>
        </button>
      </div>

      {showBreakdown && (
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", padding: "14px 18px", border: `1px solid ${H.line}`, borderRadius: 10, background: H.paper }}>
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
      )}
    </div>
  );
}
