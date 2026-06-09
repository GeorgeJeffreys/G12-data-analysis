/**
 * PARITY TEST — the trust gate (Section 8).
 *
 * Feeds each assessment's de-identified responses through the engine and asserts
 * that `computeItemStats` reproduces the data scientist's published p-value,
 * corrected item-total correlation, point-biserial correlation and
 * discrimination for every item, plus the Good/Review/Flag ratings and the
 * overall review. Values are compared within rounding tolerance; ratings exact.
 */

import { describe, it, expect } from "vitest";
import { getEngine } from "@/lib/engine";
import type { ItemStat, ResponseRecord } from "@/lib/engine";
import { loadParityFixtures } from "./fixtures";

const TOL = 0.0011; // published values are rounded to 3 decimals
const engine = getEngine();
const fixtures = loadParityFixtures();

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

describe("engine parity vs published item statistics", () => {
  for (const assessmentName of Object.keys(fixtures)) {
    describe(assessmentName, () => {
      const assessment = fixtures[assessmentName]!;
      const byItem = statsByItem(assessmentName);

      it("computes one stat row per item", () => {
        expect(byItem.size).toBe(assessment.items.length);
      });

      for (const item of assessment.items) {
        const id = String(item.qid);
        const p = item.published;

        it(`item ${id}`, () => {
          const stat = byItem.get(id);
          expect(stat, `missing stats for item ${id}`).toBeDefined();
          if (!stat) return;

          // --- values (within rounding tolerance) ---
          expect(stat.pValue).toBeCloseTo(p.p_value as number, 2);

          if (p.item_total === null) {
            expect(stat.itemTotal).toBeNull();
          } else {
            expect(stat.itemTotal).not.toBeNull();
            expect(Math.abs((stat.itemTotal as number) - p.item_total)).toBeLessThan(TOL);
          }

          if (p.point_biserial === null) {
            expect(stat.pointBiserial).toBeNull();
          } else {
            expect(stat.pointBiserial).not.toBeNull();
            expect(Math.abs((stat.pointBiserial as number) - p.point_biserial)).toBeLessThan(TOL);
          }

          if (p.discrimination !== null) {
            expect(Math.abs(stat.discrimination - p.discrimination)).toBeLessThan(TOL);
          }

          // --- ratings (exact) ---
          expect(stat.pRating).toBe(p.p_rating);
          expect(stat.itRating).toBe(p.item_total_rating);
          expect(stat.pbRating).toBe(p.point_biserial_rating);
          expect(stat.discRating).toBe(p.discrimination_rating);
          expect(stat.overallReview).toBe(p.overall_review);
        });
      }
    });
  }

  it("tags every stat with the engine version", () => {
    const stats = engine.computeItemStats({ responses: responsesFor("Applicable Math") });
    expect(stats.length).toBeGreaterThan(0);
    for (const s of stats) expect(s.engineVersion).toBe(engine.version);
  });
});
