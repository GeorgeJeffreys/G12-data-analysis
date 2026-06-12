"use client";

/**
 * CycleShell — the single canonical chrome every cycle page renders, so the
 * breadcrumb, cycle tab bar, pipeline stepper, subject chips and primary action
 * never move or change form between pages. Pages supply only their body (plus a
 * primary action, optional subject chips, and a single consolidated alerts area);
 * the shell fixes everything else in place.
 *
 * Order, always identical:
 *   breadcrumb (G12++ › Cycles › <cycle> › <page>)
 *   cycle tab bar   — Pipeline · Diagnostics · Audit log · Certificates
 *   pipeline stepper — pipeline-area pages only, with the top-right primary action
 *   subject chip row — pipeline per-subject pages only
 *   alerts area      — one predictable place per page for every notice
 *   page body
 *
 * Diagnostics / Audit / Certificates are reached via the tab bar and show no
 * stepper; their primary action (if any) sits top-right in the header.
 */
import type { ReactNode } from "react";
import { H } from "@/lib/ui/tokens";
import { Shell } from "./Shell";
import { cyclesSubnav } from "@/lib/ui/subnav";
import { Mark, type MarkKind } from "@/components/ui/icons";

export type CycleArea = "pipeline" | "diagnostics" | "audit" | "documents";

export function CycleShell({
  cycleId,
  cycleName,
  page,
  area = "pipeline",
  stageIndex,
  done,
  range,
  primary,
  actions,
  subjectTabs,
  alerts,
  children,
}: {
  cycleId: string;
  cycleName: string;
  /** Final breadcrumb + names the current page. Omit on the Pipeline overview. */
  page?: string;
  area?: CycleArea;
  stageIndex?: number;
  done?: number;
  range?: [number, number];
  /** The single next-step button, pinned top-right on every page. */
  primary?: ReactNode;
  /** Optional secondary header actions (e.g. exports). Kept off the primary slot. */
  actions?: ReactNode;
  /** Subject/scope chip row — pipeline per-subject pages only. */
  subjectTabs?: ReactNode;
  /** One consolidated alerts area, rendered directly under the header/stepper. */
  alerts?: ReactNode;
  children: ReactNode;
}) {
  const isPipeline = area === "pipeline";
  const crumb = page
    ? [{ label: "Cycles", href: "/" }, { label: cycleName, href: `/cycles/${cycleId}` }, { label: page }]
    : [{ label: "Cycles", href: "/" }, { label: cycleName }];

  return (
    <Shell
      active="Cycles"
      crumb={crumb}
      subnav={cyclesSubnav(cycleId, area)}
      stageIndex={isPipeline ? (stageIndex ?? 0) : undefined}
      done={done}
      range={range}
      cycleId={cycleId}
      // pipeline pages pin the primary in the stepper row; other areas in the header
      stageAction={isPipeline ? primary : undefined}
      actions={
        isPipeline ? actions : (
          (actions || primary) ? <>{actions}{primary}</> : undefined
        )
      }
    >
      {subjectTabs}
      {alerts}
      {children}
    </Shell>
  );
}

/**
 * One consistent alert row for the consolidated alerts area. Matches the existing
 * Provisional/Lock banners so a page's notices read as a single stack.
 */
export function Alert({
  tone = "warn",
  children,
  action,
}: {
  tone?: "warn" | "good" | "bad" | "info";
  children: ReactNode;
  action?: ReactNode;
}) {
  const bg = tone === "good" ? H.goodSoft : tone === "bad" ? H.badSoft : tone === "info" ? H.tint : H.warnSoft;
  const border = tone === "good" ? H.good : tone === "bad" ? H.bad : tone === "info" ? H.line : H.warn;
  const kind: MarkKind = tone === "good" ? "pass" : tone === "bad" ? "fail" : "warn";
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 28px", background: bg, borderBottom: `1px solid ${border}55`, flexWrap: "wrap" }}>
      <Mark kind={kind} size={15} />
      <span style={{ fontSize: 12, color: H.ink, flex: 1, minWidth: 240 }}>{children}</span>
      {action}
    </div>
  );
}
