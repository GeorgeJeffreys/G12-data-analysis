"use client";

/**
 * Error boundary for the whole cycle route (App Router `error.tsx`). Any render
 * or hydration error thrown inside `/cycles/[cycleId]/…` is caught here and
 * degrades to a usable message with recovery actions, instead of letting the
 * route's tree unmount to a blank white screen. Client-side only — App Router
 * error boundaries catch errors during client render and hydration.
 */
import { useEffect } from "react";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";

export default function CycleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the cause in the console for diagnosis (kept out of the UI).
    // eslint-disable-next-line no-console
    console.error("Cycle route error:", error);
  }, [error]);

  return (
    <Shell active="Cycles" crumb={[{ label: "Sittings", href: "/" }, { label: "Something went wrong" }]}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 32, maxWidth: 520, flex: 1 }}>
        <div>
          <div className="hf-lbl" style={{ color: H.ink3 }}>Cycle</div>
          <div className="hf-h1" style={{ marginTop: 4 }}>This page couldn’t be displayed</div>
        </div>
        <div className="hf-sub">
          An unexpected error interrupted this screen. You can try again, or go back to your cycles.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button onClick={reset} className="hf-btn pri">Try again</button>
          <a href="/" className="hf-btn ghost" style={{ textDecoration: "none" }}>Back to cycles</a>
        </div>
      </div>
    </Shell>
  );
}
