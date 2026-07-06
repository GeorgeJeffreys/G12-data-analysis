"use client";

/**
 * SupabaseDataProvider — the live DataProvider implementation.
 *
 * Strategy (hydrate-replay-delegate):
 *  - READS delegate to an inner InMemoryDataProvider that was constructed from a
 *    Seed hydrated out of Supabase (supabase-hydrate.ts) and then had the stored
 *    decisions replayed through its own mutators. The inner provider therefore
 *    holds a faithful, fully-computed mirror of the database, and every existing
 *    read-model (review, boundaries, grades, diagnostics, …) works unchanged.
 *  - WRITES apply optimistically to the inner provider (instant UI) AND go to the
 *    SECURITY DEFINER RPCs over the RLS-scoped client — the only sanctioned path
 *    for status/decision/computed columns. The database enforces authorization
 *    (RLS + each function's role check), so a write the user isn't allowed to make
 *    is rejected server-side even though the optimistic local copy updated.
 *
 * Hydration is async; the synchronous interface is satisfied by serving an empty
 * cycle until hydration finishes, then bumping the version so screens re-render.
 * Reactivity is driven by this provider's own version/subscribe (the inner gets
 * swapped on hydration, so we can't delegate subscription to it).
 *
 * `getAccessStatus()` (not part of DataProvider) lets the shell render the
 * sign-in / access-denied states for the invite-only model.
 */
import type { Database } from "@/lib/types/database";
import { storageRoleForTier, type RoleTier } from "@/lib/auth/roles";
import { buildMembersModel, parseMemberKey, type MemberDirRow } from "./member-directory";
import type { SupabaseBrowserClient } from "@/lib/supabase/client";
import type { IncidentCodeInput, IncidentColumnMapping } from "@/lib/incidents/types";
import { InMemoryDataProvider } from "./in-memory-provider";
import { hydrate, fetchSessionUser, type DecisionState } from "./supabase-hydrate";
import { catalogNamesFor } from "./subject-catalog";
import type { Seed } from "./seed-types";
import type { GradingConfig } from "./grading";
import type { ElementLabelsConfig } from "./element-labels";
import type { ScoringConfig, QualityThresholds } from "@/lib/engine";
import type {
  DataProvider,
  SetBoundaryInput,
  TechnicalErrorRow,
  IncidentInput,
  IncidentDecisionInput,
  EssayUploadRow,
  CgjUploadRow,
  SchemaHealth,
  SittingRoster,
} from "./provider";
import type { CleanResponse, ValidationReport } from "@/lib/ingest/types";
import type { CanonicalModel } from "@/lib/ingest/qm";
import type {
  AnalyticsCompare,
  AnalyticsTrends,
  CompareCyclesModel,
  AuditFilter,
  AuditModel,
  OverrideViewModel,
  ConfigModel,
  CreateCycleInput,
  CurrentUser,
  CycleDetail,
  CycleSummary,
  TestCentreSummary,
  YearSummary,
  YearDetail,
  DocSettings,
  DocumentsModel,
  DuplicateStrategy,
  GradesModel,
  CgjModel,
  OverallGradesModel,
  GradingDefaultsModel,
  IngestModel,
  CombinedSplitModel,
  RawDataModel,
  DataCleaningModel,
  CleanedDataModel,
  CleaningImpactModel,
  CleaningSummaryModel,
  CleanedMasterDataset,
  NaiveScoresModel,
  MembersModel,
  NewCycleModel,
  PerformanceReportModel,
  RetentionConfig,
  ReviewModel,
  ItemDetailModel,
  RolesModel,
  BoundaryModel,
  BrandingConfig,
  BorderlineConfig,
  StudentReviewModel,
  DistinctionSafeguardModel,
  EssayMarksModel,
  AdjustmentsModel,
  IncidentConfigModel,
  IncidentReviewModel,
  CompositionModel,
  DiagnosticsModel,
  ReliabilityModel,
  IncidentDecision,
} from "./types";
import type { ResolvedIncidentRow, RosterParticipant } from "@/lib/incidents/import";

type DB = SupabaseBrowserClient;

export type AccessStatus = "loading" | "ok" | "no-session" | "not-member" | "no-cycle" | "error";

const LOADING_USER: CurrentUser = { id: "loading", name: "…", initials: "…", role: "viewer" };


const EMPTY_SEED: Seed = {
  generatedAt: new Date(0).toISOString(),
  engineVersion: "loading",
  liveCycle: {
    id: "", name: "Loading…", region: "eu-west", startedAt: "", lastActivity: "",
    stageIndex: 0, fileName: "", fileSizeMB: 0, uploadedAgo: "",
    // A well-formed (empty) validation report — `stats` is required by
    // ValidationReport and must never be absent. Omitting it is what used to
    // crash the Import screen's `report.stats.mcqRows` read on an empty cycle.
    validation: {
      passed: true,
      checks: [],
      stats: { rawRows: 0, mcqRows: 0, droppedSurveyRows: 0, droppedNonMcqRows: 0, assessments: 0, participants: 0, items: 0 },
    },
    preview: { headers: [], rows: [] }, duplicates: 0,
    participants: [], assessments: [], diagnostics: [],
  },
  priorCycles: [],
};

export class SupabaseDataProvider implements DataProvider {
  private inner: InMemoryDataProvider;
  private version = 0;
  private listeners = new Set<() => void>();
  private user: CurrentUser = LOADING_USER;
  private cycleId = "";
  private status: AccessStatus = "loading";
  private qmToUuid = new Map<string, string>();
  private uuidToQm = new Map<string, string>(); // participant row UUID → stable qm_participant_id
  private subjectToAssessment = new Map<string, string>();
  private incIdMap = new Map<string, string>(); // inner inc-N → DB incident uuid
  /** The REAL member roster (auth.users ⋈ memberships), via the list_members RPC.
   *  Replaces the mock member list entirely in the live app. */
  private realMembers: MemberDirRow[] = [];

  constructor(private supabase: DB) {
    this.inner = new InMemoryDataProvider(EMPTY_SEED, LOADING_USER);
    void this.init();
    // The provider instance outlives client-side navigation, so a sign-in that
    // happens after construction (on /signin) would otherwise leave `status`
    // stuck at its initial value and the access gate would bounce back to
    // /signin. React to auth changes so the gate re-evaluates without a reload.
    this.supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        this.user = LOADING_USER;
        this.cycleId = "";
        this.status = "no-session";
        this.bump();
      } else if (event === "SIGNED_IN" && this.status === "no-session") {
        // We were locked out and now hold a session — re-hydrate from scratch.
        this.status = "loading";
        this.bump();
        void this.init();
      }
    });
  }

  // ── reactivity ─────────────────────────────────────────────────────────
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  getVersion(): number {
    return this.version;
  }
  private bump(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }
  /** For the shell: render sign-in / access-denied for the invite-only model. */
  getAccessStatus(): AccessStatus {
    return this.status;
  }

  // ── hydration ──────────────────────────────────────────────────────────
  private async init(): Promise<void> {
    try {
      const session = await fetchSessionUser(this.supabase);
      if (session.status !== "ok" || !session.user) {
        this.status = session.status === "no-session" ? "no-session" : "not-member";
        this.bump();
        return;
      }
      this.user = session.user;
      await this.rehydrate();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Supabase hydration failed:", e);
      this.status = "error";
      this.bump();
    }
  }

  /** (Re)build the inner provider from the database and replay decisions. */
  private async rehydrate(): Promise<void> {
    const h = await hydrate(this.supabase);
    if (!h) {
      this.status = "no-cycle";
      this.inner = new InMemoryDataProvider(EMPTY_SEED, this.user);
      await this.fetchMembers();
      this.bump();
      return;
    }
    const next = new InMemoryDataProvider(h.seed, this.user);
    this.replay(next, h.seed.liveCycle.id, h.decisions);
    this.inner = next;
    await this.fetchMembers();
    this.cycleId = h.seed.liveCycle.id;
    this.qmToUuid = h.lookups.qmToUuid;
    this.uuidToQm = new Map([...h.lookups.qmToUuid].map(([qm, uuid]) => [uuid, qm]));
    this.subjectToAssessment = h.lookups.subjectCodeToAssessmentId;
    this.incIdMap = new Map(h.lookups.incidentDbIds.map((id, i) => [`inc-${i + 1}`, id]));
    this.status = "ok";
    this.bump();
  }

  private replay(p: InMemoryDataProvider, cid: string, d: DecisionState): void {
    for (const e of d.exclusions) p.setItemExcluded(cid, e.assessmentId, e.itemId, true, e.reason);
    for (const c of d.cleanRemovals) {
      if (c.rows.length) p.setCleanRemoval(cid, c.assessmentId, { rows: c.rows }, true);
      if (c.cols.length) p.setCleanRemoval(cid, c.assessmentId, { cols: c.cols }, true);
    }
    for (const s of d.schemes) {
      const cuts = s.bands.slice(0, -1).map((b) => b.min);
      p.setBoundary(cid, s.scope, { mode: s.method === "fixed_pct" ? "pct" : "cuts", cuts });
    }
    if (d.essays.length) p.uploadEssayMarks(cid, "essay_marks.xlsx", d.essays);
    if (d.incidents.length) {
      p.uploadIncidentLog(cid, "incident_log.xlsx", d.incidents);
      d.incidentDecisions.forEach((dec, i) => {
        if (dec) p.decideIncident(cid, `inc-${i + 1}`, dec);
      });
    }
    if (d.distinctionConfirmed) p.confirmDistinctionCaps(cid);
    for (const o of d.distinctionOverrides) p.overrideDistinctionCap(cid, o.studentId, o.reason);
    if (d.docSettings) p.setDocumentSettings(cid, d.docSettings as Partial<DocSettings>);
    this.applyWorkspace(p, d.workspace);
    if (d.elementLabels) p.setElementLabels(d.elementLabels);
    if (d.locked) p.lockCycle(cid); // last — freezes further edits
  }

  private applyWorkspace(p: InMemoryDataProvider, w: Record<string, unknown>): void {
    if (w.grading_defaults) p.setGradingDefaults(w.grading_defaults as Partial<GradingConfig>);
    if (w.quality_thresholds) p.setQualityThresholds(w.quality_thresholds as Partial<QualityThresholds>);
    if (w.retention) p.setRetention(w.retention as Partial<RetentionConfig>);
    if (w.branding) p.setBranding(w.branding as Partial<BrandingConfig>);
    if (w.safeguard) p.setSafeguardConfig(w.safeguard as { distinctionThreshold?: number; topDifficultyDemand?: string });
    if (w.borderline) p.setBorderlineConfig(w.borderline as Partial<BorderlineConfig>);
  }

  // ── RPC helpers ────────────────────────────────────────────────────────
  /** Narrowly-typed view of `.rpc` (the dynamic function name defeats the typed
   *  client's per-function arg inference; the names/args are checked at the call
   *  sites by the `Functions` map keys). */
  private get rpcFn(): (name: string, args: unknown) => Promise<{ error: { message: string } | null }> {
    return this.supabase.rpc.bind(this.supabase) as unknown as (
      name: string,
      args: unknown,
    ) => Promise<{ error: { message: string } | null }>;
  }
  /** Like `rpcFn` but keeps the returned scalar/row (for RPCs that return an id). */
  private rpcData<T>(name: string, args: unknown): Promise<{ data: T | null; error: { message: string } | null }> {
    return (this.supabase.rpc.bind(this.supabase) as unknown as (
      n: string,
      a: unknown,
    ) => Promise<{ data: T | null; error: { message: string } | null }>)(name, args);
  }
  private rpc<N extends keyof Database["public"]["Functions"]>(
    name: N,
    args: Database["public"]["Functions"][N]["Args"],
  ): void {
    // Fire-and-forget: the interface is synchronous. Errors (incl. server-side
    // authorization failures) are logged; the optimistic local state remains.
    void (async () => {
      const { error } = await this.rpcFn(name as string, args);
      if (error) {
        // eslint-disable-next-line no-console
        console.error(`RPC ${String(name)} failed:`, error.message);
      }
    })();
  }
  private async rpcThenRehydrate<N extends keyof Database["public"]["Functions"]>(
    name: N,
    args: Database["public"]["Functions"][N]["Args"],
  ): Promise<void> {
    const { error } = await this.rpcFn(name as string, args);
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`RPC ${String(name)} failed:`, error.message);
      return;
    }
    await this.rehydrate();
  }

  // ── identity ───────────────────────────────────────────────────────────
  getCurrentUser(): CurrentUser {
    return this.user;
  }

  // ── reads (delegate to the hydrated inner provider) ─────────────────────
  listYears(): YearSummary[] { return this.inner.listYears(); }
  getYear(yearId: string): YearDetail | null { return this.inner.getYear(yearId); }
  listCycles(): CycleSummary[] { return this.inner.listCycles(); }
  getCycle(cycleId: string): CycleDetail | null { return this.inner.getCycle(cycleId); }
  getIngest(cycleId: string): IngestModel | null { return this.inner.getIngest(cycleId); }
  getSittingRoster(cycleId: string): SittingRoster | null { return this.inner.getSittingRoster(cycleId); }
  getCombinedSplit(cycleId: string): CombinedSplitModel | null { return this.inner.getCombinedSplit(cycleId); }
  getRawData(cycleId: string, assessmentId: string): RawDataModel | null { return this.inner.getRawData(cycleId, assessmentId); }
  getDataCleaning(cycleId: string, assessmentId: string): DataCleaningModel | null { return this.inner.getDataCleaning(cycleId, assessmentId); }
  getCleanedData(cycleId: string, assessmentId: string): CleanedDataModel | null { return this.inner.getCleanedData(cycleId, assessmentId); }
  getCleaningImpact(cycleId: string): CleaningImpactModel | null { return this.inner.getCleaningImpact(cycleId); }
  getCleaningSummary(cycleId: string): CleaningSummaryModel | null { return this.inner.getCleaningSummary(cycleId); }
  getCleanedMasterDataset(cycleId: string): CleanedMasterDataset | null { return this.inner.getCleanedMasterDataset(cycleId); }
  getNaiveScores(cycleId: string, assessmentId: string): NaiveScoresModel | null { return this.inner.getNaiveScores(cycleId, assessmentId); }
  getReview(cycleId: string, assessmentId: string): ReviewModel | null { return this.inner.getReview(cycleId, assessmentId); }
  getItemDetail(cycleId: string, assessmentId: string, itemId: string): ItemDetailModel | null { return this.inner.getItemDetail(cycleId, assessmentId, itemId); }
  getBoundaries(cycleId: string, scope: string): BoundaryModel | null { return this.inner.getBoundaries(cycleId, scope); }
  getGrades(cycleId: string): GradesModel | null { return this.inner.getGrades(cycleId); }
  getOverallGrades(yearId: string): OverallGradesModel | null { return this.inner.getOverallGrades(yearId); }
  getOverallDocuments(yearId: string): DocumentsModel | null { return this.inner.getOverallDocuments(yearId); }
  getPerformanceReport(cycleId: string): PerformanceReportModel | null { return this.inner.getPerformanceReport(cycleId); }
  getGradingDefaults(): GradingDefaultsModel { return this.inner.getGradingDefaults(); }
  getStudentReview(cycleId: string): StudentReviewModel | null { return this.inner.getStudentReview(cycleId); }
  getDistinctionSafeguard(cycleId: string, scope?: string): DistinctionSafeguardModel | null { return this.inner.getDistinctionSafeguard(cycleId, scope); }
  getDocuments(cycleId: string): DocumentsModel | null { return this.inner.getDocuments(cycleId); }
  getScoreAnalysisData(cycleId: string, preExclusion?: boolean) { return this.inner.getScoreAnalysisData(cycleId, preExclusion); }
  getItemAnalysisData(cycleId: string) { return this.inner.getItemAnalysisData(cycleId); }
  /** The REAL Users & access roster — auth.users ⋈ memberships, mapped through the
   *  one canonical role vocabulary (lib/auth/roles.ts). The signed-in account is
   *  flagged `isCurrent` by the session id, so displayed identity = authenticated
   *  identity. NOT the mock member list. */
  getMembers(): MembersModel {
    return buildMembersModel(this.realMembers, this.user.id);
  }

  /** Load the real roster via the SECURITY DEFINER list_members RPC. */
  private async fetchMembers(): Promise<void> {
    const { data, error } = await this.rpcData<MemberDirRow[]>("list_members", {});
    if (error) {
      // eslint-disable-next-line no-console
      console.error("list_members failed:", error.message);
      return;
    }
    this.realMembers = data ?? [];
  }
  getRoles(): RolesModel { return this.inner.getRoles(); }
  listTestCentres(): TestCentreSummary[] { return this.inner.listTestCentres(); }
  getConfig(): ConfigModel { return this.inner.getConfig(); }
  getScoringConfig(): ScoringConfig { return this.inner.getScoringConfig(); }
  getElementLabels(): ElementLabelsConfig { return this.inner.getElementLabels(); }
  getIncidentConfig(): IncidentConfigModel { return this.inner.getIncidentConfig(); }
  getAuditLog(cycleId: string | null, filter: AuditFilter, search: string): AuditModel { return this.inner.getAuditLog(cycleId, filter, search); }
  getOverrideView(cycleId: string): OverrideViewModel { return this.inner.getOverrideView(cycleId); }
  getAnalyticsTrends(): AnalyticsTrends { return this.inner.getAnalyticsTrends(); }
  getAnalyticsCompare(): AnalyticsCompare { return this.inner.getAnalyticsCompare(); }
  getCompareCycles(cycleIds?: string[]): CompareCyclesModel { return this.inner.getCompareCycles(cycleIds); }
  getNewCycle(): NewCycleModel { return this.inner.getNewCycle(); }
  getEssayMarks(cycleId: string): EssayMarksModel | null { return this.inner.getEssayMarks(cycleId); }
  getAdjustments(cycleId: string): AdjustmentsModel | null { return this.inner.getAdjustments(cycleId); }
  getCgj(cycleId: string): CgjModel | null { return this.inner.getCgj(cycleId); }
  getComposition(cycleId: string): CompositionModel | null { return this.inner.getComposition(cycleId); }
  getDiagnostics(cycleId: string): DiagnosticsModel | null { return this.inner.getDiagnostics(cycleId); }
  getReliability(cycleId: string): ReliabilityModel | null { return this.inner.getReliability(cycleId); }

  // ── writes (optimistic local + SECURITY DEFINER RPC) ────────────────────
  setItemExcluded(cycleId: string, assessmentId: string, itemId: string, excluded: boolean, reason?: string | null): void {
    this.inner.setItemExcluded(cycleId, assessmentId, itemId, excluded, reason);
    this.bump();
    this.rpc("decide_item_exclusion", { p_item: itemId, p_exclude: excluded, p_reason: reason ?? null });
  }

  setCleanRemoval(
    cycleId: string,
    assessmentId: string,
    target: { rows?: string[]; cols?: string[] },
    removed: boolean,
  ): void {
    this.inner.setCleanRemoval(cycleId, assessmentId, target, removed);
    this.bump();
    const rows = target.rows ?? [];
    const cols = target.cols ?? [];
    // Rows carry the participant's STABLE natural key (qm_participant_id) so the
    // removal re-resolves after a re-import (0016); cols have none.
    if (rows.length) this.rpc("set_clean_removal", { p_cycle: cycleId, p_assessment: assessmentId, p_kind: "row", p_targets: rows, p_keys: rows.map((id) => this.uuidToQm.get(id) ?? id), p_remove: removed });
    if (cols.length) this.rpc("set_clean_removal", { p_cycle: cycleId, p_assessment: assessmentId, p_kind: "col", p_targets: cols, p_keys: [], p_remove: removed });
  }

  clearCleanRemovals(cycleId: string, assessmentId: string): void {
    this.inner.clearCleanRemovals(cycleId, assessmentId);
    this.bump();
    this.rpc("clear_clean_removals", { p_cycle: cycleId, p_assessment: assessmentId });
  }

  excludeParticipantFromCohort(
    cycleId: string,
    participantId: string,
    excluded: boolean,
    reason?: string | null,
  ): void {
    this.inner.excludeParticipantFromCohort(cycleId, participantId, excluded, reason);
    this.bump();
    // Persist durably by recording the removal on every subject the participant
    // sat. This reuses the clean_exclusions store + RPC (no new migration); on
    // reload hydrate replays the per-subject rows and `cohortRemovedParticipants`
    // re-derives the cohort-wide exclusion. getRawData reads the untouched raw
    // matrix, so presence is computed before the exclusion takes effect.
    const cyc = this.inner.getCycle(cycleId);
    // Key the durable record on P-A's stable natural key (qm_participant_id) so the
    // exclusion re-resolves after a re-import instead of dangling on the old UUID.
    const stableKey = this.uuidToQm.get(participantId) ?? participantId;
    for (const a of cyc?.assessments ?? []) {
      const raw = this.inner.getRawData(cycleId, a.id);
      if (raw?.rows.some((r) => r.id === participantId)) {
        this.rpc("set_clean_removal", {
          p_cycle: cycleId,
          p_assessment: a.id,
          p_kind: "row",
          p_targets: [participantId],
          p_keys: [stableKey],
          p_remove: excluded,
        });
      }
    }
  }

  setBoundary(cycleId: string, scope: string, input: SetBoundaryInput): void {
    this.inner.setBoundary(cycleId, scope, input);
    this.bump();
    const m = this.inner.getBoundaries(cycleId, scope);
    if (!m) return;
    const bands = m.levels.map((label, i) => ({
      label,
      min: i < m.cuts.length ? (m.cuts[i] ?? 0) : 0,
      max: i === 0 ? 100 : (m.cuts[i - 1] ?? 100),
    }));
    this.rpc("save_grade_scheme", {
      p_cycle: cycleId,
      p_scope: scope,
      p_method: m.mode === "pct" ? "fixed_pct" : "judgemental",
      p_bands: bands,
    });
  }

  setGradingDefaults(patch: Partial<GradingConfig>): void {
    this.inner.setGradingDefaults(patch);
    this.bump();
    this.rpc("set_workspace_setting", { p_key: "grading_defaults", p_value: patch });
  }
  setQualityThresholds(patch: Partial<QualityThresholds>): void {
    this.inner.setQualityThresholds(patch);
    this.bump();
    this.rpc("set_workspace_setting", { p_key: "quality_thresholds", p_value: patch });
  }
  setDocumentSettings(cycleId: string, patch: Partial<DocSettings>): void {
    this.inner.setDocumentSettings(cycleId, patch);
    this.bump();
    this.rpc("set_document_settings", { p_cycle: cycleId, p_settings: patch });
  }
  resolveDuplicates(cycleId: string, strategy: DuplicateStrategy): void {
    // Ingest-time action with no protected column; local only.
    this.inner.resolveDuplicates(cycleId, strategy);
    this.bump();
  }

  // raw-export ingest — the browser parses + cleans + validates the file (reusing
  // lib/ingest) and hands the cleaned responses here. Persist + recompute must run
  // server-side (the engine never runs in the browser; these tables aren't
  // client-writable), so we POST to the ingest route and then re-hydrate from the
  // database, which makes every downstream screen read the freshly-stored data.
  async ingestRawExport(
    cycleId: string,
    file: { name: string; sizeMB: number },
    clean: CleanResponse[],
    report: ValidationReport,
    extra?: { canonical?: CanonicalModel; files?: { items?: string; assessments?: string; topics?: string } },
  ): Promise<void> {
    const res = await fetch(`/api/cycles/${cycleId}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clean,
        report,
        fileName: file.name,
        fileSizeMB: file.sizeMB,
        canonical: extra?.canonical,
        files: extra?.files,
      }),
    });
    if (!res.ok) {
      let message = `Ingest failed (${res.status}).`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(message);
    }
    await this.rehydrate();
  }

  // Destructive sitting controls (0007). Both go through SECURITY DEFINER RPCs
  // that authorize lead/admin and audit with the resolved session user
  // (auth.uid() — the session client is present here, unlike the ingest path).
  // We await + re-hydrate so the UI reflects the new state immediately.
  //
  // 0020/0022: the RPCs RETURN the deleted-row count. We CHECK it — a null
  // (function absent / stale schema) or a 0 (nothing removed) surfaces an explicit
  // error instead of a silent "success" while rows survive across tables. (0022
  // also hardens schema_health so a stale void delete can't pass the drift probe.)
  async clearSittingData(cycleId: string): Promise<void> {
    const { data, error } = await this.rpcData<number>("clear_sitting_data", { p_cycle: cycleId });
    if (error) throw new Error(this.driftHint(error.message));
    this.assertDeleted(data, "clear");
    await this.rehydrate();
  }
  async deleteSitting(cycleId: string): Promise<void> {
    const { data, error } = await this.rpcData<number>("delete_sitting", { p_cycle: cycleId });
    if (error) throw new Error(this.driftHint(error.message));
    this.assertDeleted(data, "delete");
    await this.rehydrate();
  }

  /** Turn a raw DB error into an actionable message when it's a known class
   *  (schema drift, or an authorization denial), else pass it through unchanged. */
  private driftHint(message: string): string {
    const e = message.toLowerCase();
    // Authorization denial: delete_sitting / clear_sitting_data raise 'not authorized'
    // when app.has_role can't match the caller — most often a workspace-scope
    // (cycle_id = NULL) admin membership that a drifted, strict app.has_role no
    // longer honours. Name the fix instead of surfacing a bare permission word.
    const authDenied =
      e.includes("not authorized") ||
      e.includes("permission denied") ||
      e.includes("row-level security") ||
      e.includes("row level security");
    if (authDenied) {
      return (
        "Not authorized to modify this sitting — your admin (lead_admin) membership isn’t being " +
        "recognised. If you hold a workspace-wide (cycle_id = NULL) admin membership, run migration " +
        `0024 in the Supabase SQL editor so workspace admins are permitted again, then retry. (${message})`
      );
    }
    const drift =
      /function .* does not exist/.test(e) ||
      /could not find the function/.test(e) ||
      e.includes("schema cache") ||
      e.includes("pgrst202");
    return drift
      ? `Database schema is out of date — run migration 0024 in Supabase, then retry. (${message})`
      : message;
  }

  /** A count of 0 or a null/absent return means the operation did nothing —
   *  never let that read as success. */
  private assertDeleted(count: number | null | undefined, kind: "clear" | "delete"): void {
    if (count == null) {
      throw new Error(
        `Couldn’t ${kind} this sitting — the database returned no row count. ` +
          "The delete function may be missing or stale (run migration 0022 in Supabase).",
      );
    }
    if (count === 0) {
      throw new Error(
        kind === "delete"
          ? "Nothing was deleted — no rows found for this sitting."
          : "Nothing was cleared — this sitting has no ingested data.",
      );
    }
  }

  /** Probe the live schema for drift (columns/functions the code requires). */
  async getSchemaHealth(): Promise<SchemaHealth> {
    const { data, error } = await this.rpcData<{
      ok?: boolean;
      migration?: string;
      missing_columns?: string[];
      missing_functions?: string[];
    }>("schema_health", {});
    // An absent probe (older DB) — report drift so the operator installs 0024.
    if (error || !data) {
      return { ok: false, migration: "0024", missingColumns: [], missingFunctions: ["public.schema_health"] };
    }
    return {
      ok: data.ok ?? true,
      migration: data.migration ?? "0024",
      missingColumns: data.missing_columns ?? [],
      missingFunctions: data.missing_functions ?? [],
    };
  }

  lockCycle(cycleId: string): void {
    this.inner.lockCycle(cycleId);
    this.bump();
    this.rpc("lock_grades", { p_cycle: cycleId });
  }
  unlockCycle(cycleId: string): void {
    this.inner.unlockCycle(cycleId);
    this.bump();
    this.rpc("unlock_grades", { p_cycle: cycleId, p_reason: "Re-opened for editing" });
  }

  // members — the REAL memberships table (via SECURITY DEFINER RPCs, admin-gated
  // by the C1 authorization primitive). No mock state, no workspace blob.
  //
  // The UI passes a canonical TIER (team_member | analyst | admin) as roleId; we
  // persist a concrete member_role via storageRoleForTier. The member id encodes
  // (user_id, cycle_id) so the write targets the exact membership scope.
  inviteMember(email: string, roleId: string): void {
    const role = storageRoleForTier(roleId as RoleTier);
    void this.mutateMembers("invite_member", { p_email: email.trim(), p_role: role, p_cycle: null });
  }
  setMemberRole(memberId: string, roleId: string): void {
    const { userId, cycleId } = parseMemberKey(memberId);
    const role = storageRoleForTier(roleId as RoleTier);
    void this.mutateMembers("set_member_role", { p_user: userId, p_cycle: cycleId, p_role: role });
  }
  removeMember(memberId: string): void {
    const { userId, cycleId } = parseMemberKey(memberId);
    void this.mutateMembers("remove_member", { p_user: userId, p_cycle: cycleId });
  }
  resendInvite(_memberId: string): void {
    // Real accounts are already active; re-sending an auth invite is a Supabase
    // auth (admin API) action, not a membership mutation. No-op here.
  }

  /** Run a member-directory write RPC, surface any error, then refresh the roster. */
  private async mutateMembers(name: string, args: unknown): Promise<void> {
    const { error } = await this.rpcData<unknown>(name, args);
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`${name} failed:`, error.message);
      return;
    }
    await this.fetchMembers();
    this.bump();
  }
  createRole(name: string): void {
    this.inner.createRole(name);
    this.bump();
    this.rpc("set_workspace_setting", { p_key: "roles", p_value: this.inner.getRoles() });
  }
  renameRole(roleId: string, name: string): void {
    this.inner.renameRole(roleId, name);
    this.bump();
    this.rpc("set_workspace_setting", { p_key: "roles", p_value: this.inner.getRoles() });
  }
  deleteRole(roleId: string): void {
    this.inner.deleteRole(roleId);
    this.bump();
    this.rpc("set_workspace_setting", { p_key: "roles", p_value: this.inner.getRoles() });
  }
  setCapability(roleId: string, capabilityId: string, granted: boolean): void {
    this.inner.setCapability(roleId, capabilityId, granted);
    this.bump();
    this.rpc("set_workspace_setting", { p_key: "roles", p_value: this.inner.getRoles() });
  }

  // technical errors / student-review — legacy surface, no DB backing; local only.
  uploadTechnicalErrors(cycleId: string, fileName: string, rows: TechnicalErrorRow[]): void {
    this.inner.uploadTechnicalErrors(cycleId, fileName, rows);
    this.bump();
  }
  loadSampleTechnicalErrors(cycleId: string): void {
    this.inner.loadSampleTechnicalErrors(cycleId);
    this.bump();
  }
  clearTechnicalErrors(cycleId: string): void {
    this.inner.clearTechnicalErrors(cycleId);
    this.bump();
  }
  setIncidentDecision(cycleId: string, incidentId: string, decision: IncidentDecision, reason?: string | null): void {
    this.inner.setIncidentDecision(cycleId, incidentId, decision, reason);
    this.bump();
  }

  // essay marks (English/Arabic) — translate file qm-ids → uuids for both the
  // optimistic local apply and the RPC.
  uploadEssayMarks(cycleId: string, fileName: string, rows: EssayUploadRow[]): void {
    const translated = rows.map((r) => ({ ...r, participantId: this.qmToUuid.get(r.participantId) ?? r.participantId }));
    this.inner.uploadEssayMarks(cycleId, fileName, translated);
    this.bump();
    void this.rpcThenRehydrate("upsert_essay_marks", {
      p_cycle: cycleId,
      p_file_ref: fileName,
      p_marks: this.aggregateEssays(translated),
    });
  }
  loadSampleEssayMarks(cycleId: string): void {
    // Sample/demo data is not persisted to the live database.
    this.inner.loadSampleEssayMarks(cycleId);
    this.bump();
  }
  clearEssayMarks(cycleId: string): void {
    this.inner.clearEssayMarks(cycleId);
    this.bump();
    this.rpc("clear_essay_marks", { p_cycle: cycleId });
  }

  // incident log → alterations triage
  uploadIncidentLog(cycleId: string, fileName: string, rows: IncidentInput[]): void {
    this.inner.uploadIncidentLog(cycleId, fileName, rows);
    this.bump();
    const p_rows = rows.map((r) => ({
      source: r.source,
      student_name: r.studentName,
      exam: r.exam ?? null,
      issue_type: r.issueType ?? null,
      action_taken: r.actionTaken ?? null,
      questions_affected: r.questionsAffected ?? null,
      staff: r.staff ?? null,
      email: r.email ?? null,
      school: r.school ?? null,
      description: r.description ?? null,
    }));
    void this.rpcThenRehydrate("insert_incidents", { p_cycle: cycleId, p_rows });
  }
  loadSampleIncidentLog(cycleId: string): void {
    this.inner.loadSampleIncidentLog(cycleId);
    this.bump();
  }
  clearIncidentLog(cycleId: string): void {
    this.inner.clearIncidentLog(cycleId);
    this.bump();
    void this.rpcThenRehydrate("clear_incidents", { p_cycle: cycleId });
  }

  // CGJ (Centre Grade Judgement) — comparison-only, no scoring impact. Held in
  // the inner provider for now (local to the session); a persistence RPC can be
  // added later without touching the UI.
  uploadCgjFile(cycleId: string, fileName: string, rows: CgjUploadRow[]): void {
    this.inner.uploadCgjFile(cycleId, fileName, rows);
    this.bump();
  }
  loadSampleCgj(cycleId: string): void {
    this.inner.loadSampleCgj(cycleId);
    this.bump();
  }
  clearCgj(cycleId: string): void {
    this.inner.clearCgj(cycleId);
    this.bump();
  }
  decideIncident(cycleId: string, incidentId: string, decision: IncidentDecisionInput): void {
    this.inner.decideIncident(cycleId, incidentId, decision);
    this.bump();
    const dbId = this.incIdMap.get(incidentId);
    if (!dbId) return; // freshly-uploaded incident not yet mapped (rehydrate fixes this)
    this.rpc("decide_incident", {
      p_cycle: cycleId,
      p_incident: dbId,
      p_apply_to: decision.applyTo,
      p_participant: decision.studentId ?? null,
      p_assessment: decision.subjectId ?? null,
      p_marks: decision.marks ?? 0,
      p_reason: decision.reason ?? null,
    });
  }

  // distinction safeguard (overall scope)
  confirmDistinctionCaps(cycleId: string): void {
    this.inner.confirmDistinctionCaps(cycleId);
    this.bump();
    this.rpc("confirm_distinction_caps", { p_cycle: cycleId });
  }
  overrideDistinctionCap(cycleId: string, studentId: string, reason: string): void {
    this.inner.overrideDistinctionCap(cycleId, studentId, reason);
    this.bump();
    this.rpc("override_distinction_cap", { p_cycle: cycleId, p_participant: studentId, p_scope: "overall", p_reason: reason });
  }
  undoDistinctionOverride(cycleId: string, studentId: string): void {
    this.inner.undoDistinctionOverride(cycleId, studentId);
    this.bump();
    this.rpc("undo_distinction_override", { p_cycle: cycleId, p_participant: studentId, p_scope: "overall" });
  }

  // manual mark adjustment (rides the existing alterations table server-side; the
  // RPC resolves the actor via auth.uid() and writes the audit entry)
  adjustStudentMark(cycleId: string, participantId: string, assessmentId: string, newMark: number, reason: string): void {
    this.inner.adjustStudentMark(cycleId, participantId, assessmentId, newMark, reason);
    this.bump();
    this.rpc("adjust_participant_mark", {
      p_cycle: cycleId,
      p_participant: participantId,
      p_assessment: assessmentId,
      p_new_mark: newMark,
      p_reason: reason,
    });
  }
  removeStudentMarkAdjustment(cycleId: string, adjustmentId: string): void {
    // Capture the cell before the optimistic remove so the RPC can key the DB
    // alteration row by (cycle, participant, assessment).
    const rec = this.inner.findManualAdjustment(cycleId, adjustmentId);
    this.inner.removeStudentMarkAdjustment(cycleId, adjustmentId);
    this.bump();
    if (rec) {
      this.rpc("remove_mark_adjustment", {
        p_cycle: cycleId,
        p_participant: rec.participantId,
        p_assessment: rec.assessmentId,
      });
    }
  }

  // overrides — optimistic local apply (the inner provider holds the real session
  // user, so authorization is mirrored locally) + the admin-only SECURITY DEFINER
  // override RPC, which re-checks lead_admin server-side and writes the override
  // audit row. The override re-applies the SAME effective state the original
  // action used, so the grade recomputes through the full engine (incl. D3).
  overrideItemExclusion(cycleId: string, assessmentId: string, itemId: string, exclude: boolean, reason: string): void {
    this.inner.overrideItemExclusion(cycleId, assessmentId, itemId, exclude, reason);
    this.bump();
    void this.rpcFn("override_item_exclusion", { p_item: itemId, p_exclude: exclude, p_reason: reason }).then(({ error }) => {
      // eslint-disable-next-line no-console
      if (error) console.error("RPC override_item_exclusion failed:", error.message);
    });
  }
  overrideMarkAdjustment(cycleId: string, participantId: string, assessmentId: string, newMark: number | null, reason: string): void {
    this.inner.overrideMarkAdjustment(cycleId, participantId, assessmentId, newMark, reason);
    this.bump();
    void this.rpcFn("override_mark_adjustment", {
      p_cycle: cycleId,
      p_participant: participantId,
      p_assessment: assessmentId,
      p_new_mark: newMark,
      p_reason: reason,
    }).then(({ error }) => {
      // eslint-disable-next-line no-console
      if (error) console.error("RPC override_mark_adjustment failed:", error.message);
    });
  }

  // configuration blobs
  setRetention(patch: Partial<RetentionConfig>): void {
    this.inner.setRetention(patch);
    this.bump();
    this.rpc("set_workspace_setting", { p_key: "retention", p_value: patch });
  }
  setBranding(patch: Partial<BrandingConfig>): void {
    this.inner.setBranding(patch);
    this.bump();
    this.rpc("set_workspace_setting", { p_key: "branding", p_value: patch });
  }

  // test centres (migration 0010) — optimistic local update, then persist via the
  // SECURITY DEFINER RPC and re-hydrate so the server-generated row (real id +
  // slug) replaces the optimistic one.
  createTestCentre(input: { name: string; code: string }): void {
    this.inner.createTestCentre(input);
    this.bump();
    void this.rpcThenRehydrate("create_test_centre", { p_name: input.name, p_code: input.code });
  }
  updateTestCentre(id: string, patch: { name?: string; code?: string; active?: boolean }): void {
    this.inner.updateTestCentre(id, patch);
    this.bump();
    void this.rpcThenRehydrate("update_test_centre", {
      p_id: id,
      p_name: patch.name ?? null,
      p_code: patch.code ?? null,
      p_active: patch.active ?? null,
    });
  }
  setTestCentreActive(id: string, active: boolean): void {
    this.inner.setTestCentreActive(id, active);
    this.bump();
    void this.rpcThenRehydrate("set_test_centre_active", { p_id: id, p_active: active });
  }
  // 0013 — reassign a year onto another centre. Server-authoritative (the RPC owns
  // the admin check AND the (name, region, centre) uniqueness), so we call it
  // FIRST and rethrow its friendly message on failure rather than optimistically
  // relabelling — a conflict/permission error must surface, not be guessed locally.
  // The move is pure labelling: no scoring/grade data is read or recomputed.
  async moveExamYearToCentre(yearId: string, testCentreId: string): Promise<void> {
    const year = this.inner.listYears().find((y) => y.id === yearId);
    const realYearId = year?.examYearId;
    if (!realYearId) {
      throw new Error("This year can't be reassigned — it has no database record yet.");
    }
    const { error } = await this.rpcFn("move_exam_year_to_centre", {
      p_year_id: realYearId,
      p_test_centre_id: testCentreId,
    });
    if (error) throw new Error(error.message);
    await this.rehydrate();
  }
  setSafeguardConfig(patch: { distinctionThreshold?: number; topDifficultyDemand?: string }): void {
    this.inner.setSafeguardConfig(patch);
    this.bump();
    this.rpc("set_workspace_setting", { p_key: "safeguard", p_value: patch });
  }
  setBorderlineConfig(patch: Partial<BorderlineConfig>): void {
    // Optimistic local update (clamped in the inner provider), then persist via the
    // SECURITY DEFINER RPC, which re-validates the band server-side before writing.
    this.inner.setBorderlineConfig(patch);
    this.bump();
    this.rpc("set_workspace_setting", { p_key: "borderline", p_value: patch });
  }
  setElementLabels(config: ElementLabelsConfig): void {
    // Optimistic local update (validated in the inner provider), then persist via
    // the SECURITY DEFINER RPC, which re-validates server-side before replacing.
    this.inner.setElementLabels(config);
    this.bump();
    const payload = Object.entries(config).flatMap(([subject, entries]) =>
      entries.map((e) => ({ subject, matchKey: e.matchKey, letter: e.letter, label: e.label })),
    );
    this.rpc("set_element_labels", { p_config: payload });
  }

  // Incident Adjustments configuration (admin-only writes; the RPCs re-check the
  // workspace-admin role and re-validate add-only server-side). Optimistic local
  // update via the inner provider, then persist.
  upsertIncidentCode(input: IncidentCodeInput): void {
    this.inner.upsertIncidentCode(input);
    this.bump();
    this.rpc("upsert_incident_code", {
      p_id: input.id ?? null,
      p_code: input.code,
      p_label: input.label,
      p_match_types: input.matchTypes,
      p_formula: input.formula,
      p_per_code_cap: input.perCodeCap,
      p_active: input.active ?? true,
    });
  }
  deleteIncidentCode(id: string): void {
    this.inner.deleteIncidentCode(id);
    this.bump();
    this.rpc("delete_incident_code", { p_id: id });
  }
  setIncidentPerStudentCap(cap: number | null): void {
    this.inner.setIncidentPerStudentCap(cap);
    this.bump();
    this.rpc("set_incident_settings", { p_per_student_cap: cap });
  }
  setIncidentMapping(mapping: IncidentColumnMapping): void {
    this.inner.setIncidentMapping(mapping);
    this.bump();
    this.rpc("set_incident_mapping", { p_mapping: mapping });
  }

  // Incident Adjustments — apply engine + per-student review surface (02b). Reads
  // are served from the inner provider (hydrated from incident_rows /
  // incident_applications); writes persist through the SECURITY DEFINER RPCs
  // (0016 import_incident_rows; 0017 apply/unapply, admin-only re-checked server-side).
  getIncidentReview(cycleId: string): IncidentReviewModel | null { return this.inner.getIncidentReview(cycleId); }
  getIncidentRoster(cycleId: string): RosterParticipant[] { return this.inner.getIncidentRoster(cycleId); }
  importIncidentRows(
    cycleId: string,
    rows: readonly ResolvedIncidentRow[],
    source?: { fileName: string; sample: boolean },
  ): void {
    this.inner.importIncidentRows(cycleId, rows, source);
    this.bump();
    this.rpc("import_incident_rows", {
      p_cycle: cycleId,
      p_rows: rows.map((r) => ({
        participant_key: r.participantInternalId ?? r.rawStudentId,
        raw_student_id: r.rawStudentId,
        student_name: r.studentName,
        incident_type: r.incidentType,
        question_number: r.questionNumber,
        duration_minutes: r.durationMinutes,
        code_id: r.codeId,
        status: r.status,
        errors: r.errors,
      })),
    });
    // Persist the import source (real file vs sample) so the review surface can
    // show it after a reload. The labelled sample is demo-only — not persisted.
    if (source && !source.sample) {
      this.rpc("set_incident_import_source", { p_cycle: cycleId, p_file_name: source.fileName, p_is_sample: false });
    }
  }
  clearIncidentRows(cycleId: string): void {
    this.inner.clearIncidentRows(cycleId);
    this.bump();
    this.rpc("clear_incident_import_source", { p_cycle: cycleId });
    void this.rpcThenRehydrate("clear_incident_rows", { p_cycle: cycleId });
  }
  loadSampleIncidentRows(cycleId: string): void { this.inner.loadSampleIncidentRows(cycleId); this.bump(); }
  applyIncidentAdjustments(cycleId: string): void {
    this.inner.applyIncidentAdjustments(cycleId);
    this.bump();
    this.rpc("apply_incident_adjustments", { p_cycle: cycleId });
  }
  unapplyIncidentAdjustments(cycleId: string): void {
    this.inner.unapplyIncidentAdjustments(cycleId);
    this.bump();
    this.rpc("unapply_incident_adjustments", { p_cycle: cycleId });
  }

  // audit-writing actions
  recordExport(cycleId: string, detail: string): void {
    this.inner.recordExport(cycleId, detail);
    this.bump();
    this.rpc("record_export", { p_cycle: cycleId, p_kind: detail });
  }
  recordDocuments(cycleId: string, detail: string): void {
    this.inner.recordDocuments(cycleId, detail);
    this.bump();
    this.rpc("record_documents", { p_cycle: cycleId, p_detail: detail });
  }

  // new cycle — persists the cycle AND its chosen assessments in one audited
  // SECURITY DEFINER call, then re-hydrates from the database (which loads the
  // newly-created cycle as the live one) and returns its REAL id so the caller
  // can navigate straight to it.
  async createCycle(input: CreateCycleInput): Promise<string> {
    const p_assessments = catalogNamesFor(input.assessmentIds).map((name) => ({ name }));
    const { data, error } = await this.rpcData<string>("create_cycle_with_assessments", {
      p_name: input.name,
      p_region: "eu-west",
      p_assessments,
      // 0010 — create the sitting (and find-or-create its year) under the centre.
      p_test_centre_id: input.testCentreId || null,
    });
    if (error || !data) {
      // eslint-disable-next-line no-console
      console.error("create_cycle_with_assessments failed:", error?.message ?? "no id returned");
      throw new Error(error?.message ?? "Could not create the cycle.");
    }
    await this.rehydrate();
    return data;
  }

  // helper: average essay rows to one final mark per participant+subject
  private aggregateEssays(rows: EssayUploadRow[]): { participant_id: string; assessment_id: string; mark: number; essays_counted: number }[] {
    const acc = new Map<string, { participant: string; assessment: string; sum: number; n: number }>();
    for (const r of rows) {
      const assessment = this.subjectToAssessment.get(r.subjectCode);
      if (!assessment) continue;
      const key = `${r.participantId}|${assessment}`;
      const e = acc.get(key) ?? { participant: r.participantId, assessment, sum: 0, n: 0 };
      e.sum += r.totalScore;
      e.n += 1;
      acc.set(key, e);
    }
    return [...acc.values()].map((e) => ({
      participant_id: e.participant,
      assessment_id: e.assessment,
      mark: Math.round((e.sum / e.n) * 100) / 100, // CONFIRM: mean of per-essay TotalScores
      essays_counted: e.n,
    }));
  }
}
