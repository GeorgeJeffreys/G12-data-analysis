/**
 * Pipeline stepper: Upload → Clean → Raw scores → Question review → Diagnostics →
 * Essay marks → Technical adjustments → Score → Cut scores → Grades → Export.
 * Ported from design/hf.jsx (HPipeline). Appears on every cycle screen. (Raw data
 * was merged into Clean; Diagnostics and Essay marks are now steps.)
 *
 * When a `cycleId` is supplied (and not `compact`), each stage is a navigable
 * link to that stage's screen, so the stepper doubles as cycle navigation.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { H, PIPELINE_STAGES } from "@/lib/ui/tokens";
import { stageRoute } from "@/lib/data/pipeline-route";

/**
 * Map a pipeline stage index to its route (11-stage pipeline). Shared with the
 * provider's current-step resolver via `stageRoute` so navigation and the
 * "land on current step" logic can never disagree.
 */
export const stageHref = stageRoute;

export function Pipeline({
  active = 2,
  compact,
  cycleId,
}: {
  active?: number;
  compact?: boolean;
  /** When set (and not compact), each stage links to its screen. */
  cycleId?: string;
}) {
  // Completion is derived solely from the active step: for a sitting on step N,
  // every step before it is complete, N is current, and the rest are pending.
  // There is no separate "done" override to fall out of sync with the step list.
  const isDone = (i: number) => i < active;
  const isNow = (i: number) => i === active;
  const clickable = !!cycleId && !compact;

  return (
    // Single line — never wraps. The 10 steps + connectors are tightened so the
    // whole stepper (plus the row's primary action) sits on one row; on a narrow
    // viewport it scrolls horizontally inside its own region rather than wrapping.
    <div style={{ display: "flex", alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
      {PIPELINE_STAGES.map((s, i) => {
        const state = isDone(i) ? "done" : isNow(i) ? "now" : "next";
        const stepInner = (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 19,
                height: 19,
                borderRadius: 999,
                flex: "0 0 auto",
                border: `1.5px solid ${state === "done" ? H.slate : state === "now" ? H.pink : H.line2}`,
                background: state === "done" ? H.slate : state === "now" ? H.pinkSoft : H.paper,
                color: state === "done" ? "#fff" : state === "now" ? H.pink : H.ink3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9.5,
                fontWeight: 700,
              }}
              className="hf-mono"
            >
              {state === "done" ? (
                <svg width="10" height="10" viewBox="0 0 12 12">
                  <path d="M2.5 6.2l2.2 2.2L9.5 3.5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            {!compact && (
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: state === "now" ? 700 : 500,
                  color: state === "next" ? H.ink3 : H.ink,
                  whiteSpace: "nowrap",
                }}
              >
                {s}
              </span>
            )}
          </div>
        );

        const step: ReactNode = clickable ? (
          <Link
            href={stageHref(cycleId!, i)}
            title={`Go to ${s}`}
            aria-label={`Go to ${s}`}
            className="hf-step"
            style={{ textDecoration: "none", color: "inherit", borderRadius: 7, padding: "3px 4px", margin: "-3px -4px", flex: "0 0 auto" }}
          >
            {stepInner}
          </Link>
        ) : (
          stepInner
        );

        return (
          <div key={s} style={{ display: "flex", alignItems: "center", flex: "0 0 auto" }}>
            {step}
            {i < PIPELINE_STAGES.length - 1 && (
              <div
                style={{
                  width: compact ? 16 : 13,
                  height: 2,
                  background: isDone(i) ? H.slate : H.line2,
                  margin: compact ? "0 9px" : "0 5px",
                  flex: "0 0 auto",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
