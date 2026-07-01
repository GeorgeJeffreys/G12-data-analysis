/**
 * StepIntro — a subtle "why this step matters" callout pinned at the top of each
 * Critical Path step. Presentational only: a light strip with a quiet pink left
 * accent (the same accent the stepper uses for the current step) and a small
 * "Why this step" label, so every step opens by explaining its purpose in one
 * consistent visual language. It states intent, not an alert — calm by design,
 * never competing with the page's data or its action.
 *
 * Rendered uniformly across the seven steps: the six per-sitting pages hand it to
 * `CycleShell` via the `intro` prop (so it always lands in the same slot, right
 * under the header/stepper and above the body); the year-level Awards page renders
 * it directly. One block per step — see the copy at each call site.
 */
import type { ReactNode } from "react";
import { H } from "@/lib/ui/tokens";

export function StepIntro({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      style={{
        margin: "14px 28px 2px",
        padding: "11px 15px",
        background: H.pinkSoft2,
        border: `1px solid ${H.line}`,
        borderRadius: 8,
        boxShadow: `inset 3px 0 0 ${H.pink}`,
      }}
    >
      <div
        className="hf-lbl"
        style={{ fontSize: 10, letterSpacing: "0.5px", color: H.pink, marginBottom: 4 }}
      >
        Why this step
      </div>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: H.ink2, maxWidth: 900 }}>
        {children}
      </p>
    </div>
  );
}
