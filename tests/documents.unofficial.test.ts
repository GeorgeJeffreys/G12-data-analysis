/**
 * Part 4 — the unofficial element-level report. Proves getDocuments produces, per
 * student, an UNOFFICIAL diagnostic payload that shows the achieved level not just
 * at subject level but at major-element and sub-element granularity — slotted
 * alongside the certificate + performance report via the same documents model.
 */

import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";

const CYCLE = "may-2026";

describe("unofficial element-level report (Part 4)", () => {
  it("is only populated once grades are locked (same gate as the other documents)", () => {
    const p = new InMemoryDataProvider();
    expect(p.getDocuments(CYCLE)!.students).toHaveLength(0);
    p.lockCycle(CYCLE);
    expect(p.getDocuments(CYCLE)!.students.length).toBeGreaterThan(0);
  });

  it("each student carries a per-subject element / sub-element breakdown", () => {
    const p = new InMemoryDataProvider();
    p.lockCycle(CYCLE);
    const levels = new Set(p.getGradingDefaults().performanceLevels);
    const students = p.getDocuments(CYCLE)!.students;

    let sawSubElements = false;
    for (const s of students) {
      expect(Array.isArray(s.unofficial)).toBe(true);
      for (const subj of s.unofficial!) {
        // subject-level result still present
        expect(typeof subj.assessment).toBe("string");
        for (const el of subj.elements) {
          // the achieved level at major-element granularity is a real level
          if (el.level) expect(levels.has(el.level)).toBe(true);
          for (const su of el.subs) {
            if (su.level) {
              expect(levels.has(su.level)).toBe(true);
              sawSubElements = true;
            }
          }
        }
      }
    }
    // the richer, sub-element granularity genuinely appears
    expect(sawSubElements).toBe(true);
  });

  it("element counts are read from the construct structure (not hardcoded to 5)", () => {
    const p = new InMemoryDataProvider();
    p.lockCycle(CYCLE);
    const s = p.getDocuments(CYCLE)!.students[0]!;
    const elementCounts = (s.unofficial ?? []).map((u) => u.elements.length).filter((n) => n > 0);
    // at least one subject has fewer than 5 major elements — proves it's data-driven
    expect(Math.min(...elementCounts)).toBeLessThan(5);
  });
});
