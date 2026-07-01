"use client";

/**
 * Screen — Incident adjustments · Review (02b, grade-bearing half).
 *
 * A view/commit deep-link into the SAME config-driven surface the critical-path
 * step renders (`components/incidents/IncidentReviewSurface`), so the two never
 * drift. For each student it shows the BASE engine score, the cumulative (capped,
 * add-only) incident mark change, and the ADJUSTED total — always decomposable as
 * `base + adjustment`. Unclassified / errored / unmatched incidents grant ZERO and
 * are surfaced for manual attention.
 *
 * Viewable by ALL roles; only an admin may COMMIT/apply (`review.canApply`).
 * Import is owned by the step itself — this deep-link is view + commit only.
 */
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { CycleShell } from "@/components/shell/CycleShell";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { IncidentReviewSurface } from "@/components/incidents/IncidentReviewSurface";

export default function IncidentReviewPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";

  const shellProps = {
    cycleId,
    cycleName,
    page: "Incident adjustments · Review",
    stageIndex: 5,
    actions: (
      <Link href={`/cycles/${cycleId}/adjustments`}>
        <Button variant="ghost" title="Back to the incident step">Back to incident adjustments</Button>
      </Link>
    ),
    primary: (
      <Link href={`/cycles/${cycleId}/score`}>
        <Button variant="pri" title="Continue to scoring">Continue<Icon name="arrow" color="#fff" /></Button>
      </Link>
    ),
  };

  return (
    <CycleShell {...shellProps}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="hf-pad" style={{ padding: "22px 28px 0" }}>
          <div className="hf-h1">Incident adjustments · Review</div>
          <div className="hf-sub" style={{ marginTop: 7, maxWidth: 680 }}>
            Team sign-off surface. Each student’s <b>base</b> engine score, the cumulative
            <b> incident mark change</b> (capped, add-only), and the <b>adjusted</b> total —
            decomposable at all times. Base scores are untouched; only an admin may commit.
          </div>
        </div>
        <IncidentReviewSurface cycleId={cycleId} />
      </div>
    </CycleShell>
  );
}
