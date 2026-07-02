/**
 * Developer "Data flow" model (task 15) — the READ-ONLY assembler behind the
 * pipeline-inspector page (design: hfDataFlow.jsx). It reveals what happens to ONE
 * cycle's data at each processing stage, so participant loss between stages is
 * impossible to miss.
 *
 * Every figure and every row here is read from the provider's OWN computed
 * artifacts — the exact data the app scores and grades on — keyed on the internal
 * participant id. It never recomputes a parallel "correct" version: if a subject is
 * really 7 at Computed, the strip shows 7. The four stages, left → right:
 *
 *   1. Ingested       — getRawData: the raw response matrix as received (identity
 *                       already resolved at ingest on the collision-free email →
 *                       internalParticipantId; staff/test accounts are present but
 *                       not counted as participants).
 *   2. Cleaned cohort — getDataCleaning: staff/test excluded by email + soft-deletes
 *                       removed (excludedRows / cohortExcludedSet).
 *   3. Score matrix   — the cleaned cohort pivoted to students × QuestionId, dedupe
 *                       (student, QuestionId) last, missing → 0 (getNaiveScores /
 *                       build-live-cycle.ts).
 *   4. Computed scores— getComposition: one engine subject total per valid student.
 *
 * The three page states (empty / healthy / collapse) are DATA-DRIVEN conditions on
 * this model, not separate screens.
 */

import type { DataProvider } from "./provider";
import type { RawDataRow } from "./types";
import { isStaffTestEmail } from "./staff-exclusions";

export type DataFlowStageKey = "ingested" | "cleaned" | "matrix" | "computed";

export interface DataFlowStage {
  key: DataFlowStageKey;
  name: string;
  blurb: string;
}

/** The pipeline the inspector walks — the real per-cycle stages, left → right. */
export const DF_STAGES: DataFlowStage[] = [
  { key: "ingested", name: "Ingested", blurb: "Raw response rows as received" },
  { key: "cleaned", name: "Cleaned cohort", blurb: "Identity resolved · accounts filtered" },
  { key: "matrix", name: "Score matrix", blurb: "Students × question · deduped" },
  { key: "computed", name: "Computed scores", blurb: "A raw score per valid student" },
];

export const DF_STAGE_INDEX: Record<DataFlowStageKey, number> = { ingested: 0, cleaned: 1, matrix: 2, computed: 3 };

/** A cell in the per-question response matrix: 1 correct · 0 incorrect · "·" not attempted. */
export type DataFlowCell = number | "·";

/** One participant's journey across the four stages, from the real artifacts. */
export interface DataFlowPerson {
  /** Internal participant id (the stable, collision-free key). */
  id: string;
  name: string;
  /** The participant's email / student id (the identity key). */
  email: string;
  /** Index of the last stage this participant is present in (0..3). */
  last: number;
  /** Items the participant attempted (answered), from the real matrix. */
  att: number;
  /** Fixed question count for the subject. */
  items: number;
  /** Raw MCQ score (correct count) once computed; null when never computed. */
  score: number | null;
  /** Per-question cells (length = items): 1 / 0 / "·". */
  cells: DataFlowCell[];
  /** True for a staff/test account shown struck-through (never counted). */
  staff?: boolean;
  /** Short tag for a struck account. */
  tag?: string;
}

export interface DataFlowSubject {
  /** assessmentId. */
  key: string;
  /** Short subject name. */
  subj: string;
  /** Full subject name. */
  name: string;
  /** Fixed question count. */
  items: number;
  rtl: boolean;
  /** Distinct participant count at each stage: [ingested, cleaned, matrix, computed]. */
  counts: number[];
  /** Real per-participant journeys (excludes staff/test). */
  people: DataFlowPerson[];
  /** Staff/test rows removed at the Cleaned stage (shown struck, never counted). */
  staff: DataFlowPerson[];
}

export interface DataFlowWorstStage {
  key: DataFlowStageKey;
  name: string;
  /** Signed participant delta at this stage (negative = loss). */
  delta: number;
  from: number;
  to: number;
}

export type DataFlowState = "empty" | "healthy" | "collapse";

export interface DataFlowModel {
  cycleId: string;
  cycleName: string;
  stages: DataFlowStage[];
  subjects: DataFlowSubject[];
  /** Per-stage totals across all subjects. */
  totals: number[];
  ingested: number;
  computed: number;
  /** Participants lost overall (ingested − computed). */
  lost: number;
  /** The stage transition that lost the most participants (null when none). */
  worstStage: DataFlowWorstStage | null;
  /** empty → not ingested · collapse → a drop exists · healthy → counts hold. */
  state: DataFlowState;
}

/** Cells for one raw row: everything after the Participant + Student ID columns. */
function cellsOf(row: RawDataRow): DataFlowCell[] {
  return row.cells.map((v) => (v === 1 ? 1 : v === 0 ? 0 : "·"));
}

/**
 * Assemble the data-flow model for a cycle from the provider's own read-models.
 * Pure and strictly read-only: it calls getters only, never a mutator. Returns
 * null when the cycle is unknown.
 */
export function buildDataFlow(provider: DataProvider, cycleId: string): DataFlowModel | null {
  const cycle = provider.getCycle(cycleId);
  if (!cycle) return null;

  const ingest = provider.getIngest(cycleId);
  const composition = provider.getComposition(cycleId);

  const subjects: DataFlowSubject[] = [];
  for (const a of cycle.assessments) {
    const raw = provider.getRawData(cycleId, a.id);
    const cleaned = provider.getDataCleaning(cycleId, a.id);
    if (!raw || !cleaned) continue; // subject with no scorable data
    // The REAL Score-matrix artifact: the students × QuestionId pivot's own output
    // (getNaiveScores — the as-submitted matrix, before item-review exclusions).
    const naive = provider.getNaiveScores(cycleId, a.id);

    const items = raw.items;

    // Raw rows keyed on the internal id → the ingested response matrix.
    const rowById = new Map<string, RawDataRow>();
    for (const r of raw.rows) rowById.set(r.id, r);

    // Cohort-excluded ids shown at Clean (staff/test + soft-deletes).
    const excludedIds = new Set(cleaned.excludedRows);
    // Score-matrix membership = the participants the pivot ACTUALLY emitted a row
    // for, read straight from getNaiveScores — never re-derived from the cleaned
    // cohort. Sourcing it from the pivot's own output is what keeps a matrix-stage
    // drop (a cleaned participant who produces no pivot row) VISIBLE here instead of
    // being silently folded into a balanced-looking count. Fall back to the cleaned
    // cohort only when the pivot artifact isn't available yet (e.g. pre-scoring), so
    // an in-progress cycle isn't misreported as a total matrix collapse.
    const matrixIds = new Set<string>(
      naive
        ? naive.students.map((s) => s.id)
        : cleaned.rows.filter((r) => !excludedIds.has(r.id)).map((r) => r.id),
    );
    // Computed membership = students with an engine subject total here.
    const computedIds = new Set<string>();
    if (composition) {
      for (const s of composition.students) {
        if (s.subjects.some((x) => x.assessmentId === a.id)) computedIds.add(s.participantId);
      }
    }

    const people: DataFlowPerson[] = [];
    const staff: DataFlowPerson[] = [];
    for (const r of raw.rows) {
      const email = r.studentId;
      const cells = cellsOf(r);
      const att = cells.reduce<number>((n, c) => n + (c === "·" ? 0 : 1), 0);
      if (isStaffTestEmail(email)) {
        staff.push({ id: r.id, name: r.name, email, last: 0, att, items, score: null, cells, staff: true, tag: "staff/test" });
        continue; // staff never counted as participants
      }
      // last stage reached, from the real membership sets.
      const inMatrix = matrixIds.has(r.id);
      const inComputed = computedIds.has(r.id);
      const inCleaned = !excludedIds.has(r.id);
      const last = inComputed ? 3 : inMatrix ? 2 : inCleaned ? 1 : 0;
      // Real raw MCQ score for a computed student (correct count on retained items).
      let score: number | null = null;
      if (inComputed && composition) {
        const st = composition.students.find((x) => x.participantId === r.id);
        const sub = st?.subjects.find((x) => x.assessmentId === a.id);
        score = sub ? sub.mcq : null;
      }
      people.push({ id: r.id, name: r.name, email, last, att, items, score, cells });
    }

    // Distinct participant count at each stage (staff already excluded from `people`).
    const atLeast = (si: number) => people.filter((p) => p.last >= si).length;
    const counts = [people.length, atLeast(1), atLeast(2), atLeast(3)];

    subjects.push({ key: a.id, subj: a.shortName, name: a.name, items, rtl: a.rtl, counts, people, staff });
  }

  const stageCount = DF_STAGES.length;
  const totals = Array.from({ length: stageCount }, (_, i) => subjects.reduce((acc, s) => acc + s.counts[i]!, 0));
  const ingested = totals[0]!;
  const computed = totals[stageCount - 1]!;
  const lost = ingested - computed;

  // Worst stage = the transition that lost the most participants overall.
  let worstStage: DataFlowWorstStage | null = null;
  for (let i = 1; i < stageCount; i++) {
    const delta = totals[i]! - totals[i - 1]!;
    if (delta < 0 && (!worstStage || delta < worstStage.delta)) {
      worstStage = { key: DF_STAGES[i]!.key, name: DF_STAGES[i]!.name, delta, from: totals[i - 1]!, to: totals[i]! };
    }
  }

  const hasData = subjects.length > 0 && (ingest?.uploaded ?? true) && ingested > 0;
  const anyDrop = subjects.some((s) => s.counts.some((c, i) => i > 0 && c < s.counts[i - 1]!));
  const state: DataFlowState = !hasData ? "empty" : anyDrop ? "collapse" : "healthy";

  return {
    cycleId,
    cycleName: cycle.name,
    stages: DF_STAGES,
    subjects,
    totals,
    ingested,
    computed,
    lost,
    worstStage,
    state,
  };
}
