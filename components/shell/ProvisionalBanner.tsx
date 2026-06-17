"use client";

/**
 * Non-blocking "grades are provisional" notice. Because essay marks and
 * incident-driven alterations must exist before a subject total is final, this
 * surfaces (but never gates) when:
 *  - an essay subject (English/Arabic) has no marks loaded yet, or
 *  - incidents remain unreviewed in the Adjustments queue.
 * It is informational only — the team can proceed at any time.
 *
 * Exposed as a hook returning a `Notice | null` so pages can fold it into the
 * single consolidated `AlertStack` alongside their other notices, rather than
 * stacking yet another full-width banner. Outstanding input is needed before
 * sign-off → must-act (warn) tone.
 */
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import type { Notice } from "@/components/shell/CycleShell";

export function useProvisionalNotice(cycleId: string): Notice | null {
  const essay = useProviderData((p) => p.getEssayMarks(cycleId), [cycleId]);
  const adj = useProviderData((p) => p.getAdjustments(cycleId), [cycleId]);

  const missingEssay = essay ? essay.subjects.filter((s) => s.count === 0).map((s) => s.name) : [];
  const awaiting = adj?.counts.awaiting ?? 0;
  if (missingEssay.length === 0 && awaiting === 0) return null;

  return {
    key: "provisional",
    tone: "warn",
    message: (
      <>
        <b>Grades are provisional.</b>{" "}
        {missingEssay.length > 0 && (
          <>No essay marks loaded for {missingEssay.join(" & ")} — those subjects score on MCQ only so far. </>
        )}
        {awaiting > 0 && <>{awaiting} incident{awaiting === 1 ? "" : "s"} still awaiting triage.</>}
      </>
    ),
    action: (
      <span style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
        {missingEssay.length > 0 && (
          <Link href={`/cycles/${cycleId}/import`} style={{ fontSize: 11.5, color: H.pink, fontWeight: 600 }}>
            Load essay marks →
          </Link>
        )}
        {awaiting > 0 && (
          <Link href={`/cycles/${cycleId}/adjustments`} style={{ fontSize: 11.5, color: H.pink, fontWeight: 600 }}>
            Triage incidents →
          </Link>
        )}
      </span>
    ),
  };
}
