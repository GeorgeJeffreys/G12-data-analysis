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
import { LockStatus } from "./LockBanner";
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
      status={<LockStatus cycleId={cycleId} />}
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
 * One consistent alert row for the consolidated alerts area. Each notice is a
 * dense single line — small glyph, message, inline action — on a uniform light
 * strip, so several stacked notices read as one compact, scannable area rather
 * than a run of chunky full-width blocks. Tone gives a quiet visual distinction
 * (a coloured left accent + glyph): `warn`/`bad` mark a must-act-before-sign-off
 * notice, `info` a calm informational one. Renders nothing when not shown, so an
 * empty alerts area leaves no stray strip.
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
  // Uniform strip + a quiet coloured left accent per tone — no loud per-row fill,
  // so the notices group into a single area instead of competing blocks.
  const accent = tone === "good" ? H.good : tone === "bad" ? H.bad : tone === "info" ? H.line2 : H.warn;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 28px",
        background: H.canvas,
        borderBottom: `1px solid ${H.line2}`,
        boxShadow: `inset 3px 0 0 ${accent}`,
      }}
    >
      <AlertGlyph tone={tone} />
      <span style={{ fontSize: 12, color: H.ink, flex: 1, minWidth: 220, lineHeight: 1.4 }}>{children}</span>
      {action && <span style={{ flex: "0 0 auto", whiteSpace: "nowrap" }}>{action}</span>}
    </div>
  );
}

/**
 * The leading glyph for an Alert row. Must-act tones reuse the shared Mark
 * (warn/fail/pass); the calm `info` tone shows a muted "i" so an informational
 * notice never reads as an alarm next to a must-act one.
 */
function AlertGlyph({ tone }: { tone: "warn" | "good" | "bad" | "info" }) {
  if (tone === "info") {
    return (
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          flex: "0 0 auto",
          borderRadius: 999,
          border: `1px solid ${H.line2}`,
          color: H.ink3,
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        i
      </span>
    );
  }
  const kind: MarkKind = tone === "good" ? "pass" : tone === "bad" ? "fail" : "warn";
  return <Mark kind={kind} size={14} />;
}
