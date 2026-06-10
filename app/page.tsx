"use client";

/**
 * Screen 01 — Cycles dashboard (home). Lists every exam cycle with its pipeline
 * stage and counts. The live "May 2026" cycle is seeded from real engine output;
 * the prior cycles are clearly-labelled mocks (no data source yet).
 */
import { useState } from "react";
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Chip } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

type Filter = "all" | "in_progress" | "locked";

export default function CyclesDashboard() {
  const cycles = useProviderData((p) => p.listCycles());
  const [filter, setFilter] = useState<Filter>("all");

  const rows = cycles.filter((c) =>
    filter === "all" ? true : filter === "locked" ? c.locked : !c.locked,
  );

  return (
    <Shell
      crumb={[{ label: "Cycles" }]}
      actions={
        <>
          <Button variant="ghost">
            <Icon name="search" />
            Search
          </Button>
          <Button variant="pri" title="Creating cycles needs the database — mocked in this build">
            <Icon name="plus" color="#fff" />
            Start new cycle
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "28px 32px", gap: 22, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div className="hf-h1">Exam cycles</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>
              Each cycle is one sitting of the assessments. Open a cycle to process its results.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Chip on={filter === "all"} onClick={() => setFilter("all")}>All</Chip>
            <Chip on={filter === "in_progress"} onClick={() => setFilter("in_progress")}>In progress</Chip>
            <Chip on={filter === "locked"} onClick={() => setFilter("locked")}>Locked</Chip>
          </div>
        </div>

        <div className="hf-card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="hf-th">Cycle</th>
                <th className="hf-th">Stage in pipeline</th>
                <th className="hf-th" style={{ textAlign: "right" }}>Participants</th>
                <th className="hf-th" style={{ textAlign: "right" }}>Assessments</th>
                <th className="hf-th">Last activity</th>
                <th className="hf-th" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="hf-hover" style={{ background: c.live ? H.pinkSoft2 : "transparent" }}>
                  <td className="hf-td">
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</span>
                      {c.live && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: H.pink, background: H.pinkSoft, padding: "2px 9px", borderRadius: 999 }}>
                          ACTIVE
                        </span>
                      )}
                      {c.mock && (
                        <span style={{ fontSize: 8.5, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 4px", letterSpacing: 0.5 }}>
                          MOCK
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hf-td">
                    <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
                      {c.locked ? (
                        <Icon name="lock" size={14} color={H.ink2} />
                      ) : (
                        <span style={{ width: 9, height: 9, borderRadius: 999, background: H.pink, flex: "0 0 auto" }} />
                      )}
                      <span style={{ fontWeight: 500, fontSize: 12.5 }}>{c.stageLabel}</span>
                      <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink3 }}>{c.stepsDone}/7</span>
                    </div>
                  </td>
                  <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13 }}>{c.participants.toLocaleString()}</td>
                  <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13 }}>{c.assessments}</td>
                  <td className="hf-td hf-sub">{c.lastActivity}</td>
                  <td className="hf-td" style={{ textAlign: "right" }}>
                    <Link href={`/cycles/${c.id}`}>
                      <Button>
                        {c.locked ? "View" : <>Open<Icon name="arrow" /></>}
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hf-sub" style={{ marginTop: "auto" }}>
          {cycles.length} cycles · oldest archived after 3 years per retention policy
        </div>
      </div>
    </Shell>
  );
}
