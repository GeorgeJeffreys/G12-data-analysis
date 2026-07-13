/**
 * Test-only centre grade-judgement (CGJ) expectations fixture.
 *
 * Production ships no synthetic CGJ file (the `loadSampleCgj` provider affordance
 * was removed in the production cutover). This helper rebuilds a representative
 * expectations set through the REAL upload path (`uploadCgjFile`), nudged off the
 * actual grades so the comparison yields a mix of matches, above and below — so
 * the CGJ comparison tests keep exercising genuine behaviour.
 */
import type { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { CgjUploadRow } from "@/lib/data/provider";

export const CGJ_FIXTURE_FILENAME = "centre_expectations.xlsx";

export function seedCentreExpectations(provider: InMemoryDataProvider, cycleId: string): void {
  const grades = provider.getGrades(cycleId);
  const cgj = provider.getCgj(cycleId);
  const levels = cgj?.performanceLevels ?? [];
  const assessments = cgj?.assessments ?? [];
  const rows: CgjUploadRow[] = (grades?.rows ?? []).slice(0, 8).map((row, ri) => {
    const out: Record<string, string> = {};
    assessments.forEach((a, ai) => {
      const actual = row.grades[a.id]?.level;
      if (!actual) return;
      const rank = levels.indexOf(actual);
      if (rank < 0) return;
      // Deterministic nudge: vary by student+subject so we get matches, a few
      // above (centre expected less) and a few below (centre expected more).
      const shift = ((ri + ai) % 3) - 1; // −1, 0, +1
      const expectedRank = Math.min(levels.length - 1, Math.max(0, rank + shift));
      out[a.shortName] = levels[expectedRank]!;
    });
    return { studentName: row.label, levels: out };
  });
  provider.uploadCgjFile(cycleId, CGJ_FIXTURE_FILENAME, rows);
}
