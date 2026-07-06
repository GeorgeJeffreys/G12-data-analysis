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
import { resolveCohort, type SubjectCohort } from "./resolved-cohort";

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
  /** Per-stage DISTINCT participant totals across the cycle: [ingested, cleaned,
   *  matrix, computed]. A participant sitting five subjects counts once. */
  totals: number[];
  /** Distinct participants ingested (staff/test INCLUDED) — the roster of record. */
  ingested: number;
  /** Distinct participants after Clean (staff/test + soft-deletes removed). */
  cleaned: number;
  /** Distinct participants with a computed subject total. */
  computed: number;
  /** EXPECTED reduction at Clean = ingested − cleaned (staff/test + soft-deletes).
   *  This is a legitimate exclusion, never "loss". */
  removedByCleaning: number;
  /** UNEXPECTED loss = cleaned − computed: cleaned sitters that never produced a
   *  score (the dropped-sitter / collapse signature). 0 on a healthy pipeline. */
  lost: number;
  /** The worst UNEXPECTED transition (cleaned→matrix→computed); null when none.
   *  The expected detected→cleaned staff drop is never reported here. */
  worstStage: DataFlowWorstStage | null;
  /** empty → not ingested · collapse → an UNEXPECTED drop exists · healthy → the
   *  only reduction is the expected staff/soft-delete removal at Clean. */
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

  // The ONE canonical cohort — Upload, Clean and Data-flow all read this, so their
  // per-stage counts can never diverge (see lib/data/resolved-cohort.ts). The
  // membership sets below are taken verbatim from it; the per-person cells/score
  // detail is still read from the same raw + composition artifacts.
  const resolved = resolveCohort(provider, cycleId);
  const cohortByAssessment = new Map<string, SubjectCohort>();
  for (const c of resolved?.subjects ?? []) cohortByAssessment.set(c.assessmentId, c);

  const subjects: DataFlowSubject[] = [];
  for (const a of cycle.assessments) {
    const raw = provider.getRawData(cycleId, a.id);
    const cleaned = provider.getDataCleaning(cycleId, a.id);
    if (!raw || !cleaned) continue; // subject with no scorable data
    const cohort = cohortByAssessment.get(a.id);
    if (!cohort) continue;

    const items = raw.items;

    // Raw rows keyed on the internal id → the ingested response matrix.
    const rowById = new Map<string, RawDataRow>();
    for (const r of raw.rows) rowById.set(r.id, r);

    const people: DataFlowPerson[] = [];
    const staff: DataFlowPerson[] = [];
    for (const r of raw.rows) {
      const email = r.studentId;
      const cells = cellsOf(r);
      const att = cells.reduce<number>((n, c) => n + (c === "·" ? 0 : 1), 0);
      if (cohort.staff.has(r.id)) {
        staff.push({ id: r.id, name: r.name, email, last: 0, att, items, score: null, cells, staff: true, tag: "staff/test" });
        continue; // staff never counted as participants
      }
      // last stage reached, from the canonical membership sets.
      const inMatrix = cohort.matrix.has(r.id);
      const inComputed = cohort.computed.has(r.id);
      const inCleaned = cohort.cleaned.has(r.id);
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

    // Per-stage per-subject counts come from the ONE canonical cohort (sittings-
    // backed), NOT the `people` array: `detected` (ingest) INCLUDES staff/test, and
    // `cleaned` drops them — so the legitimate staff reduction at Clean is visible
    // instead of pre-hidden. matrix/computed are the pivot's / engine's own output.
    const counts = [cohort.detected.size, cohort.cleaned.size, cohort.matrix.size, cohort.computed.size];

    subjects.push({ key: a.id, subj: a.shortName, name: a.name, items, rtl: a.rtl, counts, people, staff });
  }

  const stageCount = DF_STAGES.length;
  // Totals are DISTINCT participants across the whole cycle at each stage (a person
  // sitting five subjects is one participant), never the sum of per-subject counts —
  // so "18 ingested / 16 computed" reads as the real headcount, not 59 sitting-rows.
  const distinctAt = (pick: (c: SubjectCohort) => Set<string>) => {
    const all = new Set<string>();
    for (const c of resolved?.subjects ?? []) for (const id of pick(c)) all.add(id);
    return all.size;
  };
  const totals = [
    resolved?.detectedTotal ?? distinctAt((c) => c.detected),
    resolved?.cleanedTotal ?? distinctAt((c) => c.cleaned),
    distinctAt((c) => c.matrix),
    resolved?.computedTotal ?? distinctAt((c) => c.computed),
  ];
  const ingested = totals[0]!;
  const cleaned = totals[1]!;
  const computed = totals[stageCount - 1]!;
  // detected→cleaned is the EXPECTED staff/test + soft-delete removal, not loss.
  const removedByCleaning = Math.max(0, ingested - cleaned);
  // Loss is only what disappears AFTER Clean — a cleaned sitter that never scored.
  const lost = Math.max(0, cleaned - computed);

  // Worst stage = the worst UNEXPECTED transition (cleaned→matrix→computed only).
  // The expected detected→cleaned staff drop (i=1) is never a "worst stage".
  let worstStage: DataFlowWorstStage | null = null;
  for (let i = 2; i < stageCount; i++) {
    const delta = totals[i]! - totals[i - 1]!;
    if (delta < 0 && (!worstStage || delta < worstStage.delta)) {
      worstStage = { key: DF_STAGES[i]!.key, name: DF_STAGES[i]!.name, delta, from: totals[i - 1]!, to: totals[i]! };
    }
  }

  const hasData = subjects.length > 0 && (ingest?.uploaded ?? true) && ingested > 0;
  // An UNEXPECTED drop is one at or after the score matrix — a cleaned sitter that
  // failed to produce a score. The staff/soft-delete reduction at Clean (detected→
  // cleaned) is expected and does NOT make the pipeline "collapsed".
  const anomalousDrop =
    totals[2]! < totals[1]! ||
    totals[3]! < totals[2]! ||
    subjects.some((s) => s.counts[2]! < s.counts[1]! || s.counts[3]! < s.counts[2]!);
  const state: DataFlowState = !hasData ? "empty" : anomalousDrop ? "collapse" : "healthy";

  return {
    cycleId,
    cycleName: cycle.name,
    stages: DF_STAGES,
    subjects,
    totals,
    ingested,
    cleaned,
    computed,
    removedByCleaning,
    lost,
    worstStage,
    state,
  };
}
