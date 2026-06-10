"use client";

/**
 * Screen 02 — Cycle overview (the pipeline control room). Shows where the cycle
 * sits in the pipeline, a "Do next" card pointing at the next action, and the
 * assessments in this cycle with their item counts and stage.
 */
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { Pipeline } from "@/components/shell/Pipeline";
import { cyclesSubnav } from "@/lib/ui/subnav";

export default function CycleOverview({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const cycle = useProviderData((p) => p.getCycle(cycleId), [cycleId]);

  if (!cycle) {
    return (
      <Shell crumb={[{ label: "Cycles", href: "/" }, { label: "Not found" }]}>
        <div style={{ padding: 32 }} className="hf-sub">That cycle doesn’t exist.</div>
      </Shell>
    );
  }

  return (
    <Shell
      active="Cycles"
      crumb={[{ label: "Cycles", href: "/" }, { label: cycle.name }]}
      subnav={cycle.mock ? undefined : cyclesSubnav(cycleId, "pipeline")}
      stageIndex={cycle.stageIndex}
      actions={
        <>
          <Link href={`/cycles/${cycleId}/audit`}>
            <Button variant="ghost">Audit log</Button>
          </Link>
          <Button variant="ghost">Export status<Icon name="chev" /></Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 32px", gap: 22, flex: 1 }}>
        <div>
          <div className="hf-h1">
            {cycle.name} cycle
            {cycle.mock && (
              <span style={{ fontSize: 9, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "2px 5px", letterSpacing: 0.5, marginLeft: 10, verticalAlign: "middle" }}>
                MOCK
              </span>
            )}
          </div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            {cycle.participants.toLocaleString()} participants · {cycle.assessmentCount} assessments · started {cycle.startedAt}
          </div>
        </div>

        <div style={{ display: "flex", gap: 18, alignItems: "stretch" }}>
          {/* Do next */}
          <div style={{ flex: "0 0 330px", borderRadius: 12, padding: "22px 24px", background: H.slate, color: H.cream, position: "relative", overflow: "hidden" }}>
            <div className="hf-lbl" style={{ color: "rgba(233,237,241,.6)" }}>Do next</div>
            <div className="hf-h2" style={{ margin: "10px 0 6px", fontSize: 17, color: "#fff" }}>{cycle.doNext.title}</div>
            <div style={{ fontSize: 12.5, color: "rgba(233,237,241,.8)", marginBottom: 18, lineHeight: 1.5 }}>{cycle.doNext.body}</div>
            <Link href={cycle.doNext.href}>
              <Button variant="pri">
                {cycle.doNext.cta}
                <Icon name="arrow" color="#fff" />
              </Button>
            </Link>
          </div>

          {/* Assessments */}
          <div className="hf-card" style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "13px 20px", borderBottom: `1px solid ${H.line}`, background: H.tint }}>
              <span className="hf-lbl" style={{ flex: 1 }}>Assessments in this cycle</span>
              <span className="hf-lbl">Stage</span>
            </div>
            {cycle.assessments.length === 0 ? (
              <div className="hf-sub" style={{ padding: "18px 20px" }}>
                This is a mock prior cycle — no detailed assessment data in this build.
              </div>
            ) : (
              cycle.assessments.map((a, i) => (
                <Link
                  key={a.id}
                  href={`/cycles/${cycleId}/review/${encodeURIComponent(a.id)}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "12px 20px",
                    borderBottom: i < cycle.assessments.length - 1 ? `1px solid ${H.line}` : "none",
                    gap: 12,
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>
                    {a.name}
                    {a.rtl && (
                      <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 8, border: `1px solid ${H.line2}`, padding: "1px 5px", borderRadius: 4 }}>
                        RTL
                      </span>
                    )}
                    {a.excludedCount > 0 && (
                      <span className="hf-sub" style={{ fontSize: 11, marginLeft: 8 }}>· {a.excludedCount} excluded</span>
                    )}
                  </span>
                  <span className="hf-mono" style={{ fontSize: 11, color: H.ink3, width: 62, textAlign: "right" }}>{a.itemCount} items</span>
                  <Pipeline active={a.stageIndex} done={a.stageIndex} compact />
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
