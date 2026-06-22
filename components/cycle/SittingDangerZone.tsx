"use client";

/**
 * Danger zone for a sitting (Tasks 3 + 4, migration 0007). Two destructive,
 * confirmed, audited controls on the Upload screen:
 *
 *   * Clear data  — empties the sitting's ingested data but keeps the shell,
 *                   returning it to the empty Upload state ("start from clean").
 *                   Single explicit confirm.
 *   * Delete sitting — removes the sitting AND all its data, irreversibly.
 *                   Gated behind a TYPED confirmation (type "delete") so it can
 *                   never fire on a stray click.
 *
 * Both call the provider, which (live) runs the SECURITY DEFINER RPC that
 * authorizes lead/admin and writes the audit row with the resolved user. After
 * a delete we navigate away (the sitting no longer exists); after a clear we
 * stay — the screen re-hydrates to its empty state.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProvider } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";

type Action = "clear" | "delete";

export function SittingDangerZone({ cycleId, uploaded }: { cycleId: string; uploaded: boolean }) {
  const [open, setOpen] = useState<Action | null>(null);

  return (
    <div className="hf-card" style={{ padding: "16px 18px", borderColor: H.line2, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Icon name="trash" size={14} color={H.ink2} />
        <span className="hf-h2" style={{ fontSize: 14 }}>Danger zone</span>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 220, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Clear this sitting&rsquo;s data</div>
          <div className="hf-sub" style={{ fontSize: 11.5 }}>
            Empties all ingested data (assessments, items, participants, responses, rollups) but keeps the sitting, so you can upload again from clean.
          </div>
          <div>
            <Button variant="ghost" onClick={() => setOpen("clear")} disabled={!uploaded}>
              Clear data
            </Button>
          </div>
        </div>
        <div style={{ flex: "1 1 240px", minWidth: 220, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: H.bad }}>Delete this sitting</div>
          <div className="hf-sub" style={{ fontSize: 11.5 }}>
            Removes the sitting and <strong>all</strong> its data across every table. This cannot be undone.
          </div>
          <div>
            <DangerButton onClick={() => setOpen("delete")}>Delete sitting</DangerButton>
          </div>
        </div>
      </div>

      {open === "clear" && (
        <ClearDialog cycleId={cycleId} onClose={() => setOpen(null)} />
      )}
      {open === "delete" && (
        <DeleteDialog cycleId={cycleId} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function ClearDialog({ cycleId, onClose }: { cycleId: string; onClose: () => void }) {
  const provider = useProvider();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await provider.clearSittingData(cycleId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t clear this sitting’s data.");
      setBusy(false);
    }
  };

  return (
    <Backdrop onClose={busy ? undefined : onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Mark kind="warn" size={18} />
        <span className="hf-h2">Clear this sitting&rsquo;s data?</span>
      </div>
      <div className="hf-sub" style={{ fontSize: 12.5, marginBottom: 18 }}>
        This empties every ingested row for this sitting and returns it to the Upload state. The sitting itself is kept. This is recorded in the audit log and cannot be undone.
      </div>
      {error && <DialogError>{error}</DialogError>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="pri" onClick={confirm} disabled={busy}>{busy ? "Clearing…" : "Clear data"}</Button>
      </div>
    </Backdrop>
  );
}

function DeleteDialog({ cycleId, onClose }: { cycleId: string; onClose: () => void }) {
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
      await provider.deleteSitting(cycleId);
      // The sitting is gone — leave the (now-dead) cycle screen.
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t delete this sitting.");
      setBusy(false);
    }
  };

  return (
    <Backdrop onClose={busy ? undefined : onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Mark kind="fail" size={18} />
        <span className="hf-h2">Delete this sitting?</span>
      </div>
      <div className="hf-sub" style={{ fontSize: 12.5, marginBottom: 14 }}>
        This permanently removes the sitting and <strong>all</strong> its data — assessments, items, participants, responses, rollups, scores and grades. It cannot be undone. The deletion is recorded in the audit log.
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
      {error && <DialogError>{error}</DialogError>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <DangerButton onClick={confirm} disabled={!armed || busy}>{busy ? "Deleting…" : "Delete sitting"}</DangerButton>
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

function DialogError({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: H.bad, marginBottom: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <Mark kind="fail" size={14} />
      <span>{children}</span>
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
