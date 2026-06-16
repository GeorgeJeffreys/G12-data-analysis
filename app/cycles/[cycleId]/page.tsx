"use client";

/**
 * Screen 02 — Cycle entry. Opening a cycle no longer shows an in-between
 * "Pipeline Overview" summary (which mislabelled the stepper's current step).
 * Instead it lands straight on the cycle's current pipeline step — the next
 * incomplete action (`doNext.href`) — so the stepper's highlighted step always
 * matches the screen shown. Mock prior cycles (no detailed data) keep a small
 * informational page rather than bouncing.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";

export default function CycleEntry({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const router = useRouter();
  const cycle = useProviderData((p) => p.getCycle(cycleId), [cycleId]);

  // Real cycles redirect to their current pipeline step. Mock priors have no
  // step to land on (doNext just points home), so we never redirect them.
  const target = cycle && !cycle.mock ? cycle.doNext.href : null;
  useEffect(() => {
    if (target && target !== `/cycles/${cycleId}`) router.replace(target);
  }, [target, cycleId, router]);

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

  // Real cycle — redirecting to the current step; render nothing meanwhile.
  return null;
}
