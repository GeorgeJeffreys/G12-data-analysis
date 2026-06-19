"use client";

/**
 * Screen 01 — Exam years (home). A cycle is now a full YEAR; within each year
 * are two sittings (February and May) plus a derived Overall view. This screen
 * lists the years; opening one reveals its February / May / Overall tiles
 * (app/years/[yearId]). Each sitting opens the existing per-sitting pipeline
 * (app/cycles/[cycleId]) unchanged.
 */
import { useState } from "react";
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Chip } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import type { SittingRef } from "@/lib/data/types";

type Filter = "all" | "in_progress" | "locked";

/** A year is "in progress" while any started sitting is still unlocked. */
function yearLocked(feb: SittingRef, may: SittingRef): boolean {
  const started = [feb, may].filter((s) => s.started);
  return started.length > 0 && started.every((s) => s.locked);
}

function SittingPill({ s }: { s: SittingRef }) {
  if (!s.started) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: H.ink3 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, border: `1px dashed ${H.line2}` }} />
        {s.label} · not started
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: H.ink2 }}>
      {s.locked ? (
        <Icon name="lock" size={12} color={H.ink2} />
      ) : (
        <span style={{ width: 8, height: 8, borderRadius: 999, background: H.pink }} />
      )}
      {s.label}
      {s.live && (
        <span style={{ fontSize: 9, fontWeight: 700, color: H.pink, background: H.pinkSoft, padding: "1px 6px", borderRadius: 999 }}>
          ACTIVE
        </span>
      )}
      {s.mock && (
        <span style={{ fontSize: 8.5, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 4px", letterSpacing: 0.5 }}>
          MOCK
        </span>
      )}
    </span>
  );
}

export default function YearsDashboard() {
  const years = useProviderData((p) => p.listYears());
  const [filter, setFilter] = useState<Filter>("all");

  const rows = years.filter((y) => {
    if (filter === "all") return true;
    const locked = yearLocked(y.february, y.may);
    return filter === "locked" ? locked : !locked;
  });

  return (
    <Shell
      active="Cycles"
      crumb={[{ label: "Years" }]}
      actions={
        <>
          <Button variant="ghost">
            <Icon name="search" />
            Search
          </Button>
          <Link href="/cycles/new">
            <Button variant="pri">
              <Icon name="plus" color="#fff" />
              Start new sitting
            </Button>
          </Link>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "28px 32px", gap: 22, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div className="hf-h1">Exam years</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>
              Each year has a February and a May sitting. Open a year to process a sitting or view the overall best-of-two result.
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
                <th className="hf-th">Year</th>
                <th className="hf-th">Sittings</th>
                <th className="hf-th" style={{ textAlign: "right" }}>Participants</th>
                <th className="hf-th">Last activity</th>
                <th className="hf-th" />
              </tr>
            </thead>
            <tbody>
              {rows.map((y) => (
                <tr key={y.id} className="hf-hover" style={{ background: y.live ? H.pinkSoft2 : "transparent" }}>
                  <td className="hf-td">
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{y.name}</span>
                  </td>
                  <td className="hf-td">
                    <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                      <SittingPill s={y.february} />
                      <SittingPill s={y.may} />
                    </div>
                  </td>
                  <td className="hf-td hf-mono" style={{ textAlign: "right", fontSize: 13 }}>
                    {y.participants.toLocaleString()}
                  </td>
                  <td className="hf-td hf-sub">{y.lastActivity}</td>
                  <td className="hf-td" style={{ textAlign: "right" }}>
                    <Link href={`/years/${y.id}`}>
                      <Button>
                        Open<Icon name="arrow" />
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hf-sub" style={{ marginTop: "auto" }}>
          {years.length} years · oldest archived after 3 years per retention policy
        </div>
      </div>
    </Shell>
  );
}
