"use client";

/**
 * StepIntro — the "why this step matters" note pinned at the top of each Critical
 * Path step. It is a *collapsible one-liner*: by default it renders as a single
 * compact "Why this step ⌄" control (a quiet pink left accent, the same accent the
 * stepper uses for the current step) so it never owns a full band of the page on
 * every visit. Clicking / pressing it reveals the full paragraph; collapsing it
 * again hides it. The open/closed state persists in `localStorage` (one shared
 * key across every step) so a returning user who has already read the intros is
 * not re-reading them — they stay collapsed until deliberately re-opened.
 *
 * Rendered uniformly across the steps: the per-sitting pages hand it to
 * `CycleShell` via the `intro` prop (so it always lands in the same slot, right
 * under the header/stepper and above the body); the year-level Awards page renders
 * it directly. One block per step — see the copy at each call site.
 *
 * Presentational only; keyboard-operable (a real <button> with aria-expanded), and
 * the collapsed/expanded affordance is a text label + rotating chevron, never
 * colour alone.
 */
import { useEffect, useState, type ReactNode } from "react";
import { H } from "@/lib/ui/tokens";
import { Icon } from "@/components/ui/icons";

/** One shared key: the "why this step" control reads the same way on every step,
 *  so collapsing it once keeps it collapsed everywhere until re-opened. */
const LS_KEY = "g12:whyStep:open";

export function StepIntro({ children }: { children: ReactNode }) {
  // Default collapsed. We resolve the persisted state after mount (localStorage is
  // client-only) to avoid an SSR/first-paint hydration mismatch.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(LS_KEY) === "1");
    } catch {
      /* localStorage unavailable — stay collapsed */
    }
  }, []);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(LS_KEY, next ? "1" : "0");
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  return (
    <div
      role="note"
      style={{
        margin: "8px 28px 0",
        borderRadius: 8,
        background: open ? H.pinkSoft2 : "transparent",
        boxShadow: open ? `inset 3px 0 0 ${H.pink}` : "none",
        border: open ? `1px solid ${H.line}` : "1px solid transparent",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="hf-lbl"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: open ? "8px 12px 4px" : "5px 8px",
          margin: 0,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontSize: 10,
          letterSpacing: "0.5px",
          color: H.pink,
          font: "inherit",
          fontWeight: 700,
        }}
      >
        <span style={{ boxShadow: open ? "none" : `inset 3px 0 0 ${H.pink}`, paddingLeft: open ? 0 : 8, borderRadius: 2 }}>
          Why this step
        </span>
        <span style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <Icon name="chev" size={12} color={H.pink} />
        </span>
      </button>
      {open && (
        <p style={{ margin: 0, padding: "0 15px 11px 15px", fontSize: 12.5, lineHeight: 1.55, color: H.ink2, maxWidth: 900 }}>
          {children}
        </p>
      )}
    </div>
  );
}
