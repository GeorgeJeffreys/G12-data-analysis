"use client";

/**
 * Non-blocking warning that grades are provisional. Because essay marks and
 * incident-driven alterations must exist before a subject total is final, this
 * surfaces (but never gates) when:
 *  - an essay subject (English/Arabic) has no marks loaded yet, or
 *  - incidents remain unreviewed in the Adjustments queue.
 * It is informational only — the team can proceed at any time.
 */
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Mark } from "@/components/ui/icons";

export function ProvisionalBanner({ cycleId }: { cycleId: string }) {
  const provider = useProvider();
  void provider;
  const essay = useProviderData((p) => p.getEssayMarks(cycleId), [cycleId]);
  const adj = useProviderData((p) => p.getAdjustments(cycleId), [cycleId]);

  const missingEssay = essay ? essay.subjects.filter((s) => s.count === 0).map((s) => s.name) : [];
  const awaiting = adj?.counts.awaiting ?? 0;
  if (missingEssay.length === 0 && awaiting === 0) return null;

  return (
    <div
      role="status"
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 28px", background: H.warnSoft, borderBottom: `1px solid ${H.warn}55`, flexWrap: "wrap" }}
    >
      <Mark kind="warn" size={15} />
      <span style={{ fontSize: 12, color: H.ink }}>
        <b>Grades are provisional.</b>{" "}
        {missingEssay.length > 0 && (
          <>No essay marks loaded for {missingEssay.join(" & ")} — those subjects score on MCQ only so far. </>
        )}
        {awaiting > 0 && <>{awaiting} incident{awaiting === 1 ? "" : "s"} still awaiting triage. </>}
      </span>
      <Link href={`/cycles/${cycleId}/adjustments`} style={{ fontSize: 11.5, color: H.pink, fontWeight: 600 }}>
        Open Adjustments →
      </Link>
    </div>
  );
}
