"use client";

/**
 * StepBackButton — the grey secondary "Back" action pinned immediately to the
 * LEFT of the primary "Continue" button on every Critical Path step. It navigates
 * to the previous pipeline stage (`stageRoute(cycleId, stageIndex - 1)`), so the
 * two nav actions always sit together in the stepper row and read as a matched
 * pair: muted "← Back" beside the pink "Continue →".
 *
 * The first step (Upload, stageIndex 0) has no previous step, so the button
 * renders nothing there. Styling is the default (muted/secondary) button variant
 * — deliberately not the pink primary — kept identical across every step.
 */
import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { stageRoute } from "@/lib/data/pipeline-route";

export function StepBackButton({ cycleId, stageIndex }: { cycleId: string; stageIndex: number }) {
  // No previous step on the first stage (Upload) — hide rather than disable.
  if (stageIndex <= 0) return null;
  return (
    <Link href={stageRoute(cycleId, stageIndex - 1)}>
      <Button variant="default" title="Back to the previous step">
        <Icon name="arrowLeft" />
        Back
      </Button>
    </Link>
  );
}
