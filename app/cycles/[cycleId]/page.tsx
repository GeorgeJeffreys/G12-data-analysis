"use client";

/**
 * Opening a cycle routes straight to its current pipeline step (no in-between
 * overview page). The cycle list (the home page) is where each cycle's status is
 * surfaced before you open it; the breadcrumb cycle name also lands here, so this
 * redirect doubles as "back to the pipeline view".
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProvider } from "@/lib/data/context";
import { stageHref } from "@/components/shell/Pipeline";

export default function CycleIndex({ params }: { params: { cycleId: string } }) {
  const router = useRouter();
  const provider = useProvider();
  useEffect(() => {
    const cycle = provider.getCycle(params.cycleId);
    router.replace(cycle ? stageHref(params.cycleId, cycle.stageIndex) : "/");
  }, [provider, params.cycleId, router]);
  return null;
}
