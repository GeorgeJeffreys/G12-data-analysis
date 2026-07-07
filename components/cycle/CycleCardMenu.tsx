"use client";

/**
 * Compact per-cycle overflow menu (⋯) for a sitting card on the Year screen — the
 * card-level home of the "Delete cycle" action (its other home is the cycle
 * Settings → Danger zone). Admin-only; hidden entirely for non-admins.
 *
 * "Delete cycle" removes the cycle row AND every row keyed to that cycle_id across
 * all tables (the FK cascade behind the SECURITY DEFINER `delete_cycle` RPC), behind
 * a TYPED confirmation naming the cycle. A last-cycle guard disables it when this is
 * the only remaining cycle. On success we return to Years and summaries recompute.
 */
import { useState } from "react";
import { useProviderData } from "@/lib/data/context";
import { hasRole } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { DeleteCycleDialog } from "./DeleteCycleDialog";

export function CycleCardMenu({ cycleId, cycleName }: { cycleId: string; cycleName: string }) {
  const isAdmin = useProviderData((p) => hasRole(p.getCurrentUser?.()?.role ?? "viewer", "admin"));
  const isLastCycle = useProviderData((p) => p.listCycles().length <= 1);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!isAdmin) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={`Actions for ${cycleName}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          border: `1px solid ${H.line2}`,
          background: H.paper,
          borderRadius: 8,
          width: 28,
          height: 24,
          fontSize: 15,
          lineHeight: "1",
          color: H.ink2,
          cursor: "pointer",
        }}
      >
        ⋯
      </button>
      {open && (
        <>
          {/* click-away layer */}
          <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div
            role="menu"
            style={{
              position: "absolute",
              right: 0,
              top: 28,
              zIndex: 91,
              minWidth: 190,
              background: H.paper,
              border: `1px solid ${H.line2}`,
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(31,42,49,.18)",
              padding: 6,
            }}
          >
            <button
              type="button"
              role="menuitem"
              disabled={isLastCycle}
              onClick={() => { setOpen(false); setConfirming(true); }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 7,
                border: "none",
                background: "transparent",
                color: isLastCycle ? H.ink3 : H.bad,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: isLastCycle ? "default" : "pointer",
              }}
            >
              Delete cycle
            </button>
            {isLastCycle && (
              <div className="hf-sub" style={{ fontSize: 10.5, padding: "0 10px 6px" }}>
                The workspace must keep at least one cycle.
              </div>
            )}
          </div>
        </>
      )}
      {confirming && <DeleteCycleDialog cycleId={cycleId} cycleName={cycleName} onClose={() => setConfirming(false)} />}
    </div>
  );
}
