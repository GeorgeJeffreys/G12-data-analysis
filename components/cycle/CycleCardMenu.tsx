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
import { useRouter } from "next/navigation";
import { useProvider, useProviderData } from "@/lib/data/context";
import { hasRole } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { Button } from "@/components/ui/primitives";
import { Mark } from "@/components/ui/icons";

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

function DeleteCycleDialog({ cycleId, cycleName, onClose }: { cycleId: string; cycleName: string; onClose: () => void }) {
  const provider = useProvider();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = text.trim().toLowerCase() === "delete";

  const confirm = async () => {
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      await provider.deleteCycle(cycleId);
      router.replace("/"); // back to Years; summaries recompute on rehydrate
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t delete this cycle.");
      setBusy(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(31,42,49,.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 20 }}
      onClick={busy ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="hf-card" style={{ padding: "20px 22px", maxWidth: 520, width: "100%", background: H.paper }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Mark kind="fail" size={18} />
          <span className="hf-h2">Delete this cycle?</span>
        </div>
        <div className="hf-sub" style={{ fontSize: 12.5, marginBottom: 14 }}>
          This permanently removes <strong>{cycleName}</strong> and <strong>all</strong> its data across every table
          (assessments, items, participants, responses, sittings, rollups, scores, grades, incidents, essays). It cannot
          be undone and is recorded in the audit log. Other cycles are untouched.
        </div>
        <label style={{ display: "block", fontSize: 11.5, color: H.ink2, marginBottom: 6 }}>
          Type <span className="hf-mono" style={{ color: H.bad, fontWeight: 700 }}>delete</span> to confirm
        </label>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && armed && !busy) confirm(); }}
          placeholder="delete"
          className="hf-mono"
          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${H.line2}`, fontSize: 13, marginBottom: 16 }}
        />
        {error && (
          <div style={{ fontSize: 12, color: H.bad, marginBottom: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Mark kind="fail" size={14} />
            <span>{error}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <button
            onClick={confirm}
            disabled={!armed || busy}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: `1px solid ${!armed || busy ? H.line2 : H.bad}`,
              background: !armed || busy ? H.tint : H.bad,
              color: !armed || busy ? H.ink3 : "#fff",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: !armed || busy ? "default" : "pointer",
            }}
          >
            {busy ? "Deleting…" : "Delete cycle"}
          </button>
        </div>
      </div>
    </div>
  );
}
