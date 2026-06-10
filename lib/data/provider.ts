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
  AnalyticsCompare,
  AnalyticsTrends,
  AuditFilter,
  AuditModel,
  BoundaryMode,
  ConfigModel,
  CreateCycleInput,
  CurrentUser,
  CycleDetail,
  CycleSummary,
  DocSettings,
  DocumentsModel,
  DuplicateStrategy,
  GradesModel,
  GradingDefaultsModel,
  IngestModel,
  MembersModel,
  NewCycleModel,
  RetentionConfig,
  ReviewModel,
  RolesModel,
  BoundaryModel,
  BrandingConfig,
} from "./types";
import type { GradingConfig } from "./grading";

export interface SetBoundaryInput {
  mode?: BoundaryMode;
  /** Replace the whole cut-point array. */
  cuts?: number[];
  /** Replace the whole target-% array. */
  targets?: number[];
  /** Update a single cut-point (drag / type). */
  cutIndex?: number;
  cutValue?: number;
  /** Update a single target %. */
  targetIndex?: number;
  targetValue?: number;
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
  getGradingDefaults(): GradingDefaultsModel;
  /** Student Summary for document generation (only populated once locked). */
  getDocuments(cycleId: string): DocumentsModel | null;

  // settings: users & roles
  getMembers(): MembersModel;
  getRoles(): RolesModel;

  // settings: configuration
  getConfig(): ConfigModel;

  // audit & analytics
  getAuditLog(cycleId: string | null, filter: AuditFilter, search: string): AuditModel;
  getAnalyticsTrends(): AnalyticsTrends;
  getAnalyticsCompare(): AnalyticsCompare;

  // new cycle
  getNewCycle(): NewCycleModel;

  // writes
  setItemExcluded(
    cycleId: string,
    assessmentId: string,
    itemId: string,
    excluded: boolean,
    reason?: string | null,
  ): void;
  setBoundary(cycleId: string, scope: string, input: SetBoundaryInput): void;
  setGradingDefaults(patch: Partial<GradingConfig>): void;
  setDocumentSettings(cycleId: string, patch: Partial<DocSettings>): void;
  resolveDuplicates(cycleId: string, strategy: DuplicateStrategy): void;
  lockCycle(cycleId: string): void;
  unlockCycle(cycleId: string): void;

  // members & roles mutations
  inviteMember(email: string, roleId: string): void;
  setMemberRole(memberId: string, roleId: string): void;
  removeMember(memberId: string): void;
  resendInvite(memberId: string): void;
  createRole(name: string): void;
  renameRole(roleId: string, name: string): void;
  setCapability(roleId: string, capabilityId: string, granted: boolean): void;

  // configuration mutations
  setRetention(patch: Partial<RetentionConfig>): void;
  setBranding(patch: Partial<BrandingConfig>): void;

  // audit-writing actions (UI-driven export / document generation)
  recordExport(cycleId: string, detail: string): void;
  recordDocuments(cycleId: string, detail: string): void;

  // new-cycle action (mock — no DB)
  createCycle(input: CreateCycleInput): string;

  // reactivity (for useSyncExternalStore)
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}
