"use client";

/**
 * Screen 04b — Per-student technical exclusions (the new Student-review step).
 * Work through faults that hit individual students on individual questions.
 * Excluding here removes that ONE question from that ONE student's score (and
 * from that item's cohort psychometrics) — everyone else keeps it. The scope is
 * kept visually distinct from the cohort-wide exclusion on the Review screen.
 * This step is OPTIONAL and never blocks the pipeline.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { LockBanner } from "@/components/shell/LockBanner";
import { Button, Badge, Avatar, StatBlock } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { cyclesSubnav } from "@/lib/ui/subnav";
import type { TechnicalIncident, IncidentDecision } from "@/lib/data/types";

const REASONS = [
  "Confirmed technical fault",
  "Device / hardware failure",
  "Power outage",
  "Network / loading failure",
  "Other — see notes",
];

type GroupBy = "student" | "question";

export default function StudentReviewPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const model = useProviderData((p) => p.getStudentReview(cycleId), [cycleId]);

  const [grp, setGrp] = useState<GroupBy>("student");
  const [search, setSearch] = useState("");
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  const continueAction = (
    <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
      {model && model.counts.awaiting > 0 && (
        <span className="hf-sub" style={{ fontSize: 11.5 }}>{model.counts.awaiting} still awaiting — you can decide later</span>
      )}
      <Link href={`/cycles/${cycleId}/boundaries`}>
        <Button variant="pri">Continue to scoring<Icon name="arrow" color="#fff" /></Button>
      </Link>
    </div>
  );

  const shellProps = {
    active: "Cycles" as const,
    crumb: [
      { label: "Cycles", href: "/" },
      { label: "May 2026", href: `/cycles/${cycleId}` },
      { label: "Student review" },
    ],
    subnav: cyclesSubnav(cycleId, "pipeline"),
    stageIndex: 3,
    done: 3,
    cycleId,
    actions: (
      <Link href={`/cycles/${cycleId}/audit`}>
        <Button variant="ghost"><Icon name="doc" />Audit log</Button>
      </Link>
    ),
  };

  const empty = !model || !model.uploaded || model.counts.incidents === 0;

  // grouped + filtered incidents
  const groups = useMemo(() => {
    if (!model) return [];
    const q = search.trim().toLowerCase();
    const list = model.incidents.filter(
      (i) => !q || i.studentName.toLowerCase().includes(q) || i.studentId.toLowerCase().includes(q) || i.questionLabel.toLowerCase().includes(q),
    );
    const out: { key: string; head: TechnicalIncident; items: TechnicalIncident[] }[] = [];
    const seen = new Map<string, { key: string; head: TechnicalIncident; items: TechnicalIncident[] }>();
    for (const i of list) {
      const key = grp === "student" ? i.studentId : `${i.questionLabel}·${i.assessmentId}`;
      let g = seen.get(key);
      if (!g) {
        g = { key, head: i, items: [] };
        seen.set(key, g);
        out.push(g);
      }
      g.items.push(i);
    }
    return out;
  }, [model, grp, search]);

  if (empty) {
    return (
      <Shell {...shellProps} stageAction={
        <Link href={`/cycles/${cycleId}/boundaries`}>
          <Button variant="pri">Skip — nothing to review<Icon name="arrow" color="#fff" /></Button>
        </Link>
      }>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, maxWidth: 540, textAlign: "center" }}>
            <div style={{ width: 58, height: 58, borderRadius: 999, border: `1.5px dashed ${H.line2}`, display: "flex", alignItems: "center", justifyContent: "center", background: H.canvas }}>
              <BoltIcon color={H.ink3} size={24} />
            </div>
            <div className="hf-h1">Nothing to review here</div>
            <div className="hf-sub" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              No technical-errors file was added for the May 2026 sitting, so there are no per-student faults to work
              through. This is an <b style={{ color: H.ink }}>optional</b> step — you can move straight to scoring.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <Link href={`/cycles/${cycleId}/boundaries`}>
                <Button variant="pri">Skip to scoring<Icon name="arrow" color="#fff" /></Button>
              </Link>
              <Link href={`/cycles/${cycleId}/ingest`}>
                <Button><Icon name="upload" size={13} />Add a technical-errors file</Button>
              </Link>
              <Button variant="ghost" onClick={() => provider.loadSampleTechnicalErrors(cycleId)}>Load sample</Button>
            </div>
            <div style={{ display: "flex", gap: 7, marginTop: 8, color: H.ink3, alignItems: "center" }}>
              <Icon name="lock" size={12} color={H.ink3} />
              <span className="hf-sub" style={{ fontSize: 11.5 }}>This step never blocks the pipeline.</span>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  const c = model!.counts;
  const decide = (id: string, decision: IncidentDecision, reason?: string) => {
    provider.setIncidentDecision(cycleId, id, decision, reason ?? null);
    setReasonFor(null);
  };

  return (
    <Shell {...shellProps} stageAction={continueAction}>
      <LockBanner cycleId={cycleId} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {/* header band */}
        <div style={{ display: "flex", flexDirection: "column", padding: "22px 28px 16px", gap: 16, borderBottom: `1px solid ${H.line}`, background: H.paper }}>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="hf-h1">
                Per-student technical exclusions
                {model!.sample && <Badge tone="accent">SAMPLE DATA</Badge>}
              </div>
              <div className="hf-sub" style={{ marginTop: 7, maxWidth: 640 }}>
                Work through faults that hit individual students on individual questions. Excluding here removes that one
                question from that one student’s score — everyone else keeps it.
              </div>
            </div>
          </div>

          {c.awaiting === 0 && (
            <div className="hf-card" style={{ padding: "12px 16px", background: H.goodSoft, borderColor: H.good, display: "flex", gap: 11, alignItems: "center" }}>
              <Mark kind="pass" size={17} />
              <span style={{ fontSize: 13 }}>
                <b>All {c.incidents} incidents reviewed.</b> {c.excluded} questions excluded for individual students, {c.kept} kept. Scores are ready to compute.
              </span>
            </div>
          )}

          <ScopeLegend />

          <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
            <StatBlock n={c.incidents} label="Incidents" sub="from faults file" />
            <StatBlock n={c.excluded} label="Per-student exclusions" accent sub="applied" />
            <StatBlock n={c.kept} label="Kept" sub="no fault counted" />
            <StatBlock n={c.awaiting} label="Awaiting decision" sub={c.awaiting ? "needs review" : "all clear"} />
            <StatBlock n={c.students} label="Students affected" />
          </div>
        </div>

        {/* controls */}
        <div style={{ display: "flex", gap: 11, padding: "12px 28px", borderBottom: `1px solid ${H.line}`, background: H.paper, flexWrap: "wrap", alignItems: "center" }}>
          <span className="hf-lbl" style={{ marginRight: 1 }}>Group by</span>
          <div style={{ display: "flex", border: `1px solid ${H.line2}`, borderRadius: 8, overflow: "hidden" }}>
            {(["student", "question"] as GroupBy[]).map((g, i) => (
              <button
                key={g}
                onClick={() => setGrp(g)}
                style={{ padding: "6px 13px", fontSize: 11.5, fontWeight: grp === g ? 700 : 500, cursor: "pointer", textTransform: "capitalize", background: grp === g ? H.pinkSoft : H.paper, color: grp === g ? H.pink : H.ink2, border: "none", borderLeft: i ? `1px solid ${H.line2}` : "none" }}
              >
                {g}
              </button>
            ))}
          </div>
          <span style={{ width: 1, height: 20, background: H.line2, margin: "0 4px" }} />
          <label className="hf-field" style={{ width: 230 }}>
            <Icon name="search" color={H.ink3} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by student, ID or question"
              aria-label="Filter incidents"
              style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12.5, color: H.ink }}
            />
          </label>
          <div style={{ flex: 1 }} />
          <span className="hf-sub">{c.incidents} incidents · {c.awaiting} awaiting</span>
        </div>

        {/* list */}
        <div style={{ flex: 1, overflow: "auto", background: H.canvas, padding: "18px 28px" }}>
          <div className="hf-card" style={{ overflow: "hidden" }}>
            {groups.map((g, gi) => (
              <div key={g.key}>
                <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 11, background: H.tint, borderBottom: `1px solid ${H.line2}`, borderTop: gi ? `1px solid ${H.line2}` : "none" }}>
                  {grp === "student" ? (
                    <>
                      <Avatar name={g.head.studentName} size={26} tone="pink" />
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{g.head.studentName}</span>
                      <span className="hf-mono" style={{ fontSize: 11, color: H.ink3 }}>{g.head.studentId}</span>
                      <span style={{ flex: 1 }} />
                      <span className="hf-sub" style={{ fontSize: 11.5 }}>
                        {g.items.length} incident{g.items.length > 1 ? "s" : ""} · {g.items.filter((i) => i.decision === "excluded").length} excluded
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="hf-mono" style={{ fontSize: 12.5, fontWeight: 700 }}>{g.head.questionLabel}</span>
                      <AsmTag name={g.head.assessmentName} rtl={g.head.rtl} />
                      <span style={{ fontSize: 12, color: H.ink2 }} dir={g.head.rtl ? "rtl" : "ltr"}>{g.head.wording ?? "—"}</span>
                      <span style={{ flex: 1 }} />
                      <span className="hf-sub" style={{ fontSize: 11.5 }}>{g.items.length} student{g.items.length > 1 ? "s" : ""} affected</span>
                    </>
                  )}
                </div>
                {g.items.map((inc, ii) => (
                  <IncidentRow
                    key={inc.id}
                    inc={inc}
                    showStudent={grp === "question"}
                    last={ii === g.items.length - 1}
                    reasonOpen={reasonFor === inc.id}
                    onAskReason={() => setReasonFor(inc.id)}
                    onCancelReason={() => setReasonFor(null)}
                    onExclude={(reason) => decide(inc.id, "excluded", reason)}
                    onKeep={() => decide(inc.id, "kept")}
                    onUndo={() => decide(inc.id, null)}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 13, display: "flex", gap: 7, alignItems: "center" }}>
            <Icon name="lock" size={12} color={H.ink3} />
            Every decision is attributed and written to the audit log. Re-opening the cycle is required to change a locked one.
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────
function BoltIcon({ color = H.ink3, size = 13 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
      <path d="M8.6 2L4 9h3.4L7 14l4.6-7H8z" />
    </svg>
  );
}

function ScopeGrid({ mode }: { mode: "column" | "cell" }) {
  const cols = 5, rows = 4;
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let cc = 0; cc < cols; cc++) {
      const colHi = mode === "column" && cc === 2;
      const cellHi = mode === "cell" && cc === 2 && r === 1;
      cells.push(
        <span key={`${r}-${cc}`} style={{ width: 8, height: 8, borderRadius: 2, background: colHi ? H.badSoft : cellHi ? H.pink : H.tint2, border: `1px solid ${colHi ? H.bad : cellHi ? H.pink : "transparent"}` }} />,
      );
    }
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},8px)`, gap: 3, flex: "0 0 auto" }}>{cells}</div>;
}

function ScopeLegend() {
  return (
    <div className="hf-card" style={{ padding: "13px 16px" }}>
      <span className="hf-lbl">Two kinds of exclusion — keep them apart</span>
      <div style={{ display: "flex", gap: 14, marginTop: 11, alignItems: "stretch" }}>
        <div style={{ display: "flex", gap: 12, flex: 1, padding: "10px 13px", border: `1px solid ${H.line2}`, borderRadius: 10, background: H.canvas, alignItems: "center" }}>
          <ScopeGrid mode="column" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Cohort item exclusion</div>
            <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 1 }}>On <b style={{ color: H.ink }}>Item review</b> — drops a question for <b style={{ color: H.ink }}>every</b> student.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flex: 1, padding: "10px 13px", border: `1.5px solid ${H.pink}`, borderRadius: 10, background: H.pinkSoft2, alignItems: "center" }}>
          <ScopeGrid mode="cell" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: H.pink }}>Per-student exclusion — this step</div>
            <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 1 }}>Drops one question for <b style={{ color: H.pink }}>one</b> student only. The rest keep it.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AsmTag({ name, rtl }: { name: string; rtl: boolean }) {
  return (
    <span className="hf-mono" style={{ fontSize: 9.5, color: H.ink3, border: `1px solid ${H.line2}`, padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
      {name}{rtl && " · RTL"}
    </span>
  );
}

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function IncidentRow({
  inc, showStudent, last, reasonOpen, onAskReason, onCancelReason, onExclude, onKeep, onUndo,
}: {
  inc: TechnicalIncident;
  showStudent: boolean;
  last: boolean;
  reasonOpen: boolean;
  onAskReason: () => void;
  onCancelReason: () => void;
  onExclude: (reason: string) => void;
  onKeep: () => void;
  onUndo: () => void;
}) {
  const excluded = inc.decision === "excluded";
  return (
    <div style={{ display: "flex", padding: "14px 16px", gap: 16, alignItems: "flex-start", borderBottom: last ? "none" : `1px solid ${H.line}`, background: excluded ? H.pinkSoft2 : "transparent" }}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 7, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          {showStudent && (
            <span style={{ display: "flex", gap: 7, alignItems: "center" }}>
              <Avatar name={inc.studentName} size={22} />
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{inc.studentName}</span>
              <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink3 }}>{inc.studentId}</span>
            </span>
          )}
          <span className="hf-mono" style={{ fontSize: 12, fontWeight: 700 }}>{inc.questionLabel}</span>
          {inc.itemId ? <AsmTag name={inc.assessmentName} rtl={inc.rtl} /> : <Badge tone="warn">Unmatched</Badge>}
          {inc.demand && <span className="hf-chip" style={{ fontSize: 10.5, padding: "2px 9px" }}>{inc.demand}</span>}
        </div>
        {inc.wording && (
          <div style={{ fontSize: 12.5, color: H.ink }} dir={inc.rtl ? "rtl" : "ltr"}>{inc.wording}</div>
        )}
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }} dir={inc.rtl ? "rtl" : "ltr"}>
          <BoltIcon color={H.warn} />
          <span style={{ fontSize: 11.5, color: H.ink2 }}>{inc.error}</span>
          <span className="hf-mono" style={{ fontSize: 9.5, color: H.ink3, border: `1px solid ${H.line2}`, padding: "0 5px", borderRadius: 4 }}>from faults file</span>
        </div>
      </div>

      <div style={{ flex: "0 0 auto" }}>
        {excluded ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end", textAlign: "right" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px 5px 6px", borderRadius: 999, background: H.pink, color: "#fff", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
              <span style={{ width: 17, height: 17, borderRadius: 999, background: "rgba(255,255,255,.22)", fontSize: 8, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                {inc.studentName.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </span>
              Excluded for {inc.studentName} only
            </span>
            <span className="hf-sub" style={{ fontSize: 10.5 }}>{inc.reason} · {inc.by} · {whenLabel(inc.at)}</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 10, color: H.ink3 }}><Icon name="lock" size={10} color={H.ink3} />logged</span>
              <Button variant="ghost" style={{ fontSize: 10.5, padding: "3px 7px" }} onClick={onUndo}>Undo</Button>
            </div>
          </div>
        ) : inc.decision === "kept" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end", textAlign: "right" }}>
            <Badge tone="neutral"><Mark kind="pass" size={11} />Kept · scored normally</Badge>
            <span className="hf-sub" style={{ fontSize: 10.5 }}>{inc.by} · {whenLabel(inc.at)}</span>
            <Button variant="ghost" style={{ fontSize: 10.5, padding: "3px 7px" }} onClick={onUndo}>Change</Button>
          </div>
        ) : reasonOpen ? (
          <div className="hf-card" style={{ padding: "12px 13px", width: 268, borderColor: H.pink, boxShadow: "0 8px 24px -12px rgba(193,44,104,.4)" }}>
            <div className="hf-lbl" style={{ color: H.pink, marginBottom: 9 }}>Exclude {inc.questionLabel} for {inc.studentName} only</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {REASONS.map((r) => (
                <button
                  key={r}
                  className="hf-btn ghost"
                  style={{ display: "block", width: "100%", textAlign: "left", fontSize: 12, padding: "6px 8px" }}
                  onClick={() => onExclude(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
              <Button variant="ghost" style={{ fontSize: 11, color: H.ink3 }} onClick={onCancelReason}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", textAlign: "right" }}>
            <div style={{ display: "flex", gap: 7 }}>
              <Button variant="pri" style={{ fontSize: 11.5 }} onClick={onAskReason} disabled={!inc.itemId} title={inc.itemId ? undefined : "Can’t exclude an unmatched question"}>
                Exclude for {inc.studentName}
              </Button>
              <Button style={{ fontSize: 11.5 }} onClick={onKeep}>Keep</Button>
            </div>
            <span className="hf-sub" style={{ fontSize: 10.5 }}>excludes this one question for {inc.studentName} only</span>
          </div>
        )}
      </div>
    </div>
  );
}
