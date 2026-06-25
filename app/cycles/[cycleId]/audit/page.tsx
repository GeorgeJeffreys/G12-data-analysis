"use client";

/**
 * Audit log + overrides (admin check-in surface).
 *
 * Two views over the same cycle:
 *  - History: every consequential action (exclusions, boundary changes, locks,
 *    exports, document generation, uploads, and OVERRIDES) — append-only, can't
 *    be edited. Override entries are marked distinctly and name who they overrode.
 *  - Effective state & overrides: the CURRENT grade-bearing decisions in effect
 *    (excluded items, manual mark adjustments) with provenance, and — for an
 *    authorised user (lead_admin) — controls to override (e.g. re-include an item
 *    another user excluded). An override re-runs the FULL engine (incl. the D3
 *    safeguard) through the same path as the original action and is itself audited.
 */
import { useState } from "react";
import { useProviderData, useProvider } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { Button, Avatar, Badge, type BadgeTone } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import type { AuditFilter, AuditType, EffectiveDecision } from "@/lib/data/types";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";

const FILTERS: { key: AuditFilter; label: string }[] = [
  { key: "all", label: "All actions" },
  { key: "exclude", label: "Exclusions" },
  { key: "boundary", label: "Boundaries" },
  { key: "lock", label: "Locks" },
  { key: "export", label: "Exports" },
];

const TONE: Record<AuditType, BadgeTone> = {
  exclude: "warn",
  boundary: "accent",
  lock: "good",
  reopen: "bad",
  export: "neutral",
  document: "neutral",
  upload: "neutral",
  cycle: "accent",
  validate: "neutral",
  student: "warn",
  safeguard: "accent",
  config: "neutral",
  override: "bad",
};

function when(iso: string): { time: string; day: string } {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const day = sameDay(d, now) ? "Today" : sameDay(d, yest) ? "Yesterday" : d.toLocaleDateString([], { day: "2-digit", month: "short" });
  return { time, day };
}

export default function AuditPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const [view, setView] = useState<"history" | "overrides">("history");
  const [filter, setFilter] = useState<AuditFilter>("all");
  const [search, setSearch] = useState("");
  const model = useProviderData((p) => p.getAuditLog(cycleId, filter, search), [cycleId, filter, search]);
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";
  const { zoom, setZoom, scrollRef, zoomWrapStyle } = useTableZoom();

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Audit log"
      area="audit"
      primary={<Button variant="ghost"><Icon name="download" />Export log</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "16px 26px", borderBottom: `1px solid ${H.line}`, flexWrap: "wrap", background: H.paper }}>
          <span className={`hf-chip ${view === "history" ? "on" : ""}`} onClick={() => setView("history")} style={{ cursor: "pointer" }}>History</span>
          <span className={`hf-chip ${view === "overrides" ? "on" : ""}`} onClick={() => setView("overrides")} style={{ cursor: "pointer" }}>Effective state &amp; overrides</span>
          <div style={{ width: 1, height: 20, background: H.line, margin: "0 4px" }} />
          {view === "history" && (
            <>
              <label className="hf-field" style={{ width: 240 }}>
                <Icon name="search" color={H.ink3} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actions or people" style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12.5 }} />
              </label>
              {FILTERS.map((f) => (
                <span key={f.key} className={`hf-chip ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)} style={{ cursor: "pointer" }}>{f.label}</span>
              ))}
            </>
          )}
          <div style={{ flex: 1 }} />
          <ZoomControl zoom={zoom} onZoom={setZoom} />
          {view === "history" && <span className="hf-sub">{model.total} events</span>}
        </div>

        {view === "history" ? (
          <div ref={scrollRef} style={{ flex: 1, overflow: "auto", background: H.paper }}>
            <div style={zoomWrapStyle}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="hf-th" style={{ width: 120 }}>When</th>
                  <th className="hf-th" style={{ width: 240 }}>Who</th>
                  <th className="hf-th" style={{ width: 180 }}>Action</th>
                  <th className="hf-th">Details</th>
                </tr>
              </thead>
              <tbody>
                {model.entries.map((e) => {
                  const w = when(e.ts);
                  return (
                    <tr key={e.id} className="hf-hover">
                      <td className="hf-td">
                        <div className="hf-mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{w.time}</div>
                        <div className="hf-sub" style={{ fontSize: 11 }}>{w.day}{e.seeded ? " · example" : ""}</div>
                      </td>
                      <td className="hf-td">
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Avatar name={e.actorName} size={30} />
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{e.actorName}</div>
                            <div className="hf-sub" style={{ fontSize: 11 }}>{e.actorRole}</div>
                          </div>
                        </div>
                      </td>
                      <td className="hf-td">
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                          <Badge tone={TONE[e.type]}>{e.action}</Badge>
                          {e.isOverride && e.priorActor && (
                            <span className="hf-sub" style={{ fontSize: 10.5 }}>overrode {e.priorActor}</span>
                          )}
                        </div>
                      </td>
                      <td className="hf-td" style={{ fontSize: 12.5, color: H.ink2 }}>{e.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="hf-sub" style={{ padding: "14px 26px" }}>
              Showing {model.entries.length} of {model.total} events · every consequential action is recorded and cannot be edited.
            </div>
            </div>
          </div>
        ) : (
          <OverridesPanel cycleId={cycleId} scrollRef={scrollRef} zoomWrapStyle={zoomWrapStyle} />
        )}
      </div>
    </CycleShell>
  );
}

function OverridesPanel({
  cycleId,
  scrollRef,
  zoomWrapStyle,
}: {
  cycleId: string;
  scrollRef: React.RefObject<HTMLDivElement>;
  zoomWrapStyle: React.CSSProperties;
}) {
  const provider = useProvider();
  const model = useProviderData((p) => p.getOverrideView(cycleId), [cycleId]);
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const start = (key: string) => { setPending(key); setReason(""); };
  const cancel = () => { setPending(null); setReason(""); };
  const confirm = (d: EffectiveDecision) => {
    const r = reason.trim();
    if (!r) return;
    if (d.kind === "item_exclusion" && d.itemId) {
      // Canonical override: re-include an item another user excluded.
      provider.overrideItemExclusion(cycleId, d.assessmentId, d.itemId, !d.excluded, r);
    } else if (d.kind === "mark_adjustment" && d.participantId) {
      // Revert another user's manual mark adjustment.
      provider.overrideMarkAdjustment(cycleId, d.participantId, d.assessmentId, null, r);
    }
    cancel();
  };

  return (
    <div ref={scrollRef} style={{ flex: 1, overflow: "auto", background: H.paper }}>
      <div style={zoomWrapStyle}>
        <div style={{ display: "flex", gap: 20, padding: "12px 26px", borderBottom: `1px solid ${H.line}` }}>
          <Stat label="Decisions in effect" value={model.counts.decisions} />
          <Stat label="Result of an override" value={model.counts.overridden} />
          {!model.canOverride && (
            <div className="hf-sub" style={{ alignSelf: "center" }}>
              <Icon name="lock" color={H.ink3} /> You don&apos;t have override rights on this sitting.
            </div>
          )}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="hf-th">Target</th>
              <th className="hf-th" style={{ width: 200 }}>Current state</th>
              <th className="hf-th" style={{ width: 220 }}>Set by</th>
              <th className="hf-th" style={{ width: 240 }}>Override</th>
            </tr>
          </thead>
          <tbody>
            {model.decisions.length === 0 && (
              <tr><td className="hf-td" colSpan={4} style={{ color: H.ink3 }}>No grade-bearing decisions in effect for this sitting yet.</td></tr>
            )}
            {model.decisions.map((d) => (
              <tr key={d.key} className="hf-hover">
                <td className="hf-td">
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.target}</div>
                  {d.reason && <div className="hf-sub" style={{ fontSize: 11 }}>{d.reason}</div>}
                </td>
                <td className="hf-td">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                    <Badge tone={d.kind === "item_exclusion" ? "warn" : "accent"}>{d.state}</Badge>
                    {d.override && <Badge tone="bad">Override</Badge>}
                  </div>
                </td>
                <td className="hf-td" style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 600 }}>{d.decidedBy}</div>
                  {d.override ? (
                    <div className="hf-sub" style={{ fontSize: 11 }}>
                      overridden by {d.override.by}{d.override.priorActor ? ` — was set by ${d.override.priorActor}` : ""}
                    </div>
                  ) : (
                    <div className="hf-sub" style={{ fontSize: 11 }}>original decision</div>
                  )}
                </td>
                <td className="hf-td">
                  {!model.canOverride ? (
                    <span className="hf-sub" style={{ fontSize: 11 }}>—</span>
                  ) : pending === d.key ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (required)"
                        style={{ border: `1px solid ${H.line}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, outline: "none" }}
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <Button variant="pri" disabled={!reason.trim()} onClick={() => confirm(d)}>Confirm override</Button>
                        <Button variant="ghost" onClick={cancel}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="ghost" onClick={() => start(d.key)}>
                      <Icon name="refresh" />
                      {d.kind === "item_exclusion" ? "Re-include" : "Revert"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hf-sub" style={{ padding: "14px 26px" }}>
          An override re-runs the full scoring engine (including the D3 distinction safeguard) through the same
          path as the original action, and is recorded in the history above with who overrode whom and why.
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div className="hf-sub" style={{ fontSize: 11 }}>{label}</div>
    </div>
  );
}
