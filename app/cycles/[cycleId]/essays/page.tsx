"use client";

/**
 * Screen — Essay marks (pipeline step between Diagnostics and Technical
 * adjustments). A dedicated home for loading/entering the offline-marked essay
 * scores (English & Arabic only). It shares the exact upload/enter logic with
 * the optional "Essay marks" card on the Upload screen via `EssayMarksCard`, so
 * both entry points write to the same provider state — enter marks here, or up
 * front on Upload; either way they flow into the subject totals. The step is
 * skippable: subjects with no essay component simply have nothing to add.
 */
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { EssayMarksCard } from "@/components/cycle/EssayMarksCard";
import type { EssayMarksModel } from "@/lib/data/types";

export default function EssaysPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";
  const essay = useProviderData((p) => p.getEssayMarks(cycleId), [cycleId]) as EssayMarksModel | null;

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Essay marks"
      stageIndex={5}
      primary={
        <Link href={`/cycles/${cycleId}/adjustments`}>
          <Button variant="pri">Continue to technical adjustments<Icon name="arrow" color="#fff" /></Button>
        </Link>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 16, flex: 1, maxWidth: 1040 }}>
        <div>
          <div style={{ display: "flex", gap: 11, alignItems: "center", flexWrap: "wrap" }}>
            <div className="hf-h1">Essay marks</div>
            <Badge tone="neutral"><Mark kind="warn" size={11} />Optional · English &amp; Arabic only</Badge>
          </div>
          <div className="hf-sub" style={{ marginTop: 7, maxWidth: 700 }}>
            Load or enter the offline-marked essay scores. You can also add them up front on the{" "}
            <Link href={`/cycles/${cycleId}/import`} style={{ color: H.pink, fontWeight: 600 }}>Upload</Link> screen — both
            entry points write to the same place. Marks add to the subject total; subjects with no essay component need
            nothing here.
          </div>
        </div>

        <div className="hf-card" style={{ padding: "18px 20px" }}>
          <EssayMarksCard cycleId={cycleId} model={essay} />
        </div>
      </div>
    </CycleShell>
  );
}
