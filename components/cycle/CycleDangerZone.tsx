"use client";

/**
 * Cycle-level danger surface (migration 0032), rendered on the cycle's Settings tab.
 *
 *   * Delete cycle — removes the cycle row AND every row keyed to that cycle_id
 *     across all tables (the full FK cascade), irreversibly. Gated behind a TYPED
 *     confirmation (type "delete") so it can never fire on a stray click, and
 *     ADMIN-ONLY (hidden entirely for non-admins). An admin may delete every cycle,
 *     leaving an empty workspace (zero cycles is a valid state). On success we return
 *     to Years (the deleted cycle no longer exists, so `replace`, not `push`, keeps
 *     the back button off the dead route).
 *
 * The provider (live) runs the SECURITY DEFINER `delete_cycle` RPC that authorizes
 * lead/admin, writes the audit row with the resolved user, and only resolves once the
 * DB has really removed rows (a null/0 count throws) — so a silent no-op can never
 * read as success.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProvider, useProviderData } from "@/lib/data/context";
import { hasRole } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { Button } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";

export function CycleDangerZone({ cycleId, cycleName }: { cycleId: string; cycleName: string }) {
  const isAdmin = useProviderData((p) => hasRole(p.getCurrentUser?.()?.role ?? "viewer", "admin"));
  const [open, setOpen] = useState(false);

  // Non-admins never see the destructive control (defence-in-depth over the RPC gate).
  if (!isAdmin) {
    return (
      <div className="hf-card" style={{ padding: "16px 18px", borderColor: H.line2 }}>
        <div className="hf-sub" style={{ fontSize: 12.5 }}>
          Only an administrator can delete this cycle.
        </div>
      </div>
    );
  }

  return (
    <div className="hf-card" style={{ padding: "16px 18px", borderColor: H.line2, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Icon name="trash" size={14} color={H.ink2} />
        <span className="hf-h2" style={{ fontSize: 14 }}>Danger zone</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 560 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: H.bad }}>Delete this cycle</div>
        <div className="hf-sub" style={{ fontSize: 11.5 }}>
          Removes the cycle and <strong>every</strong> row keyed to it across all tables — assessments, items,
          participants, responses, sittings, rollups, scores, grades, incidents and essays. This cannot be undone and is
          recorded in the audit log. Other cycles are untouched.
        </div>
        <div>
          <DangerButton onClick={() => setOpen(true)}>Delete cycle</DangerButton>
        </div>
      </div>

      {open && <DeleteDialog cycleId={cycleId} cycleName={cycleName} onClose={() => setOpen(false)} />}
    </div>
  );
}

function DeleteDialog({ cycleId, cycleName, onClose }: { cycleId: string; cycleName: string; onClose: () => void }) {
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
      // Resolves only once the DB confirms the cascade removed rows. The cycle no
      // longer exists, so we return to Years (home) with replace so the back button
      // can't bounce into the now-dead cycle.
      await provider.deleteCycle(cycleId);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t delete this cycle.");
      setBusy(false);
    }
  };

  return (
    <Backdrop onClose={busy ? undefined : onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Mark kind="fail" size={18} />
        <span className="hf-h2">Delete this cycle?</span>
      </div>
      <div className="hf-sub" style={{ fontSize: 12.5, marginBottom: 14 }}>
        This permanently removes <strong>{cycleName}</strong> and <strong>all</strong> its data across every table. It
        cannot be undone. The deletion is recorded in the audit log.
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
        <DangerButton onClick={confirm} disabled={!armed || busy}>{busy ? "Deleting…" : "Delete cycle"}</DangerButton>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(31,42,49,.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 20 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="hf-card" style={{ padding: "20px 22px", maxWidth: 520, width: "100%", background: H.paper }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function DangerButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "7px 14px",
        borderRadius: 8,
        border: `1px solid ${disabled ? H.line2 : H.bad}`,
        background: disabled ? H.tint : H.bad,
        color: disabled ? H.ink3 : "#fff",
        fontSize: 12.5,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
