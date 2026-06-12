"use client";

/**
 * Shared assessment / scope selector — the single canonical chip-tab row that
 * every cycle screen places directly under the breadcrumb (Review, Diagnostics,
 * Boundaries, Distinction…). One style, one position, so the sub-menu never
 * drifts between screens.
 *
 * Each tab either links somewhere (`href`) or drives local state (`onSelect`).
 * `right` slots a trailing control (e.g. a ZoomControl) on the far side of the row.
 */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { H } from "@/lib/ui/tokens";

export interface AssessmentTab {
  id: string;
  label: string;
  /** Right-to-left assessment (Arabic) — shows a small RTL marker. */
  rtl?: boolean;
  /** When set, the tab is a link instead of a state toggle. */
  href?: string;
}

export function AssessmentTabs({
  tabs,
  activeId,
  onSelect,
  right,
}: {
  tabs: AssessmentTab[];
  activeId: string;
  onSelect?: (id: string) => void;
  right?: ReactNode;
}) {
  const tabStyle = (on: boolean): CSSProperties => ({
    padding: "13px 15px",
    fontSize: 13,
    fontWeight: on ? 700 : 500,
    color: on ? H.pink : H.ink2,
    borderBottom: `3px solid ${on ? H.pink : "transparent"}`,
    background: "transparent",
    border: "none",
    borderBottomWidth: 3,
    borderBottomStyle: "solid",
    borderBottomColor: on ? H.pink : "transparent",
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
  });

  return (
    <div style={{ display: "flex", alignItems: "center", flex: "0 0 auto", borderBottom: `1px solid ${H.line}`, padding: "0 24px", gap: 4, background: H.paper, overflowX: "auto" }}>
      {tabs.map((t) => {
        const on = t.id === activeId;
        const inner = (
          <>
            {t.label}
            {t.rtl && <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 6 }}>RTL</span>}
          </>
        );
        return t.href ? (
          <Link key={t.id} href={t.href} style={tabStyle(on)}>{inner}</Link>
        ) : (
          <button key={t.id} onClick={() => onSelect?.(t.id)} style={tabStyle(on)}>{inner}</button>
        );
      })}
      {right && (
        <>
          <div style={{ flex: 1, minWidth: 8 }} />
          <span style={{ paddingRight: 4 }}>{right}</span>
        </>
      )}
    </div>
  );
}
