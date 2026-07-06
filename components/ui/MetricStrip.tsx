"use client";

/**
 * MetricStrip — the single, shared metrics band every step page pins directly
 * above its primary data surface. It replaces the stacked, padded, before→after
 * stat blocks that used to push the table into the bottom of the viewport.
 *
 * The core rule it enforces (see prompt-20): **one value, not two — a delta only
 * when something actually changed it.**
 *   - Each metric shows a single live value (its "after" figure).
 *   - When a removal has moved a metric off its baseline, a compact muted token
 *     ("was 251") renders next to the live value — never the full-width
 *     `251 → 248` form.
 *   - Structural counts that never move on a participant removal (Items, Major
 *     elements, Sub-elements, the D1·D2·D3 split) carry no delta at all: pass no
 *     `was` and they render as a plain single value.
 *
 * The delta token is text ("was 251"), not colour, so it is legible without
 * relying on the accent hue. The strip is a single non-wrapping row on wide
 * viewports; a trailing `right` slot carries the page's inline controls (e.g.
 * "By element & status", "Show breakdown", a zoom control).
 */
import type { ReactNode } from "react";
import { H } from "@/lib/ui/tokens";

export interface MetricDatum {
  /** Stable key (defaults to `label`). */
  key?: string;
  /** Small upper-case label under/over the value. */
  label: string;
  /** The live / "after" value — the single number shown. */
  value: number | string;
  /** Appended to the value and the delta token (e.g. "%"). */
  suffix?: string;
  /**
   * The pre-removal ("before") value. A muted "was …" token renders ONLY when it
   * is a number that differs from `value`; equal or omitted → single value, no
   * delta. Non-numeric metrics never take a `was`.
   */
  was?: number;
  /** Bigger type for the headline metrics (Records / Participants). */
  big?: boolean;
  /** Force the value colour to the "bad" tone (e.g. a non-zero excluded count). */
  bad?: boolean;
  /** A tiny muted sub-line under the value (e.g. "3 participants"). */
  hint?: ReactNode;
}

/** True when a numeric `was` differs from the (numeric) live value. */
function changed(m: MetricDatum): boolean {
  return typeof m.was === "number" && typeof m.value === "number" && Math.abs(m.was - m.value) > 1e-9;
}

function Metric({ m, first }: { m: MetricDatum; first: boolean }) {
  const isChanged = changed(m);
  const valColor = m.bad ? H.bad : isChanged ? H.pink : H.ink;
  const size = m.big ? 20 : 16;
  const val = typeof m.value === "number" ? m.value.toLocaleString() : m.value;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "0 16px",
        borderLeft: first ? "none" : `1px solid ${H.line}`,
      }}
    >
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{m.label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <span className="hf-mono" style={{ fontSize: size, fontWeight: 700, color: valColor }}>
          {val}{m.suffix}
        </span>
        {isChanged && (
          <span
            className="hf-mono"
            style={{ fontSize: 10.5, fontWeight: 600, color: H.ink3, whiteSpace: "nowrap" }}
            title={`Before this session's removals: ${m.was!.toLocaleString()}${m.suffix ?? ""}`}
          >
            was {m.was!.toLocaleString()}{m.suffix}
          </span>
        )}
      </div>
      {m.hint != null && <span className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>{m.hint}</span>}
    </div>
  );
}

export function MetricStrip({
  metrics,
  lead,
  note,
  right,
}: {
  metrics: MetricDatum[];
  /** Optional leading label block (e.g. a small strip title). */
  lead?: ReactNode;
  /** Quiet inline state shown after the metrics (e.g. "0 excluded"). */
  note?: ReactNode;
  /** Trailing controls, right-aligned (toggles, zoom …). */
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        borderBottom: `1px solid ${H.line2}`,
        background: H.canvas,
        padding: "10px 24px",
      }}
    >
      {lead}
      {metrics.map((m, i) => (
        <Metric key={m.key ?? m.label} m={m} first={i === 0 && !lead} />
      ))}
      {note != null && (
        <span className="hf-mono" style={{ fontSize: 11, color: H.ink3, paddingLeft: 4 }}>{note}</span>
      )}
      <div style={{ flex: 1, minWidth: 8 }} />
      {right}
    </div>
  );
}
