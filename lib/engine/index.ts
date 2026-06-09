/**
 * Computation engine — the single boundary behind which all psychometric and
 * scoring maths lives (Section 8 of the spec).
 *
 * ## Swap point (read this before replacing the engine)
 *
 * Callers depend ONLY on the `ComputationEngine` interface and the domain types
 * in `./types`. The current implementation, `TypeScriptEngine`, is a transparent
 * TypeScript port whose item statistics are verified cell-for-cell against the
 * data scientist's published outputs (see tests/engine.parity.test.ts).
 *
 * To swap in the validated Python later:
 *   1. Implement `ComputationEngine` with a class that calls the Python service
 *      (HTTP/RPC) or a WASM/port build, mapping the same inputs/outputs.
 *   2. Bump `ENGINE_VERSION` so every stored result is tagged with the new
 *      engine (the `engine_version` column).
 *   3. Return that implementation from `getEngine()`.
 * No caller, route, table or test signature changes — only this file does. The
 * parity test must pass against the new engine on a known cycle before it is
 * trusted in production.
 */

import { ingestAndClean as ingestAndCleanRows } from "@/lib/ingest";
import { computeItemStats as computeItemStatsImpl } from "./stats";
import { computeScores as computeScoresImpl } from "./scores";
import { rollUp as rollUpImpl } from "./rollup";
import type {
  IngestResult,
  ItemMeta,
  ItemStat,
  ItemStatsInput,
  ParticipantScore,
  RawExport,
  ResponseRecord,
  RollUp,
  RollUpInput,
  CleanResponse,
} from "./types";

/** Bump on any change to the maths or when swapping in a new engine. */
export const ENGINE_VERSION = "ts-engine-0.1.0";

export interface ComputationEngine {
  readonly version: string;
  ingestAndClean(rawExport: RawExport): IngestResult;
  computeItemStats(input: ItemStatsInput): ItemStat[];
  computeScores(
    responses: ResponseRecord[],
    excludedItemIds: string[],
  ): ParticipantScore[];
  rollUp(input: RollUpInput): RollUp;
}

/**
 * Map cleaned ingest responses to the engine's `ResponseRecord` shape. Items are
 * keyed by their Questionmark question id and assessments by name; the engine is
 * id-agnostic, so any stable identifiers work equally well.
 */
export function responsesFromClean(clean: readonly CleanResponse[]): ResponseRecord[] {
  return clean.map((r) => ({
    participantId: r.participantPseudonym,
    itemId: r.qmQuestionId,
    assessmentId: r.assessmentName,
    score: r.answerScore,
  }));
}

class TypeScriptEngine implements ComputationEngine {
  readonly version = ENGINE_VERSION;

  ingestAndClean(rawExport: RawExport): IngestResult {
    return ingestAndCleanRows(rawExport);
  }

  computeItemStats(input: ItemStatsInput): ItemStat[] {
    return computeItemStatsImpl(input.responses, this.version, input.items);
  }

  computeScores(
    responses: ResponseRecord[],
    excludedItemIds: string[],
  ): ParticipantScore[] {
    return computeScoresImpl(responses, excludedItemIds);
  }

  rollUp(input: RollUpInput): RollUp {
    return rollUpImpl(input);
  }
}

const engine: ComputationEngine = new TypeScriptEngine();

/** The active engine. The only place to change when swapping in Python. */
export function getEngine(): ComputationEngine {
  return engine;
}

export {
  computeItemStats,
  pearson,
  round,
  rateP,
  rateCorrelation,
  worstRating,
} from "./stats";
export { computeScores } from "./scores";
export { rollUp } from "./rollup";
export type {
  ItemMeta,
  ItemStat,
  ItemStatsInput,
  ParticipantScore,
  ResponseRecord,
  RollUp,
  RollUpInput,
  IngestResult,
  RawExport,
  QualityRating,
} from "./types";
