"use client";

/**
 * Account menu on the bottom-left nav-rail avatar. Clicking the avatar opens a
 * small popover (above/right of the avatar so the rail doesn't clip it) showing
 * the signed-in user's email + role and a Sign out action.
 *
 * Email comes from the Supabase auth session and role from the provider's
 * current user (which the SupabaseDataProvider derives from `memberships` — the
 * same source the AccessGate uses). In the in-memory demo there's no session, so
 * it degrades to the user's name + role and still offers sign out.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { H } from "@/lib/ui/tokens";
import { useProvider } from "@/lib/data/context";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/data/types";

const SUPABASE = process.env.NEXT_PUBLIC_DATA_PROVIDER === "supabase";

function roleLabel(role: Role): string {
  return role === "lead_admin" ? "Lead admin" : role === "reviewer" ? "Reviewer" : "Viewer";
}

export function AccountMenu() {
  const provider = useProvider();
  const user = provider.getCurrentUser();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Email from the Supabase session (Supabase mode only).
  useEffect(() => {
    if (!SUPABASE) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await createClient().auth.getUser();
        if (alive) setEmail(data.user?.email ?? null);
      } catch {
        /* no session — degrade to name */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Dismiss on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const signOut = async () => {
    setBusy(true);
    try {
      if (SUPABASE) await createClient().auth.signOut();
    } catch {
      /* ignore — still send them to sign-in */
    }
    router.push("/signin");
    router.refresh();
  };

  const primary = email ?? user.name;
  const secondary = roleLabel(user.role);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${user.name} · ${secondary}`}
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          background: open ? H.pink : H.tint2,
          color: open ? "#fff" : H.ink2,
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {user.initials}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            left: "calc(100% + 10px)",
            bottom: 0,
            width: 244,
            background: H.paper,
            border: `1px solid ${H.line2}`,
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(31,42,49,.24)",
            padding: 6,
            zIndex: 200,
          }}
        >
          <div style={{ padding: "10px 12px 8px" }}>
            <div className="hf-lbl" style={{ fontSize: 9 }}>Signed in</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: H.ink, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={primary}>
              {primary}
            </div>
            <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 2 }}>{secondary}</div>
          </div>
          <div style={{ height: 1, background: H.line, margin: "4px 0" }} />
          <button
            onClick={signOut}
            disabled={busy}
            role="menuitem"
            className="hf-btn ghost"
            style={{ width: "100%", justifyContent: "flex-start", fontSize: 12.5, color: H.bad, padding: "9px 12px" }}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
