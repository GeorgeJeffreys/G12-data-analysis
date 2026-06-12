"use client";

/**
 * Screen 05 — Scoring & grade boundaries (human gate 2). Interactive dual mode:
 * "Fix boundaries" (drag/type cut-points → live student counts) and
 * "Fix cohort %" (type target shares → solve cut-points). Per assessment the
 * bands are the four performance levels (three cut-points); the Overall scope is
 * the four-band award classification. All counts come from the provider/engine
 * over the real cohort. The cross-cycle comparison is a clearly-labelled mock.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { AWARD_SHORT } from "@/lib/data/grading";
import { Shell } from "@/components/shell/Shell";
import { LockBanner } from "@/components/shell/LockBanner";
import { ProvisionalBanner } from "@/components/shell/ProvisionalBanner";
import { Button } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";

// MOCK: there is no prior cycle. Cross-cycle comparison is driven by these
// labelled fixtures and gated by SHOW_CROSS_CYCLE so it's trivial to switch to
// real data later. Never presented as if computed from real history.
const SHOW_CROSS_CYCLE = true;
const MOCK_PRIOR_NAME = "Jan 2026";
const MOCK_PRIOR_TOP_CUT = 74;
const MOCK_PRIOR_MIX_PERFORMANCE = [12, 28, 38, 22]; // % per band, top → bottom
const MOCK_PRIOR_MIX_AWARD = [9, 24, 34, 33];

export default function BoundariesPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const [scope, setScope] = useState<string>("overall");
  const model = useProviderData((p) => p.getBoundaries(cycleId, scope), [cycleId, scope]);

  if (!model) {
    return (
      <Shell crumb={[{ label: "Cycles", href: "/" }, { label: "Boundaries" }]}>
        <div style={{ padding: 32 }} className="hf-sub">No boundary data for this cycle.</div>
      </Shell>
    );
  }

  const setCut = (index: number, v: number) =>
    provider.setBoundary(cycleId, scope, { cutIndex: index, cutValue: v });
  const setMode = (mode: "cuts" | "pct") => provider.setBoundary(cycleId, scope, { mode });
  const setTarget = (index: number, v: number) =>
    provider.setBoundary(cycleId, scope, { targetIndex: index, targetValue: v });

  const targetSum = model.targets.reduce((a, b) => a + (Number(b) || 0), 0);
  const remainder = 100 - targetSum;
  const mockMix = model.isAward ? MOCK_PRIOR_MIX_AWARD : MOCK_PRIOR_MIX_PERFORMANCE;

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
    <Shell
      crumb={[
        { label: "Cycles", href: "/" },
        { label: "May 2026", href: `/cycles/${cycleId}` },
        { label: "Scoring & grade boundaries" },
      ]}
      stageIndex={4}
      cycleId={cycleId}
      actions={
        <div style={{ display: "flex", border: `1px solid ${H.line2}`, borderRadius: 8, overflow: "hidden" }}>
          {model.scopes.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              style={{
                padding: "7px 13px",
                fontSize: 12.5,
                fontWeight: scope === s.id ? 700 : 500,
                background: scope === s.id ? H.pinkSoft : H.paper,
                color: scope === s.id ? H.pink : H.ink2,
                border: "none",
                borderLeft: i > 0 ? `1px solid ${H.line2}` : "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      }
      stageAction={
        <Link href={`/cycles/${cycleId}/grades`}>
          <Button variant="pri">
            Confirm boundaries
            <Icon name="arrow" color="#fff" />
          </Button>
        </Link>
      }
    >
      <LockBanner cycleId={cycleId} />
      <ProvisionalBanner cycleId={cycleId} />
      <div style={{ display: "flex", flexDirection: "column", padding: "24px 32px", gap: 18, flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="hf-h1">{model.isAward ? "Set overall award boundaries" : "Set grade boundaries"}</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 560 }}>
              {model.isAward
                ? "Classify each student's overall score into an award level. "
                : ""}
              {model.mode === "cuts"
                ? "Drag a cut-point on the curve, or type a score. Student counts update as you move."
                : "Type the share of students you want in each level. We solve for the nearest cut-points that achieve it."}
            </div>
          </div>
          <div style={{ display: "flex", background: H.tint2, borderRadius: 11, padding: 4, gap: 4, width: 380, flex: "0 0 auto" }}>
            {seg("cuts", "Fix boundaries", "Set scores → see counts")}
            {seg("pct", "Fix cohort %", "Set shares → solve scores")}
          </div>
        </div>

        <div className="hf-split" style={{ flex: 1, minHeight: 0 }}>
          {/* chart card — the dominant instrument (~two-thirds) */}
          <div className="hf-card" style={{ flex: "2 1 0%", padding: "20px 24px 14px", minWidth: 320, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span className="hf-lbl">Score distribution · {model.n} students</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: model.mode === "cuts" ? H.pink : H.ink3, fontWeight: 600 }}>
                {model.mode === "cuts" ? (
                  <>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: H.pink }} />
                    Handles draggable
                  </>
                ) : (
                  "Handles computed from targets"
                )}
              </span>
            </div>
            <BoundaryChart
              histogram={model.histogram}
              cuts={model.cuts}
              bands={model.bands}
              isAward={model.isAward}
              draggable={model.mode === "cuts"}
              onDrag={setCut}
            />
            {/* compact summary stats — a slim inline row so the chart can be taller */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${H.line}`, flexWrap: "wrap" }}>
              <MiniStat n={`${model.stats.mean}%`} label="cohort mean" />
              <MiniStat n={String(model.stats.median)} label="median" />
              <MiniStat n={String(model.stats.sd)} label="σ" />
              <MiniStat n={String(model.stats.itemsScored)} label="items scored" sub={`${model.stats.excluded} excluded`} />
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: "auto", paddingTop: 12, color: H.ink3, alignItems: "center" }}>
              <Icon name="arrow" size={14} color={H.ink3} />
              <span className="hf-sub" style={{ fontSize: 11.5 }}>
                {model.mode === "cuts"
                  ? "Drag a dashed handle or edit a score on the right — everything recomputes instantly."
                  : "Cut-points are placed automatically. Switch to “Fix boundaries” to nudge them by hand."}
              </span>
            </div>
          </div>

          {/* table card — the compact companion (~one-third) */}
          <div className="hf-card" style={{ flex: "1 1 320px", minWidth: 300, maxWidth: 440, overflow: "auto", display: "flex", flexDirection: "column" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", flex: "0 0 auto" }}>
              <thead>
                <tr>
                  <th className="hf-th">{model.isAward ? "Award level" : "Performance level"}</th>
                  <th className="hf-th" style={{ textAlign: "right" }}>
                    Cut ≥{model.mode === "pct" && <span style={{ color: H.pink, marginLeft: 5 }}>auto</span>}
                  </th>
                  <th className="hf-th" style={{ textAlign: "right" }}>Students</th>
                  <th className="hf-th" style={{ textAlign: "right" }}>
                    % of cohort{model.mode === "cuts" && <span style={{ color: H.pink, marginLeft: 5 }}>auto</span>}
                  </th>
                </tr>
              </thead>
              <tbody>
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
                        {isLowest ? (
                          <span className="hf-sub hf-mono">remainder</span>
                        ) : model.mode === "cuts" ? (
                          <span style={{ display: "inline-flex", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
                            <CutInput value={b.cut ?? 0} onCommit={(v) => setCut(i, v)} />
                            <span className="hf-sub">%</span>
                          </span>
                        ) : (
                          <span className="hf-mono" style={{ fontWeight: 600 }}>{b.cut}%</span>
                        )}
                      </td>
                      <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600 }}>
                        {Math.round(b.students).toLocaleString()}
                      </td>
                      <td className="hf-td" style={{ textAlign: "right" }}>
                        {model.mode === "pct" && !isLowest ? (
                          <span style={{ display: "inline-flex", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
                            <CutInput value={model.targets[i] ?? 0} width={58} onCommit={(v) => setTarget(i, v)} />
                            <span className="hf-sub">%</span>
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

            {/* cross-cycle comparison — compact, under the award table (mock) */}
            {SHOW_CROSS_CYCLE && (
              <MixComparison isAward={model.isAward} bands={model.bands} mockMix={mockMix} priorName={MOCK_PRIOR_NAME} />
            )}

            <div style={{ display: "flex", alignItems: "center", padding: "11px 14px", gap: 9, borderTop: `1px solid ${H.line}`, background: H.tint, marginTop: "auto" }}>
              {model.mode === "pct" ? (
                remainder < 0 ? (
                  <>
                    <Mark kind="fail" size={15} />
                    <span style={{ fontSize: 11.5, color: H.bad }}>Targets exceed 100%. Reduce a band — the lowest is currently {remainder}%.</span>
                  </>
                ) : (
                  <>
                    <Mark kind="warn" size={15} />
                    <span className="hf-sub" style={{ fontSize: 11.5 }}>The lowest band takes the remainder ({remainder}%). Scores are discrete, so achieved % can differ slightly from target.</span>
                  </>
                )
              ) : (
                <>
                  <Mark kind="warn" size={15} />
                  <span className="hf-sub" style={{ fontSize: 11.5 }}>
                    Top cut is {(model.cuts[0] ?? 0) - MOCK_PRIOR_TOP_CUT >= 0 ? "+" : ""}{(model.cuts[0] ?? 0) - MOCK_PRIOR_TOP_CUT} pts vs {MOCK_PRIOR_NAME} (mock) — confirm intended before continuing.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

/**
 * Compact cross-cycle comparison (mock) sitting UNDER the award table on the
 * right — matching design/hfBoundaries.jsx ("Grade mix vs Jan 2026"). Now/prior
 * mini bars per band with the Δ above. Clearly labelled MOCK.
 */
function MixComparison({
  isAward,
  bands,
  mockMix,
  priorName,
}: {
  isAward: boolean;
  bands: { level: string; stars: string | null; pct: number }[];
  mockMix: number[];
  priorName: string;
}) {
  const mixMax = Math.max(5, ...bands.map((b) => b.pct), ...mockMix);
  const PLOT = 46;
  return (
    <div style={{ padding: "14px 16px 10px", borderTop: `1px solid ${H.line}` }}>
      <div className="hf-lbl" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
        {isAward ? "Award" : "Grade"} mix vs {priorName}
        <span style={{ fontSize: 8, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 4px", letterSpacing: 0.5 }}>MOCK</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: 70 }}>
        {bands.map((b, i) => {
          const nowPct = b.pct;
          const last = mockMix[i] ?? 0;
          const delta = nowPct - last;
          const label = isAward ? AWARD_SHORT[b.level] ?? b.level : b.stars || b.level;
          return (
            <div key={b.level} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flex: 1, minWidth: 0 }} title={b.level}>
              <span className="hf-mono" style={{ fontSize: 9.5, color: Math.abs(delta) < 0.5 ? H.ink3 : delta >= 0 ? H.good : H.bad }}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)}</span>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: PLOT }}>
                <div style={{ width: 11, height: Math.max(3, (nowPct / mixMax) * PLOT), background: H.ink2, borderRadius: "2px 2px 0 0" }} />
                <div style={{ width: 11, height: Math.max(3, (last / mixMax) * PLOT), border: `1.5px solid ${H.line2}`, borderBottom: "none", borderRadius: "2px 2px 0 0" }} />
              </div>
              <span className="hf-mono" style={{ fontSize: 9.5, fontWeight: 700, color: H.ink3, maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 11, fontSize: 10.5, color: H.ink3 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: H.ink2 }} />Now</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, border: `1.5px solid ${H.line2}` }} />{priorName} (mock)</span>
      </div>
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
  onDrag,
}: {
  histogram: number[];
  cuts: number[];
  bands: { level: string; stars: string | null }[];
  isAward: boolean;
  draggable: boolean;
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
    <div style={{ userSelect: "none" }}>
      {/* band-label row ABOVE the plot — a clean strip, clear of the bars/handles */}
      <div style={{ position: "relative", height: 18, marginBottom: 8 }}>
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
      <div ref={ref} style={{ position: "relative", height: 230, userSelect: "none" }}>
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
            title={draggable ? "Drag" : "Computed from target %"}
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
