/**
 * P-B — item statistics reproduce the analyst's validated notebook.
 *
 * The analyst's notebook is the oracle. These tests pin the *ported* formulae
 * against it beyond the row-by-row parity gate (tests/engine.parity.test.ts):
 *
 *  1. Reproduce the analyst's reference item table for Applicable Math and match
 *     P-Value, IT-R, PT-BIS and Discrimination to 3 dp (reproduced vs app).
 *  2. IT-R and PT-BIS are defined to TRACK — on the corrected Applicable Math
 *     matrix every item has PT-BIS ≥ IT-R with 0 ≤ (PT-BIS − IT-R) < 0.25.
 *  3. The discrimination group-size formula resolves to 5 for n = 15 (top 5 vs
 *     bottom 5), and matches the notebook across the small-cohort range.
 */

import { describe, it, expect } from "vitest";
import { getEngine, discriminationGroupSize } from "@/lib/engine";
import type { ItemStat, ResponseRecord } from "@/lib/engine";
import { loadParityFixtures } from "./fixtures";

const engine = getEngine();
const fixtures = loadParityFixtures();
const APPLICABLE_MATH = "Applicable Math";

function responsesFor(assessmentName: string): ResponseRecord[] {
  const a = fixtures[assessmentName]!;
  return a.responses.map((r) => ({
    participantId: r.student,
    itemId: String(r.qid),
    assessmentId: assessmentName,
    score: r.score,
  }));
}

function statsByItem(assessmentName: string): Map<string, ItemStat> {
  const stats = engine.computeItemStats({ responses: responsesFor(assessmentName) });
  return new Map(stats.map((s) => [s.itemId, s]));
}

describe("item statistics reproduce the analyst's notebook", () => {
  describe("reproduces the analyst reference table (Applicable Math) to 3 dp", () => {
    const assessment = fixtures[APPLICABLE_MATH]!;
    const byItem = statsByItem(APPLICABLE_MATH);

    it("cohort is the corrected 15-student matrix", () => {
      expect(assessment.participants).toBe(15);
      expect(byItem.size).toBe(assessment.items.length);
    });

    for (const item of assessment.items) {
      const id = String(item.qid);
      const p = item.published;
      it(`item ${id} — P-Value / IT-R / PT-BIS / Discrimination`, () => {
        const stat = byItem.get(id)!;
        expect(stat).toBeDefined();

        // P-Value — mean item score across all students.
        expect(stat.pValue).toBeCloseTo(p.p_value as number, 3);

        // IT-R (corrected item-rest) and PT-BIS (uncorrected item-total).
        if (p.item_total === null) expect(stat.itemTotal).toBeNull();
        else expect(stat.itemTotal as number).toBeCloseTo(p.item_total, 3);

        if (p.point_biserial === null) expect(stat.pointBiserial).toBeNull();
        else expect(stat.pointBiserial as number).toBeCloseTo(p.point_biserial, 3);

        // Discrimination (upper − lower group means).
        if (p.discrimination !== null) {
          expect(stat.discrimination).toBeCloseTo(p.discrimination, 3);
        }
      });
    }
  });

  it("PT-BIS and IT-R track: PT-BIS ≥ IT-R and 0 ≤ gap < 0.25 (Applicable Math)", () => {
    const stats = engine.computeItemStats({ responses: responsesFor(APPLICABLE_MATH) });
    let checked = 0;
    for (const s of stats) {
      // The invariant is only defined where both correlations are defined.
      if (s.pointBiserial === null || s.itemTotal === null) continue;
      checked++;
      const gap = (s.pointBiserial as number) - (s.itemTotal as number);
      expect(
        gap,
        `item ${s.itemId}: PT-BIS ${s.pointBiserial} should be ≥ IT-R ${s.itemTotal}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        gap,
        `item ${s.itemId}: PT-BIS − IT-R (${gap.toFixed(3)}) should be < 0.25`,
      ).toBeLessThan(0.25);
    }
    // Every Applicable Math item has a defined correlation on the corrected matrix.
    expect(checked).toBe(stats.length);
  });

  describe("discrimination group size (analyst formula)", () => {
    it("resolves to 5 for the Applicable Math cohort (n = 15): top 5 vs bottom 5", () => {
      expect(discriminationGroupSize(15)).toBe(5);
    });

    it("matches the notebook across the small-cohort range", () => {
      // max(1, min(n // 2, round(n * 0.33))), floored at 3 once n ≥ 9.
      const expected: Record<number, number> = {
        1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 3,
        9: 3, 10: 3, 11: 4, 12: 4, 13: 4, 14: 5, 15: 5, 16: 5,
      };
      for (const [nStr, g] of Object.entries(expected)) {
        expect(discriminationGroupSize(Number(nStr))).toBe(g);
      }
    });
  });
});
