"use client";

/**
 * Cycle Settings — the cycle-level admin surface. Today it hosts the danger zone
 * (delete cycle: full cascade, admin-gated, type-to-confirm, audit-logged, returns
 * to Years — an admin may delete every cycle, leaving an empty workspace). Kept
 * separate from the per-sitting Upload danger zone so a whole-cycle delete has its
 * own deliberate home.
 */
import { useProviderData } from "@/lib/data/context";
import { CycleShell } from "@/components/shell/CycleShell";
import { CycleDangerZone } from "@/components/cycle/CycleDangerZone";

export default function CycleSettingsPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";

  return (
    <CycleShell cycleId={cycleId} cycleName={cycleName} page="Settings" area="settings">
      <div style={{ display: "flex", flexDirection: "column", padding: "28px 32px", gap: 22, maxWidth: 760 }}>
        <div>
          <div className="hf-h1">Cycle settings</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            Administrative controls for this cycle. Destructive actions are recorded in the audit log.
          </div>
        </div>
        <CycleDangerZone cycleId={cycleId} cycleName={cycleName} />
      </div>
    </CycleShell>
  );
}
