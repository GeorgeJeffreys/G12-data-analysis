/**
 * Overall best-of-two rollup — the year's two sittings (February + May) combined
 * into a single per-student, per-subject result.
 *
 * This is comparison / aggregation only. It consumes each sitting's already
 * signed-off, safeguard-checked grades (a `GradesModel`) and:
 *
 *   1. For every student × subject, takes the HIGHER of the two sittings'
 *      performance levels (by level RANK, best → lowest — never by raw score). If
 *      only one sitting has a result, that sitting's level is used. Each cell
 *      records which sitting it came from (Feb / May) for provenance.
 *   2. Derives the overall award from the best-of-two per-subject levels using the
 *      EXISTING award-derivation rule (`deriveAward`) — it does not reinvent the
 *      award rule.
 *
 * It does NOT touch scoring, cut scores, or the D3 safeguard: those are per
 * sitting and already applied to each sitting's signed-off award. At the Overall
 * level the safeguard is NOT re-run, so `deriveAward` is called with
 * `d3Pass: true` (no cap recomputed on the rolled-up levels).
 *
 * Students are matched across sittings by their human Student ID (`studentId`),
 * which is stable across the two pipeline runs (the internal cycle-scoped row id
 * is not).
 */

import { deriveAward } from "@/lib/engine";
import type {
  AssessmentRef,
  GradeMatrixRow,
  GradesModel,
  OverallGradeCell,
  OverallGradeRow,
  OverallSource,
} from "./types";

/** A blank / "" level means "no result for this subject in this sitting". */
function nonEmpty(level: string | undefined | null): string | null {
  return level && level.length > 0 ? level : null;
}

/**
 * Rank of a performance level within the best → lowest list (0 = best). A null
 * (no result) ranks worse than every real level so a present level always beats
 * an absent one; an unrecognised label is treated the same as absent.
 */
function rankOf(level: string | null, levels: readonly string[]): number {
  if (level === null) return Number.POSITIVE_INFINITY;
  const i = levels.indexOf(level);
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}

function indexByStudent(model: GradesModel | null): Map<string, GradeMatrixRow> {
  const m = new Map<string, GradeMatrixRow>();
  for (const r of model?.rows ?? []) m.set(r.studentId, r);
  return m;
}

export interface RollupArgs {
  february: GradesModel | null;
  may: GradesModel | null;
  /** Subjects to roll up (assessment refs). */
  assessments: AssessmentRef[];
  /** Performance levels, best → lowest. */
  performanceLevels: readonly string[];
  /** Award levels, best → lowest. */
  awardLevels: readonly string[];
  starMap: Record<string, string>;
}

/**
 * Roll the two sittings up into per-student best-of-two rows. Pure: no provider,
 * engine state, or scoring — it only compares already-computed awards/levels.
 */
export function rollupOverall(args: RollupArgs): OverallGradeRow[] {
  const { february, may, assessments, performanceLevels, awardLevels, starMap } = args;
  const febByStudent = indexByStudent(february);
  const mayByStudent = indexByStudent(may);

  // Union of students by Student ID. May first (the most recent sitting), then any
  // student who only sat in February (a subject/whole sitting not retaken in May).
  const order: string[] = [];
  const seen = new Set<string>();
  for (const r of may?.rows ?? []) {
    if (!seen.has(r.studentId)) { seen.add(r.studentId); order.push(r.studentId); }
  }
  for (const r of february?.rows ?? []) {
    if (!seen.has(r.studentId)) { seen.add(r.studentId); order.push(r.studentId); }
  }

  const rows: OverallGradeRow[] = [];
  for (const sid of order) {
    const fb = febByStudent.get(sid) ?? null;
    const my = mayByStudent.get(sid) ?? null;
    const label = my?.label ?? fb?.label ?? sid;

    const grades: Record<string, OverallGradeCell> = {};
    const subjectLevels: string[] = [];
    for (const a of assessments) {
      const februaryLevel = nonEmpty(fb?.grades[a.id]?.level);
      const mayLevel = nonEmpty(my?.grades[a.id]?.level);
      if (februaryLevel === null && mayLevel === null) {
        // No result in either sitting — ranks as lowest for the award derivation,
        // exactly as a never-sat subject does on the per-sitting Grades screen.
        subjectLevels.push("");
        continue;
      }
      // Best-of-two by rank (lower index = better). On a tie, and whenever only
      // May has a result, May (the latest sitting) supplies the cell; February
      // wins only when it is strictly higher or is the only result.
      const fr = rankOf(februaryLevel, performanceLevels);
      const mr = rankOf(mayLevel, performanceLevels);
      let level: string;
      let source: OverallSource;
      if (mr <= fr) {
        level = mayLevel as string;
        source = "may";
      } else {
        level = februaryLevel as string;
        source = "february";
      }
      grades[a.id] = {
        level,
        stars: starMap[level] ?? "",
        source,
        februaryLevel,
        mayLevel,
      };
      subjectLevels.push(level);
    }

    // Overall award derived from the rolled-up levels via the existing rule. The
    // safeguard is per sitting and is NOT re-run here (d3Pass: true).
    const outcome = deriveAward(
      { subjectLevels, d3Pass: true },
      { performanceLevels, awardLevels },
    );

    rows.push({
      id: sid,
      studentId: sid,
      label,
      grades,
      award: outcome.award,
      inFebruary: fb !== null,
      inMay: my !== null,
    });
  }
  return rows;
}
