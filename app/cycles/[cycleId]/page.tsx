"use client";

/**
 * Screen 02 — Cycle entry. Opening a cycle no longer shows an in-between
 * "Pipeline Overview" summary (which mislabelled the stepper's current step).
 * Instead it lands straight on the cycle's current pipeline step — the next
 * incomplete action (`doNext.href`) — so the stepper's highlighted step always
 * matches the screen shown. Mock prior cycles (no detailed data) keep a small
 * informational page rather than bouncing.
 *
 * Hydration safety: SSR renders with the in-memory provider, while the browser
 * may mount the Supabase one, so the cycle data — and therefore which branch we
 * render — can differ between the server HTML and the client's first render.
 * We therefore render ONE stable placeholder on the server and on the first
 * client render, and only read the cycle to decide (redirect / mock / not-found)
 * AFTER mount. The "land on current step" decision stays a post-mount client
 * effect, never divergent render logic — so server and client always agree on
 * the initial output and hydration is clean for an empty or populated cycle.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";

export default function CycleEntry({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const router = useRouter();
  const cycle = useProviderData((p) => p.getCycle(cycleId), [cycleId]);

  // Gate every cycle-data-dependent branch behind mount, so the server and the
  // first client render produce byte-identical output (the placeholder below).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Real cycles redirect to their current pipeline step. Mock priors have no
  // step to land on (doNext just points home), so we never redirect them. The
  // decision runs only after mount, as a client-side effect.
  const target = mounted && cycle && !cycle.mock ? cycle.doNext.href : null;
  useEffect(() => {
    if (target && target !== `/cycles/${cycleId}`) router.replace(target);
  }, [target, cycleId, router]);

  // First paint (server + hydration): a stable placeholder identical on both
  // sides. Real cycles also keep it on screen while the redirect effect runs.
  if (!mounted) return <Landing />;

  if (!cycle) {
    return (
      <Shell crumb={[{ label: "Cycles", href: "/" }, { label: "Not found" }]}>
        <div style={{ padding: 32 }} className="hf-sub">That cycle doesn’t exist.</div>
      </Shell>
    );
  }

  // Mock prior cycle — a locked, illustrative record with no detailed data.
  if (cycle.mock) {
    return (
      <Shell active="Cycles" crumb={[{ label: "Cycles", href: "/" }, { label: cycle.name }]}>
        <div style={{ display: "flex", flexDirection: "column", padding: "26px 32px", gap: 14, flex: 1 }}>
          <div>
            <div className="hf-lbl" style={{ color: H.ink3 }}>Locked cycle</div>
            <div className="hf-h1" style={{ marginTop: 4 }}>{cycle.name} cycle</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>
              {cycle.participants.toLocaleString()} participants · {cycle.assessmentCount} assessments · started {cycle.startedAt}
            </div>
          </div>
          <div className="hf-card" style={{ padding: "18px 20px", maxWidth: 560 }}>
            <div className="hf-sub">{cycle.doNext.body}</div>
          </div>
        </div>
      </Shell>
    );
  }

  // Real cycle — redirecting to the current step; keep the placeholder meanwhile.
  return <Landing />;
}

/** Stable, provider-independent placeholder shown during SSR/hydration and while
 *  the redirect to the current step is in flight. */
function Landing() {
  return (
    <div
      style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", color: H.ink3, fontSize: 13 }}
    >
      Opening cycle…
    </div>
  );
}
