"use client";

/**
 * Sign-in (invite-only, Microsoft). MOCK: no real OAuth — "Sign in with
 * Microsoft" takes you straight into the app. The access-denied state lives at
 * /access-denied for unprovisioned accounts.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { H } from "@/lib/ui/tokens";
import { EntryFrame, MSLogo } from "@/components/entry/EntryFrame";
import { Icon } from "@/components/ui/icons";

export default function SignInPage() {
  const router = useRouter();
  return (
    <EntryFrame>
      <div style={{ width: 380 }}>
        <div className="hf-h1" style={{ fontSize: 24 }}>Sign in</div>
        <div className="hf-sub" style={{ marginTop: 8, marginBottom: 26, fontSize: 13.5 }}>
          G12++ is invite-only. Use the Microsoft account your G12 lead added.
        </div>

        <button
          className="hf-btn"
          style={{ width: "100%", justifyContent: "center", padding: 13, fontSize: 14, gap: 10, background: H.paper, color: H.ink, border: `1px solid ${H.line2}` }}
          onClick={() => router.push("/")}
        >
          <MSLogo s={18} />
          Sign in with Microsoft
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0" }}>
          <div style={{ flex: 1, height: 1, background: H.line }} />
          <span className="hf-sub" style={{ fontSize: 11 }}>invite-only</span>
          <div style={{ flex: 1, height: 1, background: H.line }} />
        </div>

        <div className="hf-card" style={{ padding: "14px 16px", background: H.tint, display: "flex", gap: 11, alignItems: "flex-start" }}>
          <Icon name="lock" size={16} color={H.ink2} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>No account yet?</div>
            <div className="hf-sub" style={{ fontSize: 12, marginTop: 3 }}>
              Access is granted by a G12 lead. Ask them to invite your Microsoft email, then sign in here.
            </div>
          </div>
        </div>
        <div className="hf-sub" style={{ fontSize: 11, marginTop: 22, textAlign: "center" }}>
          Mocked Microsoft Entra ID ·{" "}
          <Link href="/access-denied" style={{ color: H.ink3 }}>
            preview access-denied
          </Link>
        </div>
      </div>
    </EntryFrame>
  );
}
