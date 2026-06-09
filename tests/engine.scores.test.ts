/**
 * Scoring & roll-up tests. `computeScores` must be self-consistent with the raw
 * response matrix, and respond correctly to item exclusions. `rollUp` summarises
 * by assessment, major element and demand level.
 */

import { describe, it, expect } from "vitest";
import { getEngine } from "@/lib/engine";
import type { ItemMeta, ResponseRecord } from "@/lib/engine";
import { loadParityFixtures } from "./fixtures";

const engine = getEngine();
const fixtures = loadParityFixtures();

function buildAssessment(name: string): {
  responses: ResponseRecord[];
  items: ItemMeta[];
} {
  const a = fixtures[name]!;
  const responses: ResponseRecord[] = a.responses.map((r) => ({
    participantId: r.student,
    itemId: String(r.qid),
    assessmentId: name,
    score: r.score,
  }));
  const items: ItemMeta[] = a.items.map((it) => ({
    itemId: String(it.qid),
    assessmentId: name,
    majorElement: it.major,
    subElement: it.sub,
    demandLevel: it.demand,
    maxScore: 1,
  }));
  return { responses, items };
}

describe("computeScores", () => {
  it("produces self-consistent per-participant scores", () => {
    const { responses } = buildAssessment("Applicable Math");
    const scores = engine.computeScores(responses, []);

    // One score row per participant (single assessment).
    const a = fixtures["Applicable Math"]!;
    expect(scores.length).toBe(a.participants);

    // Recompute raw/itemsSeen directly from the matrix and compare.
    const expected = new Map<string, { raw: number; seen: number }>();
    for (const r of responses) {
      const e = expected.get(r.participantId) ?? { raw: 0, seen: 0 };
      e.raw += r.score;
      e.seen += 1;
      expected.set(r.participantId, e);
    }
    for (const s of scores) {
      const e = expected.get(s.participantId)!;
      expect(s.raw).toBe(e.raw);
      expect(s.itemsSeen).toBe(e.seen);
      expect(s.pct).toBeCloseTo((e.raw / e.seen) * 100, 6);
    }
  });

  it("drops excluded items from raw, pct and items_seen", () => {
    const { responses } = buildAssessment("Applicable Math");
    const excludedId = String(fixtures["Applicable Math"]!.items[0]!.qid);

    const full = engine.computeScores(responses, []);
    const reduced = engine.computeScores(responses, [excludedId]);

    const fullByP = new Map(full.map((s) => [s.participantId, s]));
    for (const s of reduced) {
      const before = fullByP.get(s.participantId)!;
      // Every participant answered the excluded item, so itemsSeen drops by 1.
      expect(s.itemsSeen).toBe(before.itemsSeen - 1);
      expect(s.raw).toBeLessThanOrEqual(before.raw);
    }
  });

  it("pct is bounded to 0..100", () => {
    for (const name of Object.keys(fixtures)) {
      const { responses } = buildAssessment(name);
      for (const s of engine.computeScores(responses, [])) {
        expect(s.pct).toBeGreaterThanOrEqual(0);
        expect(s.pct).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("rollUp", () => {
  it("summarises by assessment, major element and demand level", () => {
    const { responses, items } = buildAssessment("Applicable Math");
    const participantScores = engine.computeScores(responses, []);
    const summary = engine.rollUp({ participantScores, responses, items });

    expect(summary.byAssessment).toHaveLength(1);
    const a = summary.byAssessment[0]!;
    expect(a.participants).toBe(fixtures["Applicable Math"]!.participants);
    expect(a.meanPct).toBeGreaterThan(0);
    expect(a.meanPct).toBeLessThanOrEqual(100);

    // Demand levels present in the fixture should appear in the roll-up.
    const demandKeys = new Set(summary.byDemandLevel.map((g) => g.key));
    const fixtureDemands = new Set(
      fixtures["Applicable Math"]!.items.map((it) => it.demand),
    );
    for (const d of fixtureDemands) expect(demandKeys.has(d)).toBe(true);

    // Distribution counts add up to the participant count.
    const total = summary.distribution.reduce((acc, b) => acc + b.count, 0);
    expect(total).toBe(participantScores.length);
  });

  it("each group mean is a proportion in 0..1", () => {
    const { responses, items } = buildAssessment("Scientific Thinking");
    const participantScores = engine.computeScores(responses, []);
    const summary = engine.rollUp({ participantScores, responses, items });
    for (const g of [...summary.byMajorElement, ...summary.byDemandLevel]) {
      expect(g.meanScore).toBeGreaterThanOrEqual(0);
      expect(g.meanScore).toBeLessThanOrEqual(1);
    }
  });
});
