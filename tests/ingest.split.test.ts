/**
 * Combined-export split / merge / summarise tests, run over the REAL sample
 * export. Confirms one combined file splits into the right subjects with correct
 * item counts, that element counts vary by subject (3–5, not fixed at 5), and
 * that merging multiple row sets reproduces the same dataset.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseExport,
  ingestAndClean,
  splitBySubject,
  summarizeSubjects,
  mergeRawExports,
} from "@/lib/ingest";
import { sampleExportPath } from "./fixtures";

function load() {
  const { rows } = parseExport(readFileSync(sampleExportPath()));
  const { cleanedResponses } = ingestAndClean(rows);
  return { rows, clean: cleanedResponses };
}

/** Find a subject summary by a case-insensitive name fragment. */
function byName<T extends { assessmentName: string }>(arr: T[], frag: string): T | undefined {
  return arr.find((s) => s.assessmentName.toLowerCase().includes(frag.toLowerCase()));
}

describe("combined export — split by subject", () => {
  const { clean } = load();

  it("splits the single combined export into its five subjects", () => {
    const groups = splitBySubject(clean);
    expect(groups.size).toBe(5);
    // every response is preserved across the split
    const total = [...groups.values()].reduce((n, rows) => n + rows.length, 0);
    expect(total).toBe(clean.length);
  });

  it("summarises each subject with the right item counts (193 items total)", () => {
    const subs = summarizeSubjects(clean);
    expect(byName(subs, "applicable maths")!.items).toBe(41);
    expect(byName(subs, "english")!.items).toBe(60);
    expect(byName(subs, "scientific")!.items).toBe(36);
    expect(byName(subs, "العربيّة")!.items).toBe(31); // Arabic
    expect(byName(subs, "life success")!.items).toBe(25);
    expect(subs.reduce((n, s) => n + s.items, 0)).toBe(193);
  });

  it("reports a varying number of major elements per subject (not hard-coded to 5)", () => {
    const subs = summarizeSubjects(clean);
    const elementCounts = subs.map((s) => s.elements.length);
    // at least one subject has fewer than 5 major elements
    expect(Math.min(...elementCounts)).toBeLessThan(5);
    // every subject has at least one element with sub-elements recorded
    for (const s of subs) {
      expect(s.elements.length).toBeGreaterThan(0);
      expect(s.elements.some((e) => e.subs.length > 0)).toBe(true);
      // demand counts sum to no more than the item count
      const d = s.demand.D1 + s.demand.D2 + s.demand.D3;
      expect(d).toBeLessThanOrEqual(s.items);
    }
  });
});

describe("combined export — merging multiple files/sheets", () => {
  const { rows, clean } = load();

  it("merging two halves of the raw rows reproduces the same cleaned dataset", () => {
    const half = Math.floor(rows.length / 2);
    const merged = mergeRawExports(rows.slice(0, half), rows.slice(half));
    expect(merged.length).toBe(rows.length);
    const { cleanedResponses } = ingestAndClean(merged);
    expect(cleanedResponses.length).toBe(clean.length);
    // and the subject split is identical
    expect(summarizeSubjects(cleanedResponses).map((s) => s.items).sort()).toEqual(
      summarizeSubjects(clean).map((s) => s.items).sort(),
    );
  });
});
