"use client";

/**
 * Analytics › Overall — the bird's-eye programme view over time × centres.
 * Reproduces the finalised design (design/hfOverallFinal.jsx): a bar of four
 * checkbox dropdowns (Time / Exam type / Partner centre / Subject) over a stacked
 * collapsible accordion of four sections, each answering its focused question at
 * a glance even when collapsed.
 *
 * Every figure comes from `getOverallAnalytics()` (the OverallAnalytics
 * read-model). The checkbox slice is adapted, via `finalToLegacy`, into the
 * shape the sections consume; degeneracy (single centre / single year /
 * Combined-only levels) is handled by `sliceEffects`. Compare cycles is separate.
 */
import { useEffect, useMemo, useState } from "react";
import { useProviderData } from "@/lib/data/context";
import { Shell } from "@/components/shell/Shell";
import { analyticsSubnav } from "@/lib/ui/subnav";
import { OVSlicerDropdowns, OVActiveSlice, OVAccordion, defaultFinalSlice, sanitizeSlice, finalToLegacy, type FinalSlice } from "@/components/ui/overall/slicer";

const KEY = "g12_overall_slice";

export default function OverallPage() {
  // `universe` = the full programme (every centre) — drives the slicer menus,
  // the active-slice readout totals, and the persisted-slice reconciliation, so
  // the menus stay stable regardless of what's selected.
  const universe = useProviderData((p) => p.getOverallAnalytics());

  // Future years (no data yet) — the four years after the latest live year.
  const futureYears = useMemo(() => {
    const last = universe.years[universe.years.length - 1] ?? new Date().getFullYear();
    return [1, 2, 3, 4].map((i) => last + i);
  }, [universe.years]);

  // Persisted slice, reconciled against the current read-model on load.
  const [slice, setSlice] = useState<FinalSlice>(() => defaultFinalSlice(universe));
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      setSlice(sanitizeSlice(raw ? JSON.parse(raw) : null, universe));
    } catch {
      setSlice(defaultFinalSlice(universe));
    }
    // Reconcile once against the loaded model; re-run if the model's dimensions change.
  }, [universe.years.join(","), universe.centres.join(","), universe.subjects.map((s) => s.key).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(slice));
    } catch {
      /* ignore persistence failures (private mode, quota) */
    }
  }, [slice]);

  // The sections read a read-model RE-POOLED for the selected centres, so a
  // centre subset re-slices participation / perf / awardDist — not just the
  // per-centre columns. Recompute-on-change is cheap (the data is tiny).
  const centreKey = [...slice.centres].sort().join(",");
  const analytics = useProviderData((p) => p.getOverallAnalytics({ centres: slice.centres }), [centreKey]);

  const legacy = finalToLegacy(slice, universe);

  return (
    <Shell active="Analytics" crumb={[{ label: "Analytics" }, { label: "Overall" }]} subnav={analyticsSubnav("overall")}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", padding: "20px 26px 40px", gap: 18, maxWidth: 1400, width: "100%", margin: "0 auto" }}>
          <div className="hf-row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div className="hf-h1">Overall</div>
              <div className="hf-sub" style={{ marginTop: 5, maxWidth: 640 }}>
                Programme performance over time — reach, outcomes, and consistency across partner centres. Expand any section; every collapsed card still answers its question at a glance.
              </div>
            </div>
            <OVActiveSlice slice={slice} analytics={universe} />
          </div>
          <OVSlicerDropdowns slice={slice} setSlice={setSlice} analytics={universe} futureYears={futureYears} />
          <OVAccordion analytics={analytics} slice={legacy} />
        </div>
      </div>
    </Shell>
  );
}
