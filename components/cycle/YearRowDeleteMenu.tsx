"use client";

/**
 * Top-level Delete-cycle control for a Years-list row — the PRIMARY, always-reachable
 * delete path. A Years row groups a Centre/Year's started sittings (each is a cycle);
 * this ⋯ overflow menu lists them and deletes the chosen one **by its real cycle id,
 * directly from the list**, with no need to open the cycle. Because it never routes
 * through the year/pipeline page, a cycle stranded by a routing 404 can still be
 * deleted here.
 *
 * Admin-only (hidden for everyone else). Type-to-confirm naming the cycle, a
 * last-cycle guard (never delete the only remaining cycle), and the existing
 * `delete_cycle` cascade (all cycle_id rows, audit-logged). After a delete the list
 * re-renders itself — the provider bumps subscribers on rehydrate — so the row
 * disappears immediately without navigating away.
 */
import { useState } from "react";
import { useProviderData } from "@/lib/data/context";
import { hasRole } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { DeleteCycleDialog } from "./DeleteCycleDialog";

export type DeletableCycle = { cycleId: string; label: string; cycleName: string };

export function YearRowDeleteMenu({ cycles }: { cycles: DeletableCycle[] }) {
  const isAdmin = useProviderData((p) => hasRole(p.getCurrentUser?.()?.role ?? "viewer", "admin"));
  const isLastCycle = useProviderData((p) => p.listCycles().length <= 1);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<DeletableCycle | null>(null);

  // Nothing to delete (no started sitting) or not an admin → no control.
  if (!isAdmin || cycles.length === 0) return null;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        aria-label="Cycle actions"
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        style={{
          border: `1px solid ${H.line2}`,
          background: H.paper,
          borderRadius: 8,
          width: 30,
          height: 30,
          fontSize: 16,
          lineHeight: "1",
          color: H.ink2,
          cursor: "pointer",
          verticalAlign: "middle",
        }}
      >
        ⋯
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div
            role="menu"
            style={{
              position: "absolute",
              right: 0,
              top: 34,
              zIndex: 91,
              minWidth: 210,
              background: H.paper,
              border: `1px solid ${H.line2}`,
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(31,42,49,.18)",
              padding: 6,
              textAlign: "left",
            }}
          >
            {cycles.map((c) => (
              <button
                key={c.cycleId}
                type="button"
                role="menuitem"
                disabled={isLastCycle}
                onClick={() => { setOpen(false); setTarget(c); }}
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
                Delete {c.label} cycle
              </button>
            ))}
            {isLastCycle && (
              <div className="hf-sub" style={{ fontSize: 10.5, padding: "0 10px 6px" }}>
                The workspace must keep at least one cycle.
              </div>
            )}
          </div>
        </>
      )}
      {target && (
        <DeleteCycleDialog
          cycleId={target.cycleId}
          cycleName={target.cycleName}
          stayOnPage
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
