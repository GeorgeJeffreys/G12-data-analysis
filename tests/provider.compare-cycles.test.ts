/**
 * Provider read-model for Analytics › Compare cycles (getCompareCycles).
 * Confirms the live cycle's per-subject figures are REAL (read from the existing
 * boundary/review/reliability/grades outputs, consistent with those models),
 * the picker lists real cycles defaulting to the two most recent, prior cycles
 * are clearly flagged mock, and the confirmed award/performance vocabulary is
 * used. Read-only — it must not perturb parity (asserted elsewhere).
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

const CYCLE = "may-2026";

describe("getCompareCycles read-model", () => {
  const provider = new InMemoryDataProvider();
  const model = provider.getCompareCycles();

  it("lists real cycles and defaults to the two most recent (live newest)", () => {
    expect(model.available.length).toBeGreaterThanOrEqual(2);
    // listCycles is newest → oldest, so the live cycle leads the available list
    expect(model.available[0]!.id).toBe(CYCLE);
    expect(model.available[0]!.live).toBe(true);
    expect(model.selectedIds.length).toBe(2);
    // rendered oldest → newest; the newest selected is the live cycle
    expect(model.selectedIds[model.selectedIds.length - 1]).toBe(CYCLE);
    expect(model.cycles[model.cycles.length - 1]!.live).toBe(true);
  });

  it("uses the confirmed award and performance vocabulary, not placeholders", () => {
    expect(model.awardLevels).toEqual([
      "Distinction award",
      "Advanced achievement award",
      "Secondary achievement award",
      "No Award",
    ]);
    expect(model.performanceLevels).toEqual([
      "Outstanding performance",
      "Exceeds expectations",
      "Meets expectations",
      "Doesn't yet meet expectations",
    ]);
    // none of the mockup placeholder bands leak through
    const all = JSON.stringify(model);
    for (const placeholder of ["Emerging", "Developing", '"Pass"']) {
      expect(all).not.toContain(placeholder);
    }
  });

  it("reads the live cycle's per-subject figures from the existing outputs", () => {
    const live = model.cycles.find((c) => c.live)!;
    expect(live.mock).toBe(false);
    expect(Object.keys(live.subjects).length).toBe(5);

    const cycle = provider.getCycle(CYCLE)!;
    for (const a of cycle.assessments) {
      const m = live.subjects[a.id]!;
      const b = provider.getBoundaries(CYCLE, a.id)!;
      // participants, score stats and item counts match the boundary model
      expect(m.participants).toBe(b.n);
      expect(m.scoreMean).toBe(b.stats.mean);
      expect(m.scoreMedian).toBe(b.stats.median);
      expect(m.itemsUsable).toBe(b.stats.itemsScored);
      expect(m.itemsRemoved).toBe(b.stats.excluded);
      expect(m.scoreMax).toBe(b.maxRaw);
      // α matches the reliability subject row (Wave 4)
      const alphaRow = provider
        .getReliability(CYCLE)!
        .rows.find((r) => r.level === "subject" && r.assessmentId === a.id)!;
      expect(m.alpha).toBe(alphaRow.alpha ?? null);
      // p-value is a real difficulty in [0,1]
      expect(m.avgPValue).toBeGreaterThan(0);
      expect(m.avgPValue).toBeLessThanOrEqual(1);
      // one cut per non-lowest performance level
      expect(m.cuts.length).toBe(model.performanceLevels.length - 1);
    }
    // overall award distribution matches the grades model counts
    const grades = provider.getGrades(CYCLE)!;
    for (const d of grades.distribution) {
      expect(live.awardDist[d.level]).toBe(d.count);
    }
  });

  it("flags prior cycles as mock and degrades unavailable metrics to null, not zero", () => {
    const prior = model.cycles.find((c) => !c.live);
    expect(prior).toBeTruthy();
    expect(prior!.mock).toBe(true);
    expect(model.anyMock).toBe(true);
  });

  it("honours an explicit cycle selection", () => {
    const ids = provider.listCycles().map((c) => c.id);
    const picked = provider.getCompareCycles([ids[0]!, ids[2]!]);
    expect(new Set(picked.selectedIds)).toEqual(new Set([ids[0], ids[2]]));
  });
});
