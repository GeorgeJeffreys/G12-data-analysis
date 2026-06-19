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
 *   cycle tab bar   — Pipeline · Audit log · Certificates
 *   pipeline stepper — pipeline-area pages only, with the top-right primary action
 *   subject chip row — pipeline per-subject pages only
 *   alerts area      — one predictable place per page for every notice
 *   page body
 *
 * Audit / Certificates are reached via the tab bar and show no stepper; their
 * primary action (if any) sits top-right in the header. (Diagnostics is now a
 * pipeline step, not a tab.)
 */
import { useState, type ReactNode } from "react";
import { H } from "@/lib/ui/tokens";
import { Shell } from "./Shell";
import { LockStatus } from "./LockBanner";
import { cyclesSubnav } from "@/lib/ui/subnav";
import { Icon, Mark, type MarkKind } from "@/components/ui/icons";

export type CycleArea = "pipeline" | "audit" | "documents";

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

export type AlertTone = "warn" | "good" | "bad" | "info";

/**
 * One notice for the consolidated alerts area, as data rather than markup, so
 * `AlertStack` can count notices and collapse them into a single compact line.
 * `message` and `action` are kept verbatim from the old per-page banners.
 */
export type Notice = {
  /** Stable key for the row. */
  key: string;
  /** Quiet tone — `warn`/`bad` = must-act before sign-off; `info` = calm. */
  tone?: AlertTone;
  /** The notice text. */
  message: ReactNode;
  /** Optional inline action link/button. */
  action?: ReactNode;
};

/**
 * The single compact alert area shared by every pipeline page. Pages hand it a
 * list of notices; it stays out of the way:
 *  - 0 notices  → renders nothing (no stray strip).
 *  - 1 notice   → the dense single-line `Alert` strip (already ~one line).
 *  - 2+ notices → a single collapsed summary line ("3 notices · 2 need action
 *    before sign-off") that expands on click to the full list of `Alert` rows,
 *    each keeping its message and inline action. This replaces the old stack of
 *    full-width banners that dominated the Grades page.
 *
 * The summary's glyph + left accent are warn-toned only when something must be
 * acted on before sign-off; otherwise it stays calm — a quiet distinction, no
 * shouting.
 */
export function AlertStack({ notices }: { notices: Notice[] }) {
  const [open, setOpen] = useState(false);
  const items = notices.filter(Boolean);
  if (items.length === 0) return null;

  if (items.length === 1) {
    const n = items[0]!;
    return <Alert tone={n.tone} action={n.action}>{n.message}</Alert>;
  }

  const mustAct = items.filter((n) => n.tone === "warn" || n.tone === "bad").length;
  const accent = mustAct > 0 ? H.warn : H.line2;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          width: "100%",
          padding: "7px 28px",
          background: H.canvas,
          border: "none",
          borderBottom: `1px solid ${H.line2}`,
          boxShadow: `inset 3px 0 0 ${accent}`,
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <AlertGlyph tone={mustAct > 0 ? "warn" : "info"} />
        <span style={{ fontSize: 12, color: H.ink, fontWeight: 600 }}>{items.length} notices</span>
        {mustAct > 0 && (
          <span style={{ fontSize: 11.5, color: H.warn }}>
            · {mustAct} need{mustAct === 1 ? "s" : ""} action before sign-off
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: H.ink3, whiteSpace: "nowrap" }}>
          {open ? "Hide" : "Show"}
          <span style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
            <Icon name="chev" size={12} color={H.ink3} />
          </span>
        </span>
      </button>
      {open &&
        items.map((n) => (
          <Alert key={n.key} tone={n.tone} action={n.action}>
            {n.message}
          </Alert>
        ))}
    </div>
  );
}

/**
 * One consistent alert row for the consolidated alerts area. Each notice is a
 * dense single line — small glyph, message, inline action — on a uniform light
 * strip, so several stacked notices read as one compact, scannable area rather
 * than a run of chunky full-width blocks. Tone gives a quiet visual distinction
 * (a coloured left accent + glyph): `warn`/`bad` mark a must-act-before-sign-off
 * notice, `info` a calm informational one. Renders nothing when not shown, so an
 * empty alerts area leaves no stray strip. Usually composed via `AlertStack`,
 * which collapses several notices into one compact line.
 */
export function Alert({
  tone = "warn",
  children,
  action,
}: {
  tone?: AlertTone;
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
function AlertGlyph({ tone }: { tone: AlertTone }) {
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
