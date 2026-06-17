"use client";

/**
 * Screen 05 — Scoring & grade boundaries (human gate 2). Interactive dual mode:
 * "Set cut-points" (drag/type raw cut-points → live student counts) and
 * "Set distribution" (drag/type target shares → backsolve cut-points). In BOTH
 * modes the histogram handles are draggable AND the right-hand table is an
 * equivalent input — drag a handle OR type in the table; they stay in two-way
 * sync over the same underlying value. What differs is which quantity drives:
 * cut-points sets the raw cut directly; distribution re-targets the share and the
 * existing Wave 3b backsolver settles the handle at the nearest achievable cut.
 * Per assessment the bands are the four performance levels (three cut-points);
 * the Overall scope is the four-band award classification. All counts come from
 * the provider/engine over the real cohort.
 *
 * LAYOUT — a single per-subject screen with the dual-mode toggle top-right and a
 * two-panel working area: the score distribution + draggable cut handles dominate
 * the LEFT (the hero); the cut-score table and the guard-rail / D3 / sanity
 * warning strip sit on the RIGHT. The Wave 3b backsolve
 * is NOT a separate always-on panel — it lives entirely inside "Set distribution"
 * mode, swapping only the right-panel interaction. Switching modes never changes
 * the two-panel layout. When the cycle has no scored data the left card shows a
 * clean placeholder and the right rows are quiet — never bare backsolve controls.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import type { BoundaryModel } from "@/lib/data/types";
import { H } from "@/lib/ui/tokens";
import { AWARD_SHORT } from "@/lib/data/grading";
import { CycleShell, AlertStack } from "@/components/shell/CycleShell";
import { Shell } from "@/components/shell/Shell";
import { useProvisionalNotice } from "@/components/shell/ProvisionalBanner";
import { AssessmentTabs } from "@/components/shell/AssessmentTabs";
import { Button } from "@/components/ui/primitives";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { downloadCsv, downloadWorkbook, fileStem } from "@/lib/ui/export";
import { Icon, Mark } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/infotip";

export default function BoundariesPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const [scope, setScope] = useState<string>("overall");
  const model = useProviderData((p) => p.getBoundaries(cycleId, scope), [cycleId, scope]);
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Cycle";
  const provisional = useProvisionalNotice(cycleId);

  // Pre-fill the draggable cut-score sliders from the Wave 3b backsolved
  // suggestion as the starting point — the suggestion IS the initial slider
  // position, not a separate uneditable list. Runs once per scope (until a
  // suggestion has been adopted) and only when there is scored data to backsolve;
  // the user can then drag/type to change any cut, re-suggest, or reset to the
  // suggestion. No backsolve/guard-rail change — it just adopts the existing
  // suggestion as the editable starting point.
  const needsSuggestion = !!model && !model.locked && model.n > 0 && model.suggestedCuts == null;
  useEffect(() => {
    if (needsSuggestion) provider.setBoundary(cycleId, scope, { suggest: true });
  }, [needsSuggestion, provider, cycleId, scope]);

  if (!model) {
    return (
      <Shell crumb={[{ label: "Cycles", href: "/" }, { label: "Boundaries" }]}>
        <div style={{ padding: 32 }} className="hf-sub">No boundary data for this cycle.</div>
      </Shell>
    );
  }

  // Empty cycle: scores haven't been computed yet. Show a clean placeholder where
  // the histogram goes and quiet band rows on the right — NOT bare backsolve
  // scaffolding (empty target inputs, guard-rail cards) as the main content.
  const isEmpty = model.n === 0;

  const setCut = (index: number, v: number) =>
    provider.setBoundary(cycleId, scope, { cutIndex: index, cutValue: v });
  // "Set distribution" drag: the dragged score position re-targets the band's
  // share; the existing Wave 3b backsolver re-solves and the handle settles at
  // the nearest achievable cut. Same value the table's % column edits.
  const dragTarget = (index: number, v: number) =>
    provider.setBoundary(cycleId, scope, { dragTargetIndex: index, dragScoreValue: v });
  const setMode = (mode: "cuts" | "pct") => provider.setBoundary(cycleId, scope, { mode });
  const setTarget = (index: number, v: number) =>
    provider.setBoundary(cycleId, scope, { targetIndex: index, targetValue: v });
  // Wave 3b — suggestion actions (live only inside "Set distribution").
  const suggest = () => provider.setBoundary(cycleId, scope, { suggest: true });
  const resetAll = () => provider.setBoundary(cycleId, scope, { resetToSuggestion: true });

  // Export every scope's cut-scores (raw + %) and band distribution.
  const gatherScopes = () =>
    model.scopes
      .map((s) => {
        const bm = provider.getBoundaries(cycleId, s.id);
        return bm ? { label: s.label, maxRaw: bm.maxRaw, isAward: bm.isAward, bands: bm.bands } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  const exportBoundariesCsv = () => {
    const headers = ["Scope", "Level", "Stars", "Min Score (%)", "Min Score (raw)", "Students", "% of cohort"];
    const rows = gatherScopes().flatMap((s) =>
      s.bands.map((b) => [s.label, b.level, b.stars ?? "", b.cut ?? "—", b.cut === null ? "—" : Math.round((b.cut / 100) * s.maxRaw), b.students, b.pct]),
    );
    downloadCsv(`${fileStem("cut_scores", cycleName)}.csv`, headers, rows);
    provider.recordExport(cycleId, "Cut-scores & band distribution (CSV)");
  };
  const exportBoundariesXlsx = async () => {
    const exp = await import("@/lib/export");
    const wb = exp.buildBoundariesWorkbook({ cycleName, scopes: gatherScopes() });
    await downloadWorkbook(`${fileStem("cut_scores", cycleName)}.xlsx`, wb);
    provider.recordExport(cycleId, "Cut-scores & band distribution (Excel)");
  };

  const targetSum = model.targets.reduce((a, b) => a + (Number(b) || 0), 0);
  const remainder = 100 - targetSum;
  // Raw cut alongside % (cut-scores are conceptually raw; the model stores %).
  const rawOf = (pct: number) => (model.maxRaw > 0 ? Math.round((pct / 100) * model.maxRaw) : null);

  const seg = (val: "cuts" | "pct", label: string, sub: string) => (
    <button
      onClick={() => setMode(val)}
      style={{
        flex: 1,
        padding: "10px 14px",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        background: model.mode === val ? H.paper : "transparent",
        borderRadius: 8,
        boxShadow: model.mode === val ? "0 1px 3px rgba(44,55,57,.12)" : "none",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, color: model.mode === val ? H.pink : H.ink2 }}>{label}</div>
      <div className="hf-sub" style={{ fontSize: 11, marginTop: 1 }}>{sub}</div>
    </button>
  );

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Scoring & grade boundaries"
      stageIndex={7}
      actions={<ExportButtons onCsv={exportBoundariesCsv} onXlsx={exportBoundariesXlsx} />}
      primary={
        <Link href={`/cycles/${cycleId}/grades`}>
          <Button variant="pri">
            Confirm boundaries
            <Icon name="arrow" color="#fff" />
          </Button>
        </Link>
      }
      alerts={<AlertStack notices={provisional ? [provisional] : []} />}
      subjectTabs={
        <AssessmentTabs
          activeId={scope}
          tabs={model.scopes.map((s) => ({ id: s.id, label: s.label }))}
          onSelect={setScope}
        />
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "24px 32px", gap: 18, flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <div className="hf-h1">{model.isAward ? "Set overall award boundaries" : "Set grade boundaries"}</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 560 }}>
              {isEmpty
                ? "No scored data yet — complete the Score step to set boundaries."
                : model.mode === "cuts"
                  ? `${model.isAward ? "Classify each student's overall score into an award level. " : ""}Drag a handle on the curve, or type a cut score on the right — student counts update as you move.`
                  : "Drag a handle to re-target a band's share, or type the share you want on the right — we backsolve the nearest cut score and the handle settles there."}
            </div>
          </div>
          {/* Dual-mode toggle — only meaningful once there is scored data to work with. */}
          {!isEmpty && (
            <div style={{ display: "flex", alignItems: "center", background: H.tint2, borderRadius: 11, padding: 4, gap: 4, width: 400, flex: "0 0 auto" }}>
              {seg("cuts", "Set cut-points", "Set scores → see counts")}
              {seg("pct", "Set distribution", "Set shares → solve scores")}
              <span style={{ flex: "0 0 auto", paddingRight: 4 }}><CohortPctInfo /></span>
            </div>
          )}
        </div>

        <div className="hf-split" style={{ flex: 1, minHeight: 0 }}>
          {/* chart card — the dominant instrument (the hero, ~58%) */}
          <div className="hf-card" style={{ flex: "1.45 1 0%", padding: "20px 24px 14px", minWidth: 320, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span className="hf-lbl">Score distribution · {model.n} students</span>
              {!isEmpty && (
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: H.pink, fontWeight: 600 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: H.pink }} />
                  {model.mode === "cuts" ? "Drag to set cut score" : "Drag to set share"}
                </span>
              )}
            </div>
            {isEmpty ? (
              <ChartPlaceholder />
            ) : (
              <>
                <BoundaryChart
                  histogram={model.histogram}
                  cuts={model.cuts}
                  bands={model.bands}
                  isAward={model.isAward}
                  draggable={!model.locked}
                  mode={model.mode}
                  onDrag={model.mode === "cuts" ? setCut : dragTarget}
                />
                {/* summary stats — its own non-shrinking strip below the plot, so it is
                    always fully visible and never overlaps the chart */}
                <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 16, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${H.line}`, flexWrap: "wrap" }}>
                  <MiniStat n={`${model.stats.mean}%`} label="cohort mean" />
                  <MiniStat n={String(model.stats.median)} label="median" />
                  <MiniStat n={String(model.stats.sd)} label="σ" />
                  <MiniStat n={String(model.stats.itemsScored)} label="items scored" sub={`${model.stats.excluded} excluded`} />
                </div>
                <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: H.ink3, fontSize: 11.5 }}>
                  <Icon name="arrow" />
                  <span>
                    {model.mode === "cuts"
                      ? "Drag a handle or edit a cut score on the right — counts recompute instantly."
                      : "Drag a handle or edit a share on the right — we backsolve the nearest cut and the handle settles there."}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* table card — the compact companion (~40%). The cut-score table and the
              warning strip live here; the backsolve interaction swaps in only inside
              "Set distribution" mode. Bounded to the viewport height so every level
              stays reachable. */}
          <div className="hf-card" style={{ flex: "1 1 340px", minWidth: 300, maxWidth: 460, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <table className="hf-rows-compact" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th className="hf-th">{model.isAward ? "Award level" : "Band"}</th>
                    <th className="hf-th" style={{ textAlign: "right" }}>
                      Cut-point ≥{!isEmpty && model.mode === "pct" && <span style={{ color: H.pink, marginLeft: 5 }}>auto</span>}
                    </th>
                    <th className="hf-th" style={{ textAlign: "right" }}>Students</th>
                    <th className="hf-th" style={{ textAlign: "right" }}>
                      % of cohort{!isEmpty && model.mode === "cuts" && <span style={{ color: H.pink, marginLeft: 5 }}>auto</span>}
                    </th>
                  </tr>
                </thead>
                <tbody style={isEmpty ? { opacity: 0.55 } : undefined}>
                  {model.bands.map((b, i) => {
                    const isLowest = b.cut === null;
                    return (
                      <tr key={b.level}>
                        <td className="hf-td">
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {b.stars !== null && (
                              <span className="hf-mono" style={{ fontSize: 12, color: H.pink, fontWeight: 700, width: 24, letterSpacing: 1 }}>
                                {b.stars || "·"}
                              </span>
                            )}
                            <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.15 }}>
                              {model.isAward ? AWARD_SHORT[b.level] ?? b.level : b.level}
                            </span>
                          </div>
                        </td>
                        <td className="hf-td" style={{ textAlign: "right" }}>
                          {isEmpty ? (
                            <span className="hf-sub hf-mono">—</span>
                          ) : isLowest ? (
                            <span className="hf-sub hf-mono">remainder</span>
                          ) : model.mode === "cuts" ? (
                            <span style={{ display: "inline-flex", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
                              <CutInput value={b.cut ?? 0} onCommit={(v) => setCut(i, v)} />
                              <span className="hf-sub">%</span>
                              {rawOf(b.cut ?? 0) != null && (
                                <span className="hf-sub" style={{ fontSize: 10 }}>≥{rawOf(b.cut ?? 0)}</span>
                              )}
                            </span>
                          ) : (
                            <span className="hf-mono" style={{ fontWeight: 600 }}>
                              {b.cut}%
                              {rawOf(b.cut ?? 0) != null && (
                                <span className="hf-sub" style={{ fontSize: 10, marginLeft: 4 }}>≥{rawOf(b.cut ?? 0)}</span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600 }}>
                          {isEmpty ? "—" : Math.round(b.students).toLocaleString()}
                        </td>
                        <td className="hf-td" style={{ textAlign: "right" }}>
                          {isEmpty ? (
                            <span className="hf-sub hf-mono">—</span>
                          ) : model.mode === "pct" && !isLowest ? (
                            <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                              <span style={{ display: "inline-flex", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
                                <CutInput value={model.targets[i] ?? 0} width={58} onCommit={(v) => setTarget(i, v)} />
                                <span className="hf-sub">%</span>
                              </span>
                              {/* honest: nearest achievable vs the target above */}
                              <span className="hf-sub" style={{ fontSize: 10, color: b.pct.toFixed(0) === String(model.targets[i]) ? H.ink3 : H.pink }}>
                                ≈ {b.pct.toFixed(1)}% actual
                              </span>
                            </span>
                          ) : (
                            <span className="hf-mono" style={{ color: H.ink2 }}>{b.pct.toFixed(1)}%</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Wave 3b — backsolve controls. Live ONLY inside "Set distribution"
                  (re-suggest) and when an adopted suggestion has been edited in
                  "Set cut-points" (reset). Never a permanent block; a single slim
                  row that swaps with the mode. */}
              {!isEmpty && !model.locked && <BacksolveBar model={model} onSuggest={suggest} onResetAll={resetAll} />}
            </div>

            {/* pinned warning strip — guard-rail / D3 / sanity notices, always at
                the bottom of the bounded column */}
            <div style={{ flex: "0 0 auto", borderTop: `1px solid ${H.line}`, background: H.tint }}>
              {isEmpty ? (
                <div style={{ display: "flex", alignItems: "center", padding: "11px 14px", gap: 9 }}>
                  <Mark kind="warn" size={15} />
                  <span className="hf-sub" style={{ fontSize: 11.5 }}>Boundaries become editable once scores are in.</span>
                </div>
              ) : (
                <WarningStrip model={model} remainder={remainder} />
              )}
            </div>
          </div>
        </div>
      </div>
    </CycleShell>
  );
}

/** Empty-state placeholder where the histogram would go — clean, never a broken chart. */
function ChartPlaceholder() {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 160,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        textAlign: "center",
        border: `1px dashed ${H.line2}`,
        borderRadius: 10,
        background: H.canvas,
        color: H.ink3,
        padding: 24,
      }}
    >
      <div className="hf-mono" style={{ fontSize: 22, color: H.ink3, opacity: 0.6 }}>·····</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: H.ink2 }}>No scored data yet</div>
      <div className="hf-sub" style={{ fontSize: 11.5, maxWidth: 320 }}>
        Complete the Score step to set boundaries — the distribution and cut handles appear here once scores are in.
      </div>
    </div>
  );
}

/**
 * Inline plain-language definition of "Set distribution", reusing the shared InfoTip
 * popover (the same affordance introduced for the Item Quality definition).
 * Accurate to what the mode does post-Wave-3b: it backsolves cut-scores from a
 * target distribution — it is NOT a manual percentage cut.
 */
function CohortPctInfo() {
  return (
    <InfoTip label="What does Set distribution do?" width={300}>
      <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 700, color: H.ink, fontSize: 12, marginBottom: 4 }}>Set distribution</div>
        <p style={{ margin: "0 0 7px" }}>
          Drag a handle or type the target proportion of students you want in each performance level. The app then{" "}
          <b style={{ color: H.ink }}>backsolves the raw cut-scores</b> that would produce that distribution and the
          handle settles at the nearest achievable cut.
        </p>
        <p style={{ margin: 0, color: H.ink3, fontSize: 10.5 }}>
          At this cohort size exact percentages aren’t always achievable, so it shows the nearest achievable result
          next to your target.
        </p>
      </div>
    </InfoTip>
  );
}

/**
 * Slim backsolve control row inside the right panel. Reuses the existing
 * suggest / reset-to-suggestion provider actions — no new maths. In "Fix
 * cohort %" it offers re-suggest (re-run the backsolve from the current target
 * shares and adopt the solved cuts); in "Set cut-points" it offers reset only
 * when the adopted suggestion has actually been edited. It is never a permanent
 * block — one quiet row that swaps with the mode.
 */
function BacksolveBar({
  model,
  onSuggest,
  onResetAll,
}: {
  model: BoundaryModel;
  onSuggest: () => void;
  onResetAll: () => void;
}) {
  const { mode, suggestedCuts, cuts } = model;
  const anyEdited =
    suggestedCuts != null && cuts.some((c, i) => suggestedCuts[i] != null && c !== suggestedCuts[i]);
  const showReset = mode === "cuts" && anyEdited;
  const caption =
    mode === "pct"
      ? "Cut-points solved from your target shares — adopt them to fine-tune by hand."
      : anyEdited
        ? "Edited from the backsolved suggestion."
        : "Showing the backsolved suggestion.";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap",
        padding: "10px 14px",
        borderTop: `1px solid ${H.line}`,
        background: H.canvas,
      }}
    >
      <span className="hf-sub" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 8, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 5px", letterSpacing: 0.5 }}>BACKSOLVED</span>
        {caption}
      </span>
      {mode === "pct" || showReset ? (
        <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
          {mode === "pct" && (
            <Button variant="ghost" onClick={onSuggest}>
              <Icon name="arrow" />
              {suggestedCuts ? "Re-suggest" : "Use as boundaries"}
            </Button>
          )}
          {showReset && (
            <Button variant="ghost" onClick={onResetAll}>
              Reset to suggestion
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Bottom warning strip on the right panel — guard-rail / D3 / sanity notices,
 * stacked. Mode-aware: "Set distribution" surfaces the remainder note and any
 * guard-rail clamp the backsolver applied; "Set cut-points" surfaces any cut
 * deliberately set outside the policy band. The ½-D3 cohort check is shown in both
 * modes against the effective Outstanding cut. No new maths — every notice reads
 * from the existing model.
 */
function WarningStrip({
  model,
  remainder,
}: {
  model: BoundaryModel;
  remainder: number;
}) {
  const { mode, isAward, levels, guardrails } = model;
  const levelLabel = (i: number) => {
    const lvl = levels[i] ?? `Cut ${i + 1}`;
    return isAward ? AWARD_SHORT[lvl] ?? lvl : lvl;
  };
  const notices: { kind: "pass" | "warn" | "fail"; text: string }[] = [];

  if (mode === "pct") {
    if (remainder < 0) {
      notices.push({ kind: "fail", text: `Targets exceed 100%. Reduce a band — the lowest is currently ${remainder}%.` });
    } else {
      notices.push({ kind: "warn", text: `The lowest band takes the remainder (${remainder}%). Scores are discrete, so achieved % can differ slightly from target.` });
    }
    // Guard-rail clamps applied by the backsolver to the solved cuts.
    for (const pc of model.suggestion.perCut) {
      if (!pc.clamp) continue;
      const lbl = levelLabel(pc.index);
      notices.push({
        kind: "warn",
        text:
          pc.clamp.bound === "floor"
            ? `${lbl}: solved ${pc.clamp.from}% raised to ${pc.clamp.to}% (policy floor).`
            : pc.clamp.bound === "ceiling"
              ? `${lbl}: solved ${pc.clamp.from}% lowered to ${pc.clamp.to}% (policy ceiling).`
              : `${lbl}: adjusted to ${pc.clamp.to}% to keep levels ordered.`,
      });
    }
  } else {
    if (!isAward) {
      const outside = model.cuts.some((c) => c < guardrails.floorPct || c > guardrails.ceilingPct);
      if (outside) {
        notices.push({
          kind: "warn",
          text: `A cut sits outside the ${guardrails.floorPct}–${guardrails.ceilingPct}% policy band — recorded as a waiver.`,
        });
      }
    }
  }

  // ½-D3 cohort sanity check on the effective Outstanding cut (both modes).
  if (!isAward && model.d3Warning.applicable) {
    const d = model.d3Warning;
    notices.push({
      kind: d.consistent ? "pass" : "warn",
      text: d.consistent
        ? `½-D3 check: all ${d.outstandingCount} student(s) above the Outstanding cut reached ≥ ${d.halfThreshold}/${d.d3Total} D3 items.`
        : `½-D3 check: ${d.belowHalf} of ${d.outstandingCount} student(s) clear the Outstanding cut without ≥ ${d.halfThreshold}/${d.d3Total} D3 items.`,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {notices.map((nt, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", padding: "10px 14px", gap: 9, borderTop: i === 0 ? "none" : `1px solid ${H.line}` }}>
          <Mark kind={nt.kind} size={15} />
          <span className="hf-sub" style={{ fontSize: 11.5, color: nt.kind === "fail" ? H.bad : undefined }}>{nt.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Compact inline summary figure (bold number + small label) for the slim stats row. */
function MiniStat({ n, label, sub }: { n: string; label: string; sub?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap" }}>
      <span className="hf-mono" style={{ fontSize: 15, fontWeight: 700, color: H.ink, lineHeight: 1 }}>{n}</span>
      <span className="hf-lbl" style={{ fontSize: 9 }}>{label}</span>
      {sub && <span className="hf-sub" style={{ fontSize: 10, color: H.ink3 }}>· {sub}</span>}
    </span>
  );
}

function CutInput({ value, width = 74, onCommit }: { value: number; width?: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="hf-input"
      style={{ width }}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={() => {
        if (draft !== null && draft !== "") onCommit(Number(draft));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      inputMode="numeric"
    />
  );
}

function BoundaryChart({
  histogram,
  cuts,
  bands,
  isAward,
  draggable,
  mode,
  onDrag,
}: {
  histogram: number[];
  cuts: number[];
  bands: { level: string; stars: string | null }[];
  isAward: boolean;
  draggable: boolean;
  mode: "cuts" | "pct";
  onDrag: (index: number, v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...histogram);
  const last = bands.length - 1;
  // band i (top→bottom): from = cuts[i] (or 0 if lowest), to = cuts[i-1] (or 100 if top)
  const regions = bands.map((b, i) => ({
    level: b.level,
    label: isAward ? (AWARD_SHORT[b.level] ?? b.level) : b.stars || "—",
    from: i === last ? 0 : cuts[i] ?? 0,
    to: i === 0 ? 100 : cuts[i - 1] ?? 100,
    opacity: i % 2 === 0 ? 0.06 : 0.02,
  }));

  const startDrag = (index: number) => (e: React.PointerEvent) => {
    if (!draggable || !ref.current) return;
    e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      let v = Math.round(((ev.clientX - rect.left) / rect.width) * 100);
      v = Math.max(0, Math.min(100, v));
      onDrag(index, v);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  return (
    // overflow:hidden guarantees the plot (bars + handles) can never paint
    // outside its own region — so it can never overlap the stats row beneath it.
    <div style={{ userSelect: "none", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* band-label row ABOVE the plot — a clean strip, clear of the bars/handles */}
      <div style={{ position: "relative", height: 18, marginBottom: 8, flex: "0 0 auto" }}>
        {regions.map((r) => (
          <div
            key={r.level + "l"}
            title={r.level}
            style={{
              position: "absolute",
              top: 0,
              left: `${r.from}%`,
              width: `${r.to - r.from}%`,
              padding: "0 2px",
              textAlign: "center",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              fontSize: isAward ? 9.5 : 11.5,
              color: H.ink2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {r.label}
          </div>
        ))}
      </div>
      {/* plot area — the ONLY region bars + handles draw in; clipped so nothing
          extends below into the stats row */}
      <div ref={ref} style={{ position: "relative", flex: 1, minHeight: 120, overflow: "hidden", userSelect: "none" }}>
        {regions.map((r) => (
          <div key={r.level} style={{ position: "absolute", top: 0, bottom: 22, left: `${r.from}%`, width: `${r.to - r.from}%`, background: H.slate, opacity: r.opacity }} />
        ))}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, top: 0, display: "flex", alignItems: "flex-end", gap: 1 }}>
        {histogram.map((v, i) => (
          <div key={i} style={{ flex: 1, height: `${(v / max) * 92}%`, background: "#dde4ea", borderRadius: "2px 2px 0 0" }} />
        ))}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, height: 1.5, background: H.line2 }} />
      {cuts.map((cut, i) => (
        <div key={i} style={{ position: "absolute", top: 0, bottom: 22, left: `${cut}%`, width: 0 }}>
          <div style={{ position: "absolute", top: 0, bottom: 0, borderLeft: `2px dashed ${H.pink}` }} />
          <div
            onPointerDown={startDrag(i)}
            title={
              !draggable
                ? "Locked"
                : mode === "cuts"
                  ? "Drag to set the raw cut score"
                  : "Drag to re-target this band's share — settles at the nearest achievable cut"
            }
            style={{
              position: "absolute",
              top: -2,
              left: -15,
              width: 30,
              height: 20,
              borderRadius: 6,
              background: draggable ? H.pink : H.paper,
              border: `2px solid ${H.pink}`,
              color: draggable ? "#fff" : H.pink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
              cursor: draggable ? "ew-resize" : "default",
              boxShadow: "0 2px 6px rgba(193,44,104,.3)",
            }}
          >
            {cut}
          </div>
        </div>
      ))}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", justifyContent: "space-between" }}>
          {["0%", "25%", "50%", "75%", "100%"].map((t) => (
            <span key={t} className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
