"use client";

/**
 * Left icon nav rail (ported from design/hf.jsx HRail). Light cool-neutral rail;
 * the magenta accent appears only on the brand mark and the active item. The
 * current-user avatar at the foot reflects the mocked Lead user.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { H } from "@/lib/ui/tokens";
import { useProvider } from "@/lib/data/context";

const NAV = [
  { k: "Cycles", href: "/", d: "M3 4h10v3H3zM3 9h10v3H3z" },
  { k: "Assessments", href: "/", d: "M4 3h6l2 2v8H4z" },
  { k: "Audit log", href: "/", d: "M4 3h8v10H4zM6 6h4M6 8.5h4" },
  { k: "Settings", href: "/settings", d: "M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" },
];

export function NavRail() {
  const pathname = usePathname();
  const provider = useProvider();
  const user = provider.getCurrentUser();
  // Cycles and Settings are the real destinations in this build.
  const activeKey = pathname.startsWith("/settings") ? "Settings" : "Cycles";

  return (
    <nav
      aria-label="Primary"
      style={{
        width: 64,
        flex: "0 0 auto",
        background: H.tint,
        borderRight: `1px solid ${H.line2}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 0",
        gap: 5,
      }}
    >
      <Link
        href="/"
        aria-label="G12++ home"
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: H.pink,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
          boxShadow: "0 1px 4px rgba(193,44,104,.35)",
          textDecoration: "none",
        }}
      >
        <span style={{ fontFamily: "var(--font-script)", fontSize: 22, lineHeight: 1, marginTop: 4 }}>A</span>
      </Link>
      {NAV.map((it) => {
        const on = it.k === activeKey;
        return (
          <Link
            key={it.k}
            href={it.href}
            title={it.k}
            aria-label={it.k}
            aria-current={on ? "page" : undefined}
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: on ? H.pinkSoft : "transparent",
              color: on ? H.pink : H.ink3,
            }}
          >
            <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <path d={it.d} />
            </svg>
          </Link>
        );
      })}
      <div style={{ flex: 1 }} />
      <div
        title={`${user.name} · ${user.role === "lead_admin" ? "Lead" : user.role}`}
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          background: H.tint2,
          color: H.ink2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {user.initials}
      </div>
    </nav>
  );
}
