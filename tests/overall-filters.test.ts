/**
 * The Overall slicer must actually re-slice. Two regressions are locked here:
 *   1. `getOverallAnalytics({ centres })` re-pools participation / perf /
 *      awardDist / spreads from just the named centres — not only the per-centre
 *      columns.
 *   2. `finalToLegacy` is non-lossy for what the sections read: Exam is a single
 *      lens (no "Combined always wins" collapse) and the full subject
 *      multi-select flows through as `subjects`.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { finalToLegacy, defaultFinalSlice } from "@/components/ui/overall/slicer";

const provider = new InMemoryDataProvider();
const full = provider.getOverallAnalytics();
const latest = full.years[full.years.length - 1]!;

describe("getOverallAnalytics centre filter re-pools every figure", () => {
  it("filtered result lists only the selected centres", () => {
    const one = full.centres[0]!;
    const filtered = provider.getOverallAnalytics({ centres: [one] });
    expect(filtered.centres).toEqual([one]);
  });

  it("participation is re-pooled: one centre has fewer sitters than the whole programme", () => {
    const one = full.centres[0]!;
    const filtered = provider.getOverallAnalytics({ centres: [one] });
    expect(full.centres.length).toBeGreaterThan(1);
    expect(filtered.participation[latest]!.satFeb).toBeLessThan(full.participation[latest]!.satFeb);
  });

  it("per-subject cross-centre spread collapses to zero σ under a single centre (re-pooled, not pre-pooled)", () => {
    const one = full.centres[0]!;
    const filtered = provider.getOverallAnalytics({ centres: [one] });
    const key = full.subjects[0]!.key;
    expect(full.centreSubjectSpread[key]![latest]!.sd).toBeGreaterThan(0);
    expect(filtered.centreSubjectSpread[key]![latest]!.sd).toBe(0);
  });

  it("a two-centre subset re-pools between one-centre and all-centre participation", () => {
    const [a, b] = [full.centres[0]!, full.centres[1]!];
    const two = provider.getOverallAnalytics({ centres: [a, b] });
    const oneA = provider.getOverallAnalytics({ centres: [a] });
    expect(two.centres.sort()).toEqual([a, b].sort());
    expect(two.participation[latest]!.satFeb).toBeGreaterThanOrEqual(oneA.participation[latest]!.satFeb);
    expect(two.participation[latest]!.satFeb).toBeLessThanOrEqual(full.participation[latest]!.satFeb);
  });

  it("omitting the filter (or empty centres) is the full programme view", () => {
    expect(provider.getOverallAnalytics({ centres: [] }).centres).toEqual(full.centres);
    expect(provider.getOverallAnalytics().centres).toEqual(full.centres);
  });
});

describe("finalToLegacy is non-lossy for the sections", () => {
  const base = defaultFinalSlice(full);

  it("Exam is a single lens — ticking February is honoured, not overridden by Combined", () => {
    expect(finalToLegacy({ ...base, exams: ["February"] }, full).exam).toBe("February");
    expect(finalToLegacy({ ...base, exams: ["May"] }, full).exam).toBe("May");
    expect(finalToLegacy({ ...base, exams: ["Combined"] }, full).exam).toBe("Combined");
  });

  it("the full subject multi-select flows through (not collapsed to null when >1)", () => {
    const two = [full.subjects[0]!.key, full.subjects[1]!.key];
    const leg = finalToLegacy({ ...base, subjects: two }, full);
    expect(leg.subjects).toEqual(two);
    expect(leg.subject).toBeNull(); // single-focus convenience is null when >1
  });

  it("exactly one selected subject sets both `subjects` and the single-focus `subject`", () => {
    const one = finalToLegacy({ ...base, subjects: [full.subjects[0]!.key] }, full);
    expect(one.subjects).toEqual([full.subjects[0]!.key]);
    expect(one.subject).toBe(full.subjects[0]!.key);
  });
});
