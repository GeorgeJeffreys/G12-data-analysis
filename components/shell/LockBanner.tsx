"use client";

/**
 * Read-only banner shown on the editable cycle screens once a cycle is locked.
 * A locked cycle stays fully navigable — every page is viewable — but edits are
 * frozen (the provider rejects writes while locked). This makes that state
 * explicit and surfaces the Lead-only "Re-open cycle" (unlock) action, which is
 * audit-logged in the provider.
 */
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";

export function LockBanner({ cycleId }: { cycleId: string }) {
  const provider = useProvider();
  const cycle = useProviderData((p) => p.getCycle(cycleId), [cycleId]);
  if (!cycle?.locked) return null;
  const isLead = provider.getCurrentUser().role === "lead_admin";

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 18px",
        background: H.goodSoft,
        borderBottom: `1px solid ${H.good}`,
        flexWrap: "wrap",
      }}
    >
      <Mark kind="pass" size={16} />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: H.ink }}>
        This cycle is locked &amp; signed off — viewing in read-only mode.
      </span>
      <span className="hf-sub" style={{ fontSize: 11.5 }}>
        Edits are frozen until the cycle is re-opened.
      </span>
      <div style={{ flex: 1 }} />
      {isLead && (
        <Button variant="ghost" onClick={() => provider.unlockCycle(cycleId)} title="Re-open the cycle for editing (audit-logged)">
          <Icon name="lock" size={14} />
          Re-open cycle
        </Button>
      )}
    </div>
  );
}
