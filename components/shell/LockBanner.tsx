"use client";

/**
 * Locked / read-only indicator for the cycle screens once a cycle is locked.
 * A locked cycle stays fully navigable — every page is viewable — but edits are
 * frozen (the provider rejects writes while locked).
 *
 * This is a STATUS, not an action item, so it is shown as a quiet inline pill
 * near the breadcrumb (via CycleShell) rather than a full-width coloured banner
 * competing in the alerts strip with real, action-required notices. The Lead-only
 * "Re-open" (unlock) action lives on the pill and is audit-logged in the provider.
 */
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Icon } from "@/components/ui/icons";

export function LockStatus({ cycleId }: { cycleId: string }) {
  const provider = useProvider();
  const cycle = useProviderData((p) => p.getCycle(cycleId), [cycleId]);
  if (!cycle?.locked) return null;
  const isLead = provider.getCurrentUser().role === "lead_admin";

  return (
    <span
      role="status"
      title="This sitting is locked & signed off — edits are frozen until it is re-opened."
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flex: "0 0 auto",
        padding: "3px 9px",
        borderRadius: 999,
        background: H.goodSoft,
        border: `1px solid ${H.good}33`,
        color: H.good,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <Icon name="lock" size={12} color={H.good} />
      Locked · read-only
      {isLead && (
        <button
          onClick={() => provider.unlockCycle(cycleId)}
          title="Re-open the sitting for editing (audit-logged)"
          style={{ border: "none", background: "transparent", color: H.ink2, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0, marginLeft: 2, textDecoration: "underline" }}
        >
          Re-open
        </button>
      )}
    </span>
  );
}
