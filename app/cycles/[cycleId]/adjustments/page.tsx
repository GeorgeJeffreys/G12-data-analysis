"use client";

/**
 * Screen — Incident adjustments (critical-path step). WIRED TO THE CONFIG.
 *
 * This step now CONSUMES the admin Incident configuration (codes / formulae / caps,
 * under Settings › Incident adjustments) instead of the old blank manual-triage
 * form. Import the incident log here and every row is matched to a configured
 * incident code; the mark alteration is AUTO-COMPUTED from that code's formula,
 * clamped to the code's per-incident cap and to the per-student global cap
 * (add-only), and shown per student as `base + adjustment = adjusted`. Unmatched /
 * unclassified rows grant zero and are surfaced for manual attention. Nothing is
 * committed to scores until an admin applies it (base scores are never touched —
 * they reconcile 1:1 with the raw oracle).
 *
 * The old per-incident manual triage (This student / Whole subject / No action,
 * with reason) is retained as an explicit override for cases the config doesn't
 * cover — see "Manual override".
 */
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { CycleShell } from "@/components/shell/CycleShell";
import { StepIntro } from "@/components/ui/StepIntro";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { IncidentReviewSurface } from "@/components/incidents/IncidentReviewSurface";
import { ExamIncidentUploadCard } from "@/components/incidents/ExamIncidentUploadCard";

export default function AdjustmentsPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";

  const shellProps = {
    cycleId,
    cycleName,
    page: "Incident adjustments",
    stageIndex: 5,
    actions: (
      // The manual-override path (This student / Whole subject / No action, with
      // reason) for incidents the config doesn't cover or a human wants to change.
      <Link href={`/cycles/${cycleId}/adjustments/manual`}>
        <Button variant="ghost" title="Manual override">Manual override</Button>
      </Link>
    ),
    primary: (
      // Incident adjustments → Score (step 7) → Cut scores (step 8): the next step
      // is the computed-scores screen, not cut scores (no step is skipped).
      <Link href={`/cycles/${cycleId}/score`}>
        <Button variant="pri" title="Continue to scoring">Continue<Icon name="arrow" color="#fff" /></Button>
      </Link>
    ),
    intro: (
      <StepIntro>
        Turns exam-day incidents — a frozen calculator, audio that wouldn&apos;t play — into deliberate, recorded
        mark alterations, so no student is disadvantaged by something outside their control.
      </StepIntro>
    ),
  };

  return (
    <CycleShell {...shellProps}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="hf-pad" style={{ padding: "14px 28px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="hf-sub" style={{ maxWidth: 720 }}>
            Import the incident log and each incident is matched to a configured code
            (Settings › Incident adjustments); its mark alteration is computed from the
            code’s formula and capped (per-code and per-student, add-only). Review each
            student’s <b>base + adjustment = adjusted</b> below before an admin commits
            it to Score. Base scores are untouched.
          </div>
          {/* Technical incident export ingest (0043): matches by email + stages the
              real 20-column export. Staging only — no marks are adjusted (§3 gate). */}
          <ExamIncidentUploadCard cycleId={cycleId} />
        </div>
        <IncidentReviewSurface cycleId={cycleId} showImporter />
      </div>
    </CycleShell>
  );
}
