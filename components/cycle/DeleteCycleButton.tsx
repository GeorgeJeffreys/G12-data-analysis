"use client";

/**
 * "Delete cycle" — the cycle-level danger action on the Year/cycle card (task 23).
 *
 * Removes the cycle row and EVERY row keyed to its `cycle_id` across all tables
 * (the provider runs the SECURITY DEFINER `delete_cycle` RPC, which reuses the
 * sitting-delete cascade + row-count, is admin-gated via the C1 `has_role`
 * primitive, audited at the workspace level, and refuses to delete the last
 * remaining cycle). Gated behind a TYPED confirmation so it can never fire on a
 * stray click, and only shown to admins. On success we return to Years so the
 * year/summary reads recompute against the now-smaller cohort.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProvider } from "@/lib/data/context";
import { hasRole } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { Button } from "@/components/ui/primitives";
import { Mark } from "@/components/ui/icons";

export function DeleteCycleButton({ cycleId, name }: { cycleId: string; name: string | null }) {
  const provider = useProvider();
  const isAdmin = hasRole(provider.getCurrentUser().role, "admin");
  const [open, setOpen] = useState(false);

  // Admin-only — the RPC also rejects a non-admin, but there's no reason to offer
  // the control to someone it will always deny.
  if (!isAdmin) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Delete cycle ${name ?? ""}`.trim()}
        style={{
          alignSelf: "flex-start",
          background: "transparent",
          border: "none",
          padding: 0,
          fontSize: 11.5,
          fontWeight: 600,
          color: H.bad,
          cursor: "pointer",
        }}
      >
        Delete cycle
      </button>
      {open && <DeleteCycleDialog cycleId={cycleId} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeleteCycleDialog({
  cycleId,
  name,
  onClose,
}: {
  cycleId: string;
  name: string | null;
  onClose: () => void;
}) {
  const provider = useProvider();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = text.trim().toLowerCase() === "delete";

  const confirm = async () => {
    if (!armed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await provider.deleteCycle(cycleId);
      // The cycle no longer exists — return to Years so its summaries recompute.
      router.replace("/");
      router.refresh();
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
          This permanently removes <strong>{name ?? "the cycle"}</strong> and <strong>every</strong> row
          keyed to its cycle — assessments, items, participants, sittings, responses, rollups, scores and
          grades. It cannot be undone and is recorded in the audit log. Other cycles are untouched.
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
