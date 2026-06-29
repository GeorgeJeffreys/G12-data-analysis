"use client";

/**
 * Sitting-level Diagnostics tab — placeholder.
 *
 * This is the per-sitting Diagnostics *tab* (top-right nav, alongside Pipeline /
 * Audit log), brought back per the P2 batch. It is intentionally distinct from
 * the per-subject Diagnostics *pipeline step* (`/cycles/[cycleId]/diagnostics`),
 * which carries the speededness / timing / reliability measures.
 *
 * The content for this sitting-level view is still being specified ("content
 * bullets to follow"), so for now it shows a clearly-labelled "coming soon"
 * placeholder that still carries the sitting context.
 */
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { Icon } from "@/components/ui/icons";

export default function DiagnosticsHubPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";

  return (
    <CycleShell cycleId={cycleId} cycleName={cycleName} page="Diagnostics" area="diagnostics">
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: "64px 24px",
          textAlign: "center",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: H.pinkSoft,
          }}
        >
          <Icon name="award" size={26} color={H.pink} />
        </div>
        <div className="hf-h2" style={{ fontSize: 20 }}>Diagnostics</div>
        <div className="hf-sub" style={{ fontSize: 13, maxWidth: 440, lineHeight: 1.5 }}>
          A sitting-level diagnostics view for <strong style={{ color: H.ink }}>{cycleName}</strong> is
          coming soon. Per-subject speededness, timing and reliability are available now from the
          Diagnostics step inside the pipeline.
        </div>
        <span
          className="hf-lbl"
          style={{
            fontSize: 11,
            letterSpacing: 0.4,
            padding: "4px 10px",
            borderRadius: 999,
            background: H.canvas,
            border: `1px solid ${H.line2}`,
            color: H.ink3,
          }}
        >
          Coming soon
        </span>
      </div>
    </CycleShell>
  );
}
