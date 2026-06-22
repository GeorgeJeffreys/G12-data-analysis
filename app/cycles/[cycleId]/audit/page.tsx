"use client";

/**
 * Audit log — every consequential action (exclusions, boundary changes, locks,
 * exports, document generation, uploads) is recorded and can't be edited. Real
 * in-session actions append here live; a few seeded examples seed the list.
 */
import { useState } from "react";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { Button, Avatar, Badge, type BadgeTone } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import type { AuditFilter, AuditType } from "@/lib/data/types";
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
          <label className="hf-field" style={{ width: 240 }}>
            <Icon name="search" color={H.ink3} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actions or people" style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12.5 }} />
          </label>
          {FILTERS.map((f) => (
            <span key={f.key} className={`hf-chip ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)} style={{ cursor: "pointer" }}>{f.label}</span>
          ))}
          <div style={{ flex: 1 }} />
          <ZoomControl zoom={zoom} onZoom={setZoom} />
          <span className="hf-sub">{model.total} events</span>
        </div>

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
                    <td className="hf-td"><Badge tone={TONE[e.type]}>{e.action}</Badge></td>
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
      </div>
    </CycleShell>
  );
}
