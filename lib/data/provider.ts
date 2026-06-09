/**
 * DataProvider — the repository interface every screen talks to. This is the
 * swap point for persistence, mirroring the discipline used for the computation
 * engine.
 *
 * ## Swap point (read before wiring Supabase)
 *
 * The UI imports only this interface and the read-model types in `./types`. The
 * current implementation, `InMemoryDataProvider`, seeds itself from genuine
 * engine output (`seed.generated.json`) and keeps decisions (exclusions,
 * boundaries, locks) in memory — they reset on reload. To go live:
 *   1. Implement `DataProvider` with a class backed by Supabase (queries +
 *      the SECURITY DEFINER RPCs from migration 0001), mapping rows to the same
 *      read models.
 *   2. Provide it through `DataProviderContext` instead of the in-memory one.
 * No screen or component changes — only the provider does.
 */

import type {
  BoundaryMode,
  CurrentUser,
  CycleDetail,
  CycleSummary,
  DuplicateStrategy,
  GradesModel,
  IngestModel,
  ReviewModel,
  BoundaryModel,
} from "./types";

export interface SetBoundaryInput {
  mode?: BoundaryMode;
  cuts?: Partial<{ A: number; B: number; C: number; D: number }>;
  targets?: Partial<{ A: number; B: number; C: number; D: number }>;
}

export interface DataProvider {
  // identity / auth (mocked for now)
  getCurrentUser(): CurrentUser;

  // reads
  listCycles(): CycleSummary[];
  getCycle(cycleId: string): CycleDetail | null;
  getIngest(cycleId: string): IngestModel | null;
  getReview(cycleId: string, assessmentId: string): ReviewModel | null;
  getBoundaries(cycleId: string, scope: string): BoundaryModel | null;
  getGrades(cycleId: string): GradesModel | null;

  // writes
  setItemExcluded(
    cycleId: string,
    assessmentId: string,
    itemId: string,
    excluded: boolean,
    reason?: string | null,
  ): void;
  setBoundary(cycleId: string, scope: string, input: SetBoundaryInput): void;
  resolveDuplicates(cycleId: string, strategy: DuplicateStrategy): void;
  lockCycle(cycleId: string): void;
  unlockCycle(cycleId: string): void;

  // reactivity (for useSyncExternalStore)
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}
