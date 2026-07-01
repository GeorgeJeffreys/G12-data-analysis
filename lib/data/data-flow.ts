/**
 * Developer data-flow model — a READ-ONLY assembly of the real pipeline artifacts
 * at every stage, for the "see the data + transformation at each step" developer
 * view (task 15).
 *
 * It never recomputes a parallel version of anything: every figure and every row
 * here is read straight from the provider's OWN computed read-models — the exact
 * artifacts the app scores and grades on, keyed on the internal participant id.
 * The four stages, left → right, and where each pulls its real data from:
 *
 *   1. Ingested       — `getRawData` (the untouched raw matrix: every participant
 *                        who sat, every item, keyed on the internal id minted at
 *                        ingest from the collision-free email — participant-identity.ts).
 *   2. Cleaned cohort — `getDataCleaning` (the same matrix after staff/test exclusion
 *                        by email + soft-deleted rows; excluded rows are struck).
 *   3. Score matrix   — the cleaned cohort pivoted to students × QuestionId, dedupe
 *                        `(student, QuestionId)` last, fillna 0 (the shape the engine's
 *                        `computeItemStats` / `computeScores` consume — see
 *                        build-live-cycle.ts / engine/scores.ts). Reconciles 1:1 with
 *                        `getNaiveScores`.
 *   4. Computed scores— `getComposition` (per-student subject totals the engine
 *                        produced: retained MCQ + essay + alterations, after item-review
 *                        exclusions).
 *
 * Because stage N's input is stage N−1's output, we hold ONE artifact table per
 * stage; the view renders stage N's Input as the previous stage's Output.
 */

import type { DataProvider } from "./provider";
import type { RawColumnMeta, RawDataRow } from "./types";

export type DataFlowStageKey = "ingested" | "cleaned" | "matrix" | "computed";

/** A cell value in a stage artifact table. */
export type DataFlowCell = string | number | null;

export interface DataFlowTable {
  /** Column headers (first two are always Participant + Student ID). */
  headers: string[];
  rows: DataFlowCell[][];
  /** Internal participant id per row, aligned to `rows` (null when not a participant row). */
  participantIds: (string | null)[];
  /** Row indices (into `rows`) that are excluded / struck through at this stage. */
  struckRows: number[];
  note: string | null;
}

export interface DataFlowStage {
  key: DataFlowStageKey;
  label: string;
  /** Plain description of what the stage does. */
  transform: string;
  /** The identity / dedupe / pivot key the stage operates on. */
  operatesOn: string;
  /** Where the real artifact is read from (provider method + code path). */
  source: string;
}

export interface DataFlowStageCount {
  participants: number;
  items: number;
  /** Participants at the previous stage (null for the first stage). */
  prevParticipants: number | null;
  /** True when participants dropped from the previous stage (the collapse marker). */
  participantDrop: boolean;
  /** True when items dropped from the previous stage. */
  itemDrop: boolean;
}

export interface DataFlowSubject {
  assessmentId: string;
  name: string;
  shortName: string;
  rtl: boolean;
  counts: Record<DataFlowStageKey, DataFlowStageCount>;
  /** The output artifact of each stage (input of stage N = output of stage N−1). */
  tables: Record<DataFlowStageKey, DataFlowTable>;
  /** True when ANY stage dropped participants vs the previous stage. */
  hasParticipantDrop: boolean;
}

/** Raw-export provenance shown as the Input to stage 1 (no fabricated raw rows). */
export interface DataFlowIngestProvenance {
  rawRows: number;
  mcqRows: number;
  droppedSurveyRows: number;
  droppedNonMcqRows: number;
  participants: number;
  items: number;
  files: { items: string | null; assessments: string | null; topics: string | null };
}

export interface DataFlowModel {
  cycleId: string;
  cycleName: string;
  /** The four stage descriptions, in pipeline order. */
  stages: DataFlowStage[];
  subjects: DataFlowSubject[];
  ingest: DataFlowIngestProvenance | null;
}

/** The four stage descriptions — pulled from the actual code path, not a guess. */
export const DATA_FLOW_STAGES: DataFlowStage[] = [
  {
    key: "ingested",
    label: "Ingested",
    transform:
      "Parse the Questionmark export, keep MCQ rows (drop surveys / non-MCQ), and resolve each result's participant identity, minting a stable internal id from the collision-free email — never from a name, initial or date of birth.",
    operatesOn: "identity key: ResultParticipantName (email) → internalParticipantId()",
    source: "getRawData(cycleId, assessmentId) — the untouched raw matrix (lib/ingest/participant-identity.ts, build-live-cycle.ts)",
  },
  {
    key: "cleaned",
    label: "Cleaned cohort",
    transform:
      "Exclude staff / test accounts by email and any soft-deleted rows from the whole cohort. Removals are struck through (kept visible), never destroyed, and propagate downstream.",
    operatesOn: "cohort exclusion key: internal participant id (isStaffTestEmail on the stable email)",
    source: "getDataCleaning(cycleId, assessmentId) — cleaned view + excludedRows (in-memory-provider cohortExcludedSet)",
  },
  {
    key: "matrix",
    label: "Score matrix",
    transform:
      "Pivot the cleaned cohort to students × QuestionId, dedupe (student, QuestionId) keeping the last, and fill unanswered cells with 0 — the response matrix the engine scores.",
    operatesOn: "pivot key: (internal participant id, QuestionId)",
    source: "cleaned cohort pivoted (reconciles 1:1 with getNaiveScores; engine/scores.ts, build-live-cycle.ts)",
  },
  {
    key: "computed",
    label: "Computed scores",
    transform:
      "Run the engine: sum each student's scores over the RETAINED MCQ items (item-review exclusions dropped), then add the essay mark and any alterations — MCQ + Essay + Alterations = subject total.",
    operatesOn: "score key: (internal participant id, assessmentId)",
    source: "getComposition(cycleId) — per-student subject totals (lib/engine/scores.ts computeScores)",
  },
];

const ID_HEADERS = ["Participant", "Student ID"] as const;

/** Header row for a per-question matrix table (Participant, Student ID, then items). */
function matrixHeaders(columns: RawColumnMeta[]): string[] {
  return [...ID_HEADERS, ...columns.map((c) => c.qLabel)];
}

/** One participant row for a per-question matrix, mapping null cells via `fillNull`. */
function matrixRow(r: RawDataRow, fillNull: DataFlowCell): DataFlowCell[] {
  return [r.name, r.studentId, ...r.cells.map((v) => (v == null ? fillNull : v))];
}

/**
 * Assemble the developer data-flow model for a cycle from the provider's own
 * read-models. Pure and read-only: it calls getters only, never a mutator.
 * Returns null when the cycle is unknown.
 */
export function buildDataFlow(provider: DataProvider, cycleId: string): DataFlowModel | null {
  const cycle = provider.getCycle(cycleId);
  if (!cycle) return null;

  const ingestModel = provider.getIngest(cycleId);
  const ingest: DataFlowIngestProvenance | null =
    ingestModel && ingestModel.uploaded
      ? {
          rawRows: ingestModel.report.stats.rawRows,
          mcqRows: ingestModel.report.stats.mcqRows,
          droppedSurveyRows: ingestModel.report.stats.droppedSurveyRows,
          droppedNonMcqRows: ingestModel.report.stats.droppedNonMcqRows,
          participants: ingestModel.report.stats.participants,
          items: ingestModel.report.stats.items,
          files: ingestModel.files,
        }
      : null;

  const composition = provider.getComposition(cycleId);

  const subjects: DataFlowSubject[] = [];
  for (const a of cycle.assessments) {
    const raw = provider.getRawData(cycleId, a.id);
    const cleaned = provider.getDataCleaning(cycleId, a.id);
    if (!raw || !cleaned) continue; // subject with no scorable data — skip

    const naive = provider.getNaiveScores(cycleId, a.id);
    const review = provider.getReview(cycleId, a.id);

    // ── Stage 1: Ingested (the untouched raw matrix) ──────────────────────────
    const ingestedTable: DataFlowTable = {
      headers: matrixHeaders(raw.columns),
      rows: raw.rows.map((r) => matrixRow(r, "·")),
      participantIds: raw.rows.map((r) => r.id),
      struckRows: [],
      note: "Every participant who sat, keyed on the internal id. · = item not answered.",
    };

    // ── Stage 2: Cleaned cohort (staff/test + soft-deletes struck) ────────────
    const excludedRowIds = new Set(cleaned.excludedRows);
    const cleanedTable: DataFlowTable = {
      headers: matrixHeaders(cleaned.columns),
      rows: cleaned.rows.map((r) => matrixRow(r, "·")),
      participantIds: cleaned.rows.map((r) => r.id),
      struckRows: cleaned.rows.map((r, i) => (excludedRowIds.has(r.id) ? i : -1)).filter((i) => i >= 0),
      note: "Struck rows are excluded cohort-wide (staff / test / soft-deleted) — dropped from every stage below.",
    };

    // ── Stage 3: Score matrix (cleaned cohort, staff dropped, fillna 0) ───────
    const matrixSourceRows = cleaned.rows.filter((r) => !excludedRowIds.has(r.id));
    const matrixTable: DataFlowTable = {
      headers: matrixHeaders(cleaned.columns),
      rows: matrixSourceRows.map((r) => matrixRow(r, 0)),
      participantIds: matrixSourceRows.map((r) => r.id),
      struckRows: [],
      note: "Distinct students × QuestionId; unanswered filled with 0. This is what the engine scores.",
    };

    // ── Stage 4: Computed scores (engine subject totals) ──────────────────────
    const compRows: DataFlowCell[][] = [];
    const compIds: (string | null)[] = [];
    if (composition) {
      for (const s of composition.students) {
        const sub = s.subjects.find((x) => x.assessmentId === a.id);
        if (!sub) continue;
        compRows.push([s.name, s.participantId, sub.mcq, sub.essay, sub.alterations, sub.total, sub.max, sub.pct]);
        compIds.push(s.participantId);
      }
    }
    const computedTable: DataFlowTable = {
      headers: ["Participant", "Student ID", "MCQ", "Essay", "Alterations", "Total", "Max", "%"],
      rows: compRows,
      participantIds: compIds,
      struckRows: [],
      note: "One row per student who has a computed score for this subject: MCQ + Essay + Alterations = Total.",
    };

    // ── Per-stage counts (participants + items), with drop detection ──────────
    const retainedItems = review ? review.items.filter((it) => !it.excluded).length : cleaned.columns.length;
    const ingestedC = { participants: raw.participants, items: raw.items };
    const cleanedC = { participants: cleaned.rows.length - cleaned.excludedRows.length, items: cleaned.columns.length };
    const matrixC = { participants: matrixSourceRows.length, items: naive ? naive.mcqItems : cleaned.columns.length };
    const computedC = { participants: compRows.length, items: retainedItems };

    const ordered: Array<[DataFlowStageKey, { participants: number; items: number }]> = [
      ["ingested", ingestedC],
      ["cleaned", cleanedC],
      ["matrix", matrixC],
      ["computed", computedC],
    ];
    const counts = {} as Record<DataFlowStageKey, DataFlowStageCount>;
    let prev: { participants: number; items: number } | null = null;
    let hasParticipantDrop = false;
    for (const [key, c] of ordered) {
      const participantDrop = prev != null && c.participants < prev.participants;
      const itemDrop = prev != null && c.items < prev.items;
      if (participantDrop) hasParticipantDrop = true;
      counts[key] = {
        participants: c.participants,
        items: c.items,
        prevParticipants: prev ? prev.participants : null,
        participantDrop,
        itemDrop,
      };
      prev = c;
    }

    subjects.push({
      assessmentId: a.id,
      name: a.name,
      shortName: a.shortName,
      rtl: a.rtl,
      counts,
      tables: { ingested: ingestedTable, cleaned: cleanedTable, matrix: matrixTable, computed: computedTable },
      hasParticipantDrop,
    });
  }

  return {
    cycleId,
    cycleName: cycle.name,
    stages: DATA_FLOW_STAGES,
    subjects,
    ingest,
  };
}
