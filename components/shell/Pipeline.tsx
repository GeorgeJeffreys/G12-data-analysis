/**
 * Pipeline stepper: Ingest → Validate → Review → Adjustments → Score →
 * Boundaries → Grades → Export. Ported from design/hf.jsx (HPipeline). Appears on
 * every cycle screen.
 *
 * When a `cycleId` is supplied (and not `compact`), each stage is a navigable
 * link to that stage's screen, so the stepper doubles as cycle navigation.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { H, PIPELINE_STAGES } from "@/lib/ui/tokens";

/**
 * Map a pipeline stage index to its route. Several stages share a screen:
 * Ingest+Validate live on the ingest screen, and Score+Boundaries on the
 * boundaries screen, so those steps navigate to the shared page.
 */
export function stageHref(cycleId: string, index: number): string {
  const base = `/cycles/${cycleId}`;
  switch (index) {
    case 0: // Ingest
    case 1: // Validate
      return `${base}/ingest`;
    case 2: // Review
      return `${base}/review`;
    case 3: // Adjustments
      return `${base}/adjustments`;
    case 4: // Score
    case 5: // Boundaries
      return `${base}/boundaries`;
    case 6: // Grades
      return `${base}/grades`;
    case 7: // Export
      return `${base}/documents`;
    default:
      return base;
  }
}

export function Pipeline({
  active = 2,
  done,
  range,
  compact,
  cycleId,
}: {
  active?: number;
  done?: number;
  range?: [number, number];
  compact?: boolean;
  /** When set (and not compact), each stage links to its screen. */
  cycleId?: string;
}) {
  const doneIdx = done ?? active;
  const isDone = (i: number) => (range ? i < range[0] : i < doneIdx);
  const isNow = (i: number) => (range ? i >= range[0] && i <= range[1] : i === active);
  const clickable = !!cycleId && !compact;

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 6 }}>
      {PIPELINE_STAGES.map((s, i) => {
        const state = isDone(i) ? "done" : isNow(i) ? "now" : "next";
        const stepInner = (
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              style={{
                width: 21,
                height: 21,
                borderRadius: 999,
                flex: "0 0 auto",
                border: `1.5px solid ${state === "done" ? H.slate : state === "now" ? H.pink : H.line2}`,
                background: state === "done" ? H.slate : state === "now" ? H.pinkSoft : H.paper,
                color: state === "done" ? "#fff" : state === "now" ? H.pink : H.ink3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
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
                  fontSize: 12,
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
            style={{ textDecoration: "none", color: "inherit", borderRadius: 8, padding: "3px 5px", margin: "-3px -5px" }}
          >
            {stepInner}
          </Link>
        ) : (
          stepInner
        );

        return (
          <div key={s} style={{ display: "flex", alignItems: "center" }}>
            {step}
            {i < PIPELINE_STAGES.length - 1 && (
              <div
                style={{
                  width: compact ? 16 : 26,
                  height: 2,
                  background: isDone(i) ? H.slate : range && i >= range[0] && i < range[1] ? H.pink : H.line2,
                  margin: "0 9px",
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
