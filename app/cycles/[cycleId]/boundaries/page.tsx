"use client";

/**
 * Screen 05 — Scoring & grade boundaries (human gate 2). Interactive dual mode:
 * "Fix boundaries" (drag/type cut-points → live student counts) and
 * "Fix cohort %" (type target shares → solve cut-points). All counts come from
 * the provider/engine over the real cohort. The cross-cycle comparison is a
 * clearly-labelled mock (no prior cycle exists yet).
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, StatBlock } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";

// MOCK: there is no prior cycle. Cross-cycle comparison is driven by this
// labelled fixture and gated by SHOW_CROSS_CYCLE so it's trivial to switch to
// real data later. Never presented as if it were computed from real history.
const SHOW_CROSS_CYCLE = true;
const MOCK_PRIOR = {
  name: "Jan 2026",
  aCut: 74,
  mix: { A: 11.2, B: 25.1, C: 33.4, D: 18.9, E: 11.4 } as Record<string, number>,
};

const GRADES = ["A", "B", "C", "D", "E"] as const;

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

  const setCut = (g: string, v: number) => provider.setBoundary(cycleId, scope, { cuts: { [g]: v } });
  const setMode = (mode: "cuts" | "pct") => provider.setBoundary(cycleId, scope, { mode });
  const setTarget = (g: string, v: number) => provider.setBoundary(cycleId, scope, { targets: { [g]: v } });

  const eTarget = 100 - (model.targets.A + model.targets.B + model.targets.C + model.targets.D);

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
      <div style={{ display: "flex", flexDirection: "column", padding: "24px 32px", gap: 18, flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="hf-h1">Set grade boundaries</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 560 }}>
              {model.mode === "cuts"
                ? "Drag a cut-point on the curve, or type a score. Student counts update as you move."
                : "Type the share of students you want in each grade. We solve for the nearest cut-points that achieve it."}
            </div>
          </div>
          <div style={{ display: "flex", background: H.tint2, borderRadius: 11, padding: 4, gap: 4, width: 380, flex: "0 0 auto" }}>
            {seg("cuts", "Fix boundaries", "Set scores → see counts")}
            {seg("pct", "Fix cohort %", "Set shares → solve scores")}
          </div>
        </div>

        <div style={{ display: "flex", gap: 20, alignItems: "stretch", flex: 1, minHeight: 0 }}>
          {/* chart card */}
          <div className="hf-card" style={{ flex: 1, padding: "20px 24px 14px", minWidth: 0, display: "flex", flexDirection: "column" }}>
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
            <BoundaryChart histogram={model.histogram} cuts={model.cuts} draggable={model.mode === "cuts"} onDrag={setCut} />
            <div style={{ display: "flex", gap: 30, marginTop: 22, paddingTop: 18, borderTop: `1px solid ${H.line}` }}>
              <StatBlock n={`${model.stats.mean}%`} label="Cohort mean" />
              <StatBlock n={String(model.stats.median)} label="Median" />
              <StatBlock n={String(model.stats.sd)} label="Std. dev (σ)" />
              <StatBlock n={String(model.stats.itemsScored)} label="Items scored" sub={`${model.stats.excluded} excluded`} />
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: "auto", paddingTop: 16, color: H.ink3, alignItems: "center" }}>
              <Icon name="arrow" size={14} color={H.ink3} />
              <span className="hf-sub" style={{ fontSize: 11.5 }}>
                {model.mode === "cuts"
                  ? "Drag a dashed handle or edit a score on the right — everything recomputes instantly."
                  : "Cut-points are placed automatically. Switch to “Fix boundaries” to nudge them by hand."}
              </span>
            </div>
          </div>

          {/* table card */}
          <div className="hf-card" style={{ flex: "0 0 440px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", flex: "0 0 auto" }}>
              <thead>
                <tr>
                  <th className="hf-th">Grade</th>
                  <th className="hf-th" style={{ textAlign: "right" }}>
                    Cut-point ≥{model.mode === "pct" && <span style={{ color: H.pink, marginLeft: 5 }}>auto</span>}
                  </th>
                  <th className="hf-th" style={{ textAlign: "right" }}>Students</th>
                  <th className="hf-th" style={{ textAlign: "right" }}>
                    % of cohort{model.mode === "cuts" && <span style={{ color: H.pink, marginLeft: 5 }}>auto</span>}
                  </th>
                </tr>
              </thead>
              <tbody>
                {model.bands.map((b) => {
                  const isE = b.grade === "E";
                  return (
                    <tr key={b.grade}>
                      <td className="hf-td">
                        <span style={{ width: 27, height: 27, border: `1px solid ${H.line2}`, borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                          {b.grade}
                        </span>
                      </td>
                      <td className="hf-td" style={{ textAlign: "right" }}>
                        {isE ? (
                          <span className="hf-sub hf-mono">below D</span>
                        ) : model.mode === "cuts" ? (
                          <span style={{ display: "inline-flex", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
                            <CutInput value={b.cut ?? 0} onCommit={(v) => setCut(b.grade, v)} />
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
                        {model.mode === "pct" && !isE ? (
                          <span style={{ display: "inline-flex", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
                            <CutInput
                              value={model.targets[b.grade as "A" | "B" | "C" | "D"]}
                              width={58}
                              onCommit={(v) => setTarget(b.grade, v)}
                            />
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

            {SHOW_CROSS_CYCLE && (
              <div style={{ padding: "16px 18px 10px", borderTop: `1px solid ${H.line}` }}>
                <div className="hf-lbl" style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
                  Grade mix vs {MOCK_PRIOR.name}
                  <span style={{ fontSize: 8.5, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 4px", letterSpacing: 0.5 }}>MOCK</span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: 70 }}>
                  {GRADES.map((g) => {
                    const nowPct = model.n ? (model.bands.find((b) => b.grade === g)!.students / model.n) * 100 : 0;
                    const last = MOCK_PRIOR.mix[g]!;
                    const delta = nowPct - last;
                    return (
                      <div key={g} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}>
                        <span className="hf-mono" style={{ fontSize: 9.5, color: Math.abs(delta) < 0.5 ? H.ink3 : H.ink2 }}>
                          {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
                        </span>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 46 }}>
                          <div style={{ width: 12, height: `${Math.max(4, (nowPct / 50) * 100)}%`, background: H.ink2, borderRadius: "2px 2px 0 0" }} />
                          <div style={{ width: 12, height: `${Math.max(4, (last / 50) * 100)}%`, border: `1.5px solid ${H.line2}`, borderBottom: "none", borderRadius: "2px 2px 0 0" }} />
                        </div>
                        <span className="hf-mono" style={{ fontSize: 10, fontWeight: 700 }}>{g}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 12, fontSize: 10.5, color: H.ink3 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: H.ink2 }} />Now
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, border: `1.5px solid ${H.line2}` }} />{MOCK_PRIOR.name} (mock)
                  </span>
                </div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", padding: "11px 14px", gap: 9, borderTop: `1px solid ${H.line}`, background: H.tint, marginTop: "auto" }}>
              {model.mode === "pct" ? (
                eTarget < 0 ? (
                  <>
                    <Mark kind="fail" size={15} />
                    <span style={{ fontSize: 11.5, color: H.bad }}>Targets exceed 100%. Reduce a band — E is currently {eTarget}%.</span>
                  </>
                ) : (
                  <>
                    <Mark kind="warn" size={15} />
                    <span className="hf-sub" style={{ fontSize: 11.5 }}>E takes the remainder ({eTarget}%). Scores are discrete, so achieved % can differ slightly from target.</span>
                  </>
                )
              ) : (
                <>
                  <Mark kind="warn" size={15} />
                  <span className="hf-sub" style={{ fontSize: 11.5 }}>
                    A-cut is {model.cuts.A - MOCK_PRIOR.aCut >= 0 ? "+" : ""}{model.cuts.A - MOCK_PRIOR.aCut} pts vs {MOCK_PRIOR.name} (mock) — confirm intended before continuing.
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
  draggable,
  onDrag,
}: {
  histogram: number[];
  cuts: { A: number; B: number; C: number; D: number };
  draggable: boolean;
  onDrag: (key: string, v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...histogram);
  const BAND_FILL: Record<string, number> = { A: 0.06, B: 0, C: 0.045, D: 0, E: 0.03 };
  const regions = [
    { g: "E", from: 0, to: cuts.D },
    { g: "D", from: cuts.D, to: cuts.C },
    { g: "C", from: cuts.C, to: cuts.B },
    { g: "B", from: cuts.B, to: cuts.A },
    { g: "A", from: cuts.A, to: 100 },
  ];
  const startDrag = (key: string) => (e: React.PointerEvent) => {
    if (!draggable || !ref.current) return;
    e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      let v = Math.round(((ev.clientX - rect.left) / rect.width) * 100);
      v = Math.max(0, Math.min(100, v));
      onDrag(key, v);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  return (
    <div ref={ref} style={{ position: "relative", height: 196, userSelect: "none" }}>
      {regions.map((r) => (
        <div key={r.g} style={{ position: "absolute", top: 0, bottom: 22, left: `${r.from}%`, width: `${r.to - r.from}%`, background: H.slate, opacity: BAND_FILL[r.g] }} />
      ))}
      {regions.map((r) => (
        <div key={r.g + "l"} style={{ position: "absolute", top: 4, left: `${(r.from + r.to) / 2}%`, transform: "translateX(-50%)", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: H.ink2 }}>
          {r.g}
        </div>
      ))}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, top: 0, display: "flex", alignItems: "flex-end", gap: 1 }}>
        {histogram.map((v, i) => (
          <div key={i} style={{ flex: 1, height: `${(v / max) * 92}%`, background: "#dde4ea", borderRadius: "2px 2px 0 0" }} />
        ))}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, height: 1.5, background: H.line2 }} />
      {(["D", "C", "B", "A"] as const).map((k) => (
        <div key={k} style={{ position: "absolute", top: 0, bottom: 22, left: `${cuts[k]}%`, width: 0 }}>
          <div style={{ position: "absolute", top: 0, bottom: 0, borderLeft: `2px dashed ${H.pink}` }} />
          <div
            onPointerDown={startDrag(k)}
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
            {cuts[k]}
          </div>
        </div>
      ))}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", justifyContent: "space-between" }}>
        {["0%", "25%", "50%", "75%", "100%"].map((t) => (
          <span key={t} className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>{t}</span>
        ))}
      </div>
    </div>
  );
}
