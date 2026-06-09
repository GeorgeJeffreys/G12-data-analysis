"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProvider } from "@/lib/data/context";

/** /review with no assessment → redirect to the cycle's first assessment. */
export default function ReviewIndex({ params }: { params: { cycleId: string } }) {
  const router = useRouter();
  const provider = useProvider();
  useEffect(() => {
    const cycle = provider.getCycle(params.cycleId);
    const first = cycle?.assessments[0];
    router.replace(
      first
        ? `/cycles/${params.cycleId}/review/${encodeURIComponent(first.id)}`
        : `/cycles/${params.cycleId}`,
    );
  }, [provider, params.cycleId, router]);
  return null;
}
