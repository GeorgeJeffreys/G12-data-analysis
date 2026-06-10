"use client";

/**
 * App frame (ported from design/hf.jsx HShell): left nav rail + top bar
 * (G12++ wordmark, breadcrumb, contextual actions) and an optional pipeline
 * stepper row with a stage action. Cycle screens pass `stageIndex`; the
 * dashboard omits it.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { H } from "@/lib/ui/tokens";
import { NavRail } from "./NavRail";
import { Pipeline } from "./Pipeline";

export interface Crumb {
  label: string;
  href?: string;
}

export function Shell({
  crumb,
  actions,
  stageIndex,
  done,
  range,
  stageAction,
  children,
}: {
  crumb: Crumb[];
  actions?: ReactNode;
  stageIndex?: number;
  done?: number;
  range?: [number, number];
  stageAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", height: "100vh", background: H.canvas }}>
      <NavRail />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        {/* top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 54,
            flex: "0 0 auto",
            borderBottom: `1px solid ${H.line}`,
            padding: "0 24px",
            gap: 14,
            background: H.paper,
          }}
        >
          <Link href="/" style={{ fontWeight: 800, fontSize: 15, color: H.pink, letterSpacing: "-.3px", textDecoration: "none" }}>
            G12<span style={{ color: H.ink }}>++</span>
          </Link>
          <span style={{ width: 1, height: 20, background: H.line2 }} />
          <nav aria-label="Breadcrumb" className="hf-sub" style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            {crumb.map((c, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                {i > 0 && <span style={{ color: H.ink3 }}>›</span>}
                {c.href ? (
                  <Link href={c.href} style={{ color: "inherit", textDecoration: "none", whiteSpace: "nowrap" }}>
                    {c.label}
                  </Link>
                ) : (
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
          {actions}
        </div>

        {/* pipeline row */}
        {stageIndex != null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flex: "0 0 auto",
              borderBottom: `1px solid ${H.line}`,
              padding: "9px 24px",
              background: H.canvas,
              gap: 16,
              minHeight: 56,
            }}
          >
            <Pipeline active={stageIndex} done={done} range={range} />
            <div style={{ flex: 1 }} />
            {stageAction}
          </div>
        )}

        {/* content */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
