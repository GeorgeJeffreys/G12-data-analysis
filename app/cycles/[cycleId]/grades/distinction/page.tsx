"use client";

/**
 * Screen 06b — Distinction safeguard (sits with the grading / sign-off stage).
 * A Distinction is only awarded when a student actually attempted enough of the
 * hardest questions. Runs on the provisional awards from boundaries; every cap
 * and override is attributed and audit-logged, and only a Lead can override.
 *
 * All numbers are computed from the real seeded cycle — top-difficulty attempted
 * counts come from genuine responses minus any per-student technical exclusions.
 */
import { useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Badge, Avatar, StatBlock } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { AWARD_SHORT } from "@/lib/data/grading";
import type { DistinctionCandidate } from "@/lib/data/types";

export default function DistinctionPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const [scope, setScope] = useState<string | undefined>(undefined);
  const model = useProviderData((p) => p.getDistinctionSafeguard(cycleId, scope), [cycleId, scope]);

  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (!model) {
    return (
      <Shell crumb={[{ label: "Cycles", href: "/" }, { label: "Distinction safeguard" }]}>
        <div style={{ padding: 32 }} className="hf-sub">No grading data for this cycle.</div>
      </Shell>
    );
  }

  const short = (lvl: string) => AWARD_SHORT[lvl] ?? lvl;
  const nCap = model.counts.capped;
  const t = model.threshold;

  const submitOverride = (id: string) => {
    const r = reason.trim();
    if (!r) return;
    provider.overrideDistinctionCap(cycleId, id, r);
    setOverrideFor(null);
    setReason("");
  };

  return (
    <Shell
      active="Cycles"
      crumb={[
        { label: "Cycles", href: "/" },
        { label: "May 2026", href: `/cycles/${cycleId}` },
        { label: "Grades & sign-off", href: `/cycles/${cycleId}/grades` },
        { label: "Distinction safeguard" },
      ]}
      stageIndex={6}
      done={6}
      actions={
        <Link href={`/cycles/${cycleId}/audit`}>
          <Button variant="ghost"><Icon name="doc" />Audit log</Button>
        </Link>
      }
      stageAction={
        <Link href={`/cycles/${cycleId}/grades`}>
          <Button variant="pri" onClick={() => provider.confirmDistinctionCaps(cycleId)}>
            {nCap ? "Confirm caps & continue" : "Confirm & continue"}
            <Icon name="arrow" color="#fff" />
          </Button>
        </Link>
      }
    >
      {/* assessment tabs (top-difficulty questions are per assessment) */}
      <div style={{ display: "flex", flex: "0 0 auto", borderBottom: `1px solid ${H.line}`, padding: "0 24px", gap: 4, background: H.paper }}>
        {model.scopes.map((s) => {
          const on = s.id === model.scope;
          return (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              style={{ padding: "13px 15px", fontSize: 13, fontWeight: on ? 700 : 500, color: on ? H.pink : H.ink2, borderBottom: `3px solid ${on ? H.pink : "transparent"}`, background: "transparent", border: "none", cursor: "pointer" }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: "24px 30px", gap: 18, flex: 1, minHeight: 0 }}>
        <div>
          <div className="hf-h1">Distinction safeguard</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            A Distinction is only awarded when a student actually attempted enough of the hardest questions. This runs on
            the provisional awards from boundaries.
          </div>
        </div>

        {/* the rule */}
        <div style={{ display: "flex", borderRadius: 12, background: H.slate, color: H.cream, padding: "18px 22px", gap: 22, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div className="hf-lbl" style={{ color: "rgba(233,237,241,.55)" }}>The rule</div>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: "#fff", marginTop: 6, lineHeight: 1.4 }}>
              A {short(model.topAward)} needs at least {t} top-difficulty question{t === 1 ? "" : "s"} answered.
            </div>
            <div style={{ fontSize: 12.5, color: "rgba(233,237,241,.82)", marginTop: 6, lineHeight: 1.5 }}>
              Top-difficulty = <b style={{ color: "#fff" }}>{model.topDifficultyDemand || "—"}</b> demand ·{" "}
              {model.topDifficultyPool} such question{model.topDifficultyPool === 1 ? "" : "s"} in{" "}
              {model.scopes.find((s) => s.id === model.scope)?.label}. Fall short and the award caps to{" "}
              <b style={{ color: "#fff" }}>{short(model.cappedTo)}</b>.
            </div>
            <div style={{ fontSize: 11, color: "rgba(233,237,241,.6)", marginTop: 7 }}>{model.attemptedNote}</div>
          </div>
          <div style={{ width: 1, alignSelf: "stretch", background: "rgba(233,237,241,.18)" }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, flex: "0 0 auto" }}>
            <span className="hf-mono" style={{ width: 56, height: 56, borderRadius: 14, background: "rgba(255,255,255,.1)", border: "1.5px solid rgba(255,255,255,.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, color: "#fff" }}>{t}</span>
            <span style={{ fontSize: 10.5, color: "rgba(233,237,241,.7)" }}>threshold</span>
            <Link href="/settings/config" style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10.5, color: "#fff", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,.4)", paddingBottom: 1, textDecoration: "none" }}>
              Set in Settings<Icon name="arrow" size={11} color="#fff" />
            </Link>
          </div>
        </div>

        {model.counts.inLine === 0 ? (
          <div className="hf-card" style={{ padding: "14px 18px", display: "flex", gap: 11, alignItems: "center" }}>
            <Mark kind="pass" size={18} />
            <span style={{ fontSize: 13 }}>
              <b>No students are currently in line for a {short(model.topAward)}</b> at the present boundaries, so there’s
              nothing to safeguard. Lower the {short(model.topAward)} boundary on the{" "}
              <Link href={`/cycles/${cycleId}/boundaries`} style={{ color: H.pink, fontWeight: 600 }}>Boundaries</Link> screen
              (or load the sample faults) to exercise this step.
            </span>
          </div>
        ) : nCap === 0 ? (
          <div className="hf-card" style={{ padding: "13px 17px", background: H.goodSoft, borderColor: H.good, display: "flex", gap: 11, alignItems: "center" }}>
            <Mark kind="pass" size={18} />
            <span style={{ fontSize: 13 }}>
              <b>Every student in line for a {short(model.topAward)} met the rule.</b> Nothing to cap — confirm to continue to sign-off.
            </span>
          </div>
        ) : null}

        {/* stats */}
        <div style={{ display: "flex", gap: 44, flexWrap: "wrap" }}>
          <StatBlock n={model.counts.inLine} label={`In line for ${short(model.topAward)}`} />
          <StatBlock n={model.counts.meet} label="Meet the rule" />
          <StatBlock n={model.counts.capped} label="Capped" accent={nCap > 0} sub={nCap > 0 ? `→ ${short(model.cappedTo)}` : "none"} />
          <StatBlock n={model.counts.overridden} label="Overridden" sub="by a Lead" />
        </div>

        {/* table */}
        {model.counts.inLine > 0 && (
          <div className="hf-card" style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="hf-th">Participant</th>
                  <th className="hf-th">Top-difficulty answered</th>
                  <th className="hf-th">Meets rule</th>
                  <th className="hf-th">Provisional award</th>
                  <th className="hf-th">Result</th>
                  <th className="hf-th" style={{ textAlign: "right" }} />
                </tr>
              </thead>
              <tbody>
                {model.candidates.map((s) => (
                  <CandidateRow
                    key={s.id}
                    s={s}
                    t={t}
                    topAward={model.topAward}
                    cappedTo={model.cappedTo}
                    short={short}
                    canOverride={model.canOverride}
                    overrideOpen={overrideFor === s.id}
                    reason={reason}
                    onReason={setReason}
                    onAskOverride={() => { setOverrideFor(s.id); setReason(""); }}
                    onCancelOverride={() => setOverrideFor(null)}
                    onSubmitOverride={() => submitOverride(s.id)}
                    onUndo={() => provider.undoDistinctionOverride(cycleId, s.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <span className="hf-sub" style={{ fontSize: 11.5 }}>
            {model.candidates.length} in line · sorted by closest to the line
          </span>
          <span style={{ flex: 1 }} />
          <span className="hf-sub" style={{ fontSize: 11.5, display: "flex", gap: 7, alignItems: "center" }}>
            <Icon name="lock" size={12} color={H.ink3} />Every cap and override is attributed and audit-logged. Only a Lead can override.
          </span>
        </div>
      </div>
    </Shell>
  );
}

function Pips({ n, t }: { n: number; t: number }) {
  const ok = n >= t;
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
      <div style={{ display: "flex", gap: 3 }}>
        {Array.from({ length: t }).map((_, i) => {
          const filled = i < Math.min(n, t);
          return (
            <span key={i} style={{ width: 9, height: 9, borderRadius: 999, flex: "0 0 auto", background: filled ? (ok ? H.good : H.pink) : H.paper, border: `1.5px solid ${filled ? (ok ? H.good : H.pink) : H.line2}` }} />
          );
        })}
      </div>
      <span className="hf-mono" style={{ fontSize: 12.5, fontWeight: 700, color: ok ? H.good : H.pink }}>
        {n}<span style={{ color: H.ink3, fontWeight: 500 }}>/{t}</span>
      </span>
    </div>
  );
}

function AwardPill({ label, top, dim, strike }: { label: string; top: boolean; dim?: boolean; strike?: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 7, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap",
      background: top ? (dim ? H.tint2 : H.pink) : H.paper,
      color: top ? (dim ? H.ink3 : "#fff") : H.slate,
      border: top ? "none" : `1.5px solid ${H.slate2}`,
      textDecoration: strike ? "line-through" : "none", opacity: strike ? 0.55 : 1,
    }}>{label}</span>
  );
}

function CandidateRow({
  s, t, topAward, cappedTo, short, canOverride, overrideOpen, reason, onReason, onAskOverride, onCancelOverride, onSubmitOverride, onUndo,
}: {
  s: DistinctionCandidate;
  t: number;
  topAward: string;
  cappedTo: string;
  short: (l: string) => string;
  canOverride: boolean;
  overrideOpen: boolean;
  reason: string;
  onReason: (v: string) => void;
  onAskOverride: () => void;
  onCancelOverride: () => void;
  onSubmitOverride: () => void;
  onUndo: () => void;
}) {
  const pass = s.result === "pass";
  const capped = s.result === "capped";
  const over = s.result === "override";
  return (
    <tr className="hf-hover" style={{ background: capped ? H.warnSoft : over ? H.pinkSoft2 : "transparent" }}>
      <td className="hf-td">
        <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
          <Avatar name={s.name} size={30} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
            <div className="hf-mono hf-sub" style={{ fontSize: 11 }}>{s.id}</div>
          </div>
        </div>
      </td>
      <td className="hf-td"><Pips n={s.topDifficultyAnswered} t={t} /></td>
      <td className="hf-td">
        {s.meets ? (
          <span style={{ display: "flex", gap: 7, alignItems: "center" }}><Mark kind="pass" size={15} /><span style={{ fontSize: 12, fontWeight: 600, color: H.good }}>Meets rule</span></span>
        ) : (
          <span style={{ display: "flex", gap: 7, alignItems: "center" }}><Mark kind="fail" size={15} /><span style={{ fontSize: 12, fontWeight: 600, color: H.bad }}>Short by {Math.max(1, t - s.topDifficultyAnswered)}</span></span>
        )}
      </td>
      <td className="hf-td"><AwardPill label={short(s.provisionalAward)} top dim /></td>
      <td className="hf-td">
        {pass && <AwardPill label={short(topAward)} top />}
        {capped && (
          <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
            <AwardPill label={short(topAward)} top strike />
            <Icon name="arrow" size={13} color={H.warn} />
            <AwardPill label={short(cappedTo)} top={false} />
            <Badge tone="warn">Capped</Badge>
          </div>
        )}
        {over && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
              <AwardPill label={short(topAward)} top />
              <Badge tone="accent"><Icon name="lock" size={11} color={H.pink} />Cap overridden · Lead</Badge>
            </div>
            <span className="hf-sub" style={{ fontSize: 10.5, maxWidth: 320 }}>{s.overrideReason} · {s.overrideBy}</span>
          </div>
        )}
      </td>
      <td className="hf-td" style={{ textAlign: "right", position: "relative" }}>
        {capped && canOverride && !overrideOpen && (
          <Button variant="ghost" style={{ fontSize: 11.5 }} onClick={onAskOverride}>Override…</Button>
        )}
        {capped && overrideOpen && (
          <div className="hf-card" style={{ position: "absolute", right: 8, top: 6, zIndex: 5, width: 256, padding: 11, textAlign: "left", boxShadow: "0 8px 28px rgba(31,42,49,.18)", borderColor: H.pink }}>
            <div className="hf-lbl" style={{ color: H.pink, marginBottom: 7 }}>Keep {s.name} at {short(topAward)}</div>
            <input
              autoFocus
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              placeholder="Reason (recorded in audit log)"
              className="hf-input"
              style={{ width: "100%", fontSize: 12 }}
            />
            <div style={{ display: "flex", gap: 7, marginTop: 9, justifyContent: "flex-end" }}>
              <Button variant="ghost" style={{ fontSize: 11 }} onClick={onCancelOverride}>Cancel</Button>
              <Button variant="pri" style={{ fontSize: 11 }} disabled={!reason.trim()} onClick={onSubmitOverride}>Override cap</Button>
            </div>
          </div>
        )}
        {over && canOverride && <Button variant="ghost" style={{ fontSize: 11.5 }} onClick={onUndo}>Undo</Button>}
      </td>
    </tr>
  );
}
