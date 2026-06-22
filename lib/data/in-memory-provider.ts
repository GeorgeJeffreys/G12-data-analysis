/**
 * In-memory DataProvider. Seeds from genuine engine output (seed.generated.json)
 * and recomputes scores/distributions/grades through the real engine on every
 * change. Decisions (exclusions, boundaries, locks) live in memory and reset on
 * reload — there is no database in this build.
 */

import {
  getEngine,
  defaultScoringConfig,
  deriveAward,
  qualifiesForDistinctionByLevels,
  d3MajorityThreshold,
  passesD3Majority,
  LOW_ITEMS_THRESHOLD,
  SMALL_SAMPLE_THRESHOLD,
} from "@/lib/engine";
import type {
  Alteration,
  EssayMark,
  ItemMeta,
  ItemStat,
  ParticipantScore,
  QualityRating,
  QualityThresholds,
  ResponseRecord,
  ScoringConfig,
} from "@/lib/engine";
import {
  backsolveCuts,
  checkOutstandingHalfD3,
  POLICY_GUARDRAILS,
} from "@/lib/engine/cut-scores";
import seedJson from "./seed.generated.json";
import { rollupOverall } from "./overall";
import { buildLiveCycleData } from "./build-live-cycle";
import { doNextForStage } from "./pipeline-route";
import type { CleanResponse } from "@/lib/ingest/types";
import type { ValidationReport } from "@/lib/ingest/types";
import type { CanonicalModel } from "@/lib/ingest/qm";
import { SUBJECT_CATALOG } from "./subject-catalog";
import { isEssaySubject, reservedEssayMax } from "./essays";
import type {
  AssembleScoreAnalysisArgs,
  AssembleItemAnalysisArgs,
  ItemResponseFact,
  ItemReviewDecision,
} from "@/lib/export/types";
import type { Seed, SeedAssessment, SeedItem } from "./seed-types";
import type {
  DataProvider,
  SetBoundaryInput,
  TechnicalErrorRow,
  EssayUploadRow,
  IncidentInput,
  IncidentDecisionInput,
} from "./provider";
import {
  PIPELINE,
  type AnalyticsCompare,
  type AnalyticsTrends,
  type CompareCyclesModel,
  type CompareCycleData,
  type CompareSubjectMetrics,
  type CompareCut,
  type TrendKpi,
  type AssessmentRef,
  type AuditEntry,
  type AuditFilter,
  type AuditModel,
  type AuditType,
  type BoundaryMode,
  type BoundaryModel,
  type D3HalfWarning,
  type BrandingConfig,
  type ConfigModel,
  type CompareColumn,
  type CreateCycleInput,
  type CurrentUser,
  type CycleDetail,
  type CycleSummary,
  type YearSummary,
  type YearDetail,
  type SittingRef,
  type SittingKey,
  type DocSettings,
  type DocumentsModel,
  type DuplicateStrategy,
  type GradeBandRow,
  type GradeCell,
  type GradeMatrixRow,
  type GradesModel,
  type OverallGradesModel,
  type GradingDefaultsModel,
  type IngestModel,
  type ItemDetailModel,
  type ItemRow,
  type Member,
  type MembersModel,
  type NewCycleModel,
  type PerformanceReportModel,
  type PerfReportStudent,
  type PerfReportSubject,
  type PerfElementResult,
  type PerfReportSummarySubject,
  type QualityThresholdRow,
  type RetentionConfig,
  type ReviewModel,
  type CombinedSplitModel,
  type DetectedSubject,
  type RawDataModel,
  type RawColumnMeta,
  type RawDataRow,
  type RawElementBreak,
  type DataCleaningModel,
  type CleaningCheck,
  type NaiveScoresModel,
  type NaiveElementCol,
  type NaiveStudentRow,
  type RoleDef,
  type RolesModel,
  type StudentSummary,
  type UnofficialSubject,
  type UnofficialElement,
  type DistinctionCandidate,
  type DistinctionSafeguardModel,
  type EssayMarksModel,
  type EssayStudentMark,
  type EssaySubjectRef,
  type AdjustmentsModel,
  type AdjustmentIncident,
  type DiagnosticsModel,
  type ReliabilityModel,
  type ReliabilityRow,
  type CompositionModel,
  type StudentComposition,
  type SubjectComposition,
  type DemandScore,
  type IncidentDecision,
  type SafeguardConfig,
  type SafeguardResult,
  type StudentReviewModel,
  type TechnicalErrorsUpload,
  type TechnicalIncident,
} from "./types";
import {
  classify,
  defaultGradingConfig,
  starsFor,
  type GradingConfig,
  DEFAULT_PERFORMANCE_TARGETS,
  DEFAULT_AWARD_TARGETS,
} from "./grading";
import {
  ALL_CAPABILITY_IDS,
  ANALYTICS_CYCLE_LABELS,
  ANALYTICS_CYCLE_NAMES,
  CAPABILITY_GROUPS,
  DEFAULT_ROLES,
  defaultMatrix,
  defaultMembers,
  mockPriors,
  mockCompareSubjects,
  seedAuditEntries,
} from "./mock-admin";

/** Default seed (the bundled demo cycle). A different seed can be injected via
 *  the constructor — e.g. the SupabaseDataProvider hydrates one from the database
 *  and the seed:supabase script reuses this provider over freshly-ingested data. */
const DEFAULT_SEED = seedJson as unknown as Seed;
const engine = getEngine();

interface BoundaryState {
  mode: BoundaryMode;
  cuts: number[];
  targets: number[];
  /** Committed backsolve snapshot — the suggested starting point, per cut. */
  suggested?: number[];
  /** Per-cut deliberate guard-rail waiver (value knowingly outside policy bounds). */
  waived?: boolean[];
}

/** One exam's D3-majority working for a student (Layer 1b). */
interface D3ExamStatus {
  assessmentId: string;
  name: string;
  shortName: string;
  /** D3 items the student answered correctly (score > 0). */
  correct: number;
  /** D3 items available on the exam (after cohort item exclusions). */
  available: number;
  /** Strictly-more-than-half threshold for `available`. */
  majority: number;
  pass: boolean;
}
/** A student's overall D3 cap result across every exam carrying D3 items. */
interface D3CapStatus {
  pass: boolean;
  exams: D3ExamStatus[];
  /** The first exam that failed the majority (drives the visible "why"). */
  failing: D3ExamStatus | null;
}

// --- small numeric helpers ---------------------------------------------------
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mu = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
}
function round(x: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** Deterministic 32-bit FNV-1a hash of a string (no deps) — used only for the
 *  demo February baseline, never for real scoring. */
function hash32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Render the numeric item-quality thresholds into the Configuration screen's
 * display rows, so the screen always mirrors whatever bands the engine is using
 * rather than a hand-typed copy.
 */
function qualityThresholdRows(q: QualityThresholds): QualityThresholdRow[] {
  const f = (n: number) => n.toFixed(2);
  const p = q.pValue;
  const corr = (t: QualityThresholds["itemTotal"], includeUndefined: boolean) => ({
    good: `≥ ${f(t.reviewBelow)}`,
    review: `${f(t.flagBelow)} – ${f(t.reviewBelow)}`,
    flag: includeUndefined ? `< ${f(t.flagBelow)} / undefined` : `< ${f(t.flagBelow)}`,
  });
  return [
    {
      metric: "p-value (difficulty)",
      good: `${f(p.reviewBelow)} – ${f(p.goodUpTo)}`,
      review: `${f(p.flagBelow)}–${f(p.reviewBelow)} / ${f(p.goodUpTo)}–${f(p.reviewUpTo)}`,
      flag: `< ${f(p.flagBelow)} / > ${f(p.reviewUpTo)}`,
    },
    { metric: "Item-total correlation", ...corr(q.itemTotal, true) },
    { metric: "Point-biserial", ...corr(q.pointBiserial, true) },
    { metric: "Discrimination", ...corr(q.discrimination, false) },
  ];
}

export class InMemoryDataProvider implements DataProvider {
  private version = 0;
  private listeners = new Set<() => void>();
  /** The cycle data this provider serves. Defaults to the bundled demo seed;
   *  the SupabaseDataProvider injects one hydrated from the database, and the
   *  seed:supabase script runs it over freshly-ingested data. */
  private readonly seed: Seed = DEFAULT_SEED;

  // mutable decision state
  private exclusions = new Map<string, Set<string>>(); // cycle:assessment -> itemIds
  private reasons = new Map<string, string>(); // cycle:assessment:item -> reason
  private boundaries = new Map<string, BoundaryState>(); // cycle:scope -> state
  private locked = new Set<string>();
  private grading: GradingConfig = defaultGradingConfig();
  // Item-quality Good/Review/Flag thresholds — the configurable half of the
  // engine's ScoringConfig (the level/award vocabulary is `this.grading`). The
  // Settings editor that mutates these arrives in the next prompt; for now the
  // default reproduces the engine's published ratings exactly.
  private quality: QualityThresholds = defaultScoringConfig().quality;
  private docSettingsByCycle = new Map<string, DocSettings>();

  // incident log (Adjustments) + distinction safeguard
  private technicalErrors = new Map<string, { uploaded: boolean; sample: boolean; fileName: string | null; incidents: TechnicalIncident[] }>();
  private incidentSeq = 0;
  // three-component scoring inputs (Parts 2 & 3) — empty defaults to MCQ-only.
  // essay marks (Part 2): the scoring-facing marks plus upload metadata.
  private essayMarksByCycle = new Map<
    string,
    {
      uploaded: boolean;
      sample: boolean;
      fileName: string | null;
      marks: EssayMark[];
      /** `${participantId}|${assessmentId}` → number of essays averaged. */
      essayCounts: Map<string, number>;
      /** File ParticipantIDs that matched no roster student. */
      unmatchedIds: string[];
    }
  >();
  // alterations: cycle -> human-decided +/- raw marks per student per subject.
  // Derived from decided incidents (rebuildAlterations); read by the engine.
  private alterationsByCycle = new Map<string, Alteration[]>();
  // incident log (Part 3): the triage queue behind the Adjustments step.
  private incidentLogByCycle = new Map<
    string,
    { uploaded: boolean; sample: boolean; fileName: string | null; incidents: AdjustmentIncident[] }
  >();
  private adjIncidentSeq = 0;
  private distinctionOverrides = new Map<string, Map<string, { reason: string; by: string }>>();
  private distinctionConfirmed = new Set<string>();
  // safeguard config; empty topDifficultyDemand → resolve to the highest demand present.
  private safeguard: { distinctionThreshold: number; topDifficultyDemand: string } = {
    distinctionThreshold: 3,
    topDifficultyDemand: "",
  };

  // admin / audit / config state (all MOCK — see lib/data/mock-admin.ts)
  private members: Member[] = defaultMembers();
  private roles: RoleDef[] = DEFAULT_ROLES.map((r) => ({ ...r }));
  private matrix: Record<string, Record<string, boolean>> = defaultMatrix();
  private auditEntries: AuditEntry[] = seedAuditEntries("may-2026");
  private auditSeq = 0;
  private retention: RetentionConfig = {
    archiveAfterYears: 3,
    deleteRawAfterArchive: true,
    keepAuditIndefinitely: true,
  };
  private branding: BrandingConfig = {
    accent: "#c12c68",
    logoName: "alsama_logo.svg",
    defaultCertificateTemplate: "certificate_template.pptx",
  };

  private readonly user: CurrentUser = {
    id: "m-rana",
    // Default MOCK user (a Lead) for the in-memory demo so role-gated controls
    // (Lock, admin) are exercised. The SupabaseDataProvider injects the real
    // session-derived user via the constructor.
    name: "Rana Mansour",
    initials: "RM",
    role: "lead_admin",
  };

  /**
   * @param seed Optional cycle data to serve (defaults to the bundled demo seed).
   * @param user Optional signed-in user (defaults to the MOCK Lead).
   */
  constructor(seed?: Seed, user?: CurrentUser) {
    if (seed) this.seed = seed;
    if (user) this.user = user;
  }

  // ── subscription ──────────────────────────────────────────────────────────
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

  getCurrentUser(): CurrentUser {
    return this.user;
  }

  /** Append an audit entry attributed to the current user (newest first). */
  private audit(type: AuditType, action: string, detail: string, cycleId: string | null): void {
    const me = this.members.find((m) => m.id === this.user.id);
    this.auditSeq += 1;
    this.auditEntries.unshift({
      id: `live-${this.auditSeq}`,
      ts: new Date().toISOString(),
      actorId: this.user.id,
      actorName: this.user.name,
      actorRole: me?.roleName ?? "G12 Lead",
      type,
      action,
      detail,
      cycleId,
      seeded: false,
    } satisfies AuditEntry);
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  private assessment(assessmentId: string): SeedAssessment | undefined {
    return this.seed.liveCycle.assessments.find((a) => a.id === assessmentId);
  }
  private excludedSet(cycleId: string, assessmentId: string): Set<string> {
    return this.exclusions.get(`${cycleId}:${assessmentId}`) ?? new Set();
  }
  private responsesOf(a: SeedAssessment): ResponseRecord[] {
    return a.responses.map((r) => ({
      participantId: r.p,
      itemId: r.i,
      assessmentId: a.id,
      score: r.s,
    }));
  }
  /**
   * participantId -> full subject score for one assessment, composed from the
   * three components (retained MCQ + essay + alterations). The map values are the
   * engine's ParticipantScore, so callers can read the total (`raw`), `max`,
   * `pct`, and the per-component breakdown (`mcq` / `essay` / `alterations`).
   */
  private pctByParticipant(cycleId: string, a: SeedAssessment): Map<string, ParticipantScore> {
    const excluded = [...this.excludedSet(cycleId, a.id)];
    const scores = engine.computeScores(this.responsesOf(a), excluded, {
      essayMarks: this.essayMarksFor(cycleId, a.id),
      alterations: this.alterationsFor(cycleId, a.id),
      essayAssessmentIds: this.essaySubjectIds(),
      // Half-weighted essay max, derived from the subject's essay block (never the
      // hard-coded 20). 0 for non-essay subjects, so nothing is reserved there.
      essayMax: reservedEssayMax(a),
      items: this.itemMetasFor(a),
    });
    return new Map(scores.map((s) => [s.participantId, s]));
  }

  /**
   * Assessment ids that carry an essay component (English + Arabic). Uses the one
   * shared, script-aware detector (lib/data/essays) so the Arabic-script subject
   * is recognised from its item data / name — not the old Latin-only regex.
   */
  private essaySubjectIds(): string[] {
    return this.seed.liveCycle.assessments.filter((a) => isEssaySubject(a)).map((a) => a.id);
  }
  private itemMetasFor(a: SeedAssessment): ItemMeta[] {
    return a.items.map((it) => ({
      itemId: it.id,
      assessmentId: a.id,
      majorElement: it.major,
      subElement: it.sub,
      demandLevel: it.demand,
      maxScore: it.maxScore,
    }));
  }
  private essayMarksFor(cycleId: string, assessmentId?: string): EssayMark[] {
    const all = this.essayMarksByCycle.get(cycleId)?.marks ?? [];
    return assessmentId ? all.filter((e) => e.assessmentId === assessmentId) : all;
  }
  /**
   * The Arabic/English assessment for an essay subject code (AFL/ESL). Resolves
   * the Arabic subject as the essay subject that is not English, so it matches
   * whether the subject name is Latin ("Arabic…") or Arabic script.
   */
  private essayAssessmentForCode(code: string): SeedAssessment | undefined {
    const A = this.seed.liveCycle.assessments;
    if (/esl|english/i.test(code)) return A.find((a) => /english/i.test(a.name));
    if (/afl|arabic/i.test(code)) return A.find((a) => isEssaySubject(a) && !/english/i.test(a.name));
    return undefined;
  }
  private alterationsFor(cycleId: string, assessmentId?: string): Alteration[] {
    const all = this.alterationsByCycle.get(cycleId) ?? [];
    return assessmentId ? all.filter((e) => e.assessmentId === assessmentId) : all;
  }
  /**
   * The live ScoringConfig the engine reads — the item-quality thresholds
   * (`this.quality`) plus the level/award vocabulary and default cut-points
   * (`this.grading`). This is the single config object the settings read-model
   * exposes (`getScoringConfig`) and that threads into every engine call, so
   * editing it actually changes scoring.
   */
  private scoringConfig(): ScoringConfig {
    return {
      quality: this.quality,
      performanceLevels: this.grading.performanceLevels.map((label) => ({
        label,
        stars: this.grading.starMap[label] ?? "",
      })),
      awardLevels: this.grading.awardLevels.map((label) => ({ label })),
      performanceCuts: [...this.grading.performanceCuts],
      awardCuts: [...this.grading.awardCuts],
    };
  }

  /** Levels + default cuts/targets for a scope (assessment → performance, overall → award). */
  private schemeFor(scope: string): { levels: string[]; cuts: number[]; targets: number[]; isAward: boolean } {
    if (scope === "overall") {
      return {
        levels: this.grading.awardLevels,
        cuts: this.grading.awardCuts,
        targets: DEFAULT_AWARD_TARGETS,
        isAward: true,
      };
    }
    return {
      levels: this.grading.performanceLevels,
      cuts: this.grading.performanceCuts,
      targets: DEFAULT_PERFORMANCE_TARGETS,
      isAward: false,
    };
  }
  private boundaryState(cycleId: string, scope: string): BoundaryState {
    const existing = this.boundaries.get(`${cycleId}:${scope}`);
    if (existing) return existing;
    const s = this.schemeFor(scope);
    return { mode: "cuts", cuts: [...s.cuts], targets: [...s.targets] };
  }

  private assessmentRefs(cycleId: string): AssessmentRef[] {
    return this.seed.liveCycle.assessments.map((a) => ({
      id: a.id,
      name: a.name,
      shortName: a.shortName,
      rtl: a.rtl,
      itemCount: a.items.length,
      excludedCount: this.excludedSet(cycleId, a.id).size,
      stageIndex: a.stageIndex,
    }));
  }

  // ── cycles ────────────────────────────────────────────────────────────────
  listCycles(): CycleSummary[] {
    const live = this.seed.liveCycle;
    const liveSummary: CycleSummary = {
      id: live.id,
      name: live.name,
      stageIndex: live.stageIndex,
      stageLabel: this.locked.has(live.id) ? "Locked & exported" : PIPELINE[live.stageIndex] ?? "Draft",
      stepsDone: this.locked.has(live.id) ? PIPELINE.length : live.stageIndex,
      participants: live.participants.length,
      assessments: live.assessments.length,
      lastActivity: live.lastActivity,
      locked: this.locked.has(live.id),
      live: true,
      mock: false,
    };
    const priors: CycleSummary[] = this.seed.priorCycles.map((p) => ({
      id: p.id,
      name: p.name,
      stageIndex: p.stageIndex,
      stageLabel: "Locked & exported",
      stepsDone: p.stepsDone,
      participants: p.participants,
      assessments: p.assessments,
      lastActivity: p.lastActivity,
      locked: p.locked,
      live: false,
      mock: true,
    }));
    return [liveSummary, ...priors];
  }

  getCycle(cycleId: string): CycleDetail | null {
    const live = this.seed.liveCycle;
    if (cycleId === live.id) {
      const refs = this.assessmentRefs(cycleId);
      return {
        id: live.id,
        name: live.name,
        participants: live.participants.length,
        assessmentCount: refs.length,
        startedAt: live.startedAt,
        stageIndex: this.locked.has(live.id) ? PIPELINE.length - 1 : live.stageIndex,
        locked: this.locked.has(live.id),
        mock: false,
        // Land on the cycle's FIRST INCOMPLETE step — never skip ahead to a
        // screen (Review/Boundaries/…) whose data doesn't exist yet. A locked
        // cycle's work is done, so its next action is document generation; an
        // empty/draft cycle resolves to Upload (stageIndex 0). The previous code
        // hard-coded "Review item quality" regardless of progress, which threw a
        // brand-new cycle straight onto the Cronbach/Review screen.
        doNext: doNextForStage(live.id, this.locked.has(live.id) ? PIPELINE.length - 1 : live.stageIndex),
        assessments: refs,
      };
    }
    const prior = this.seed.priorCycles.find((p) => p.id === cycleId);
    if (prior) {
      return {
        id: prior.id,
        name: prior.name,
        participants: prior.participants,
        assessmentCount: prior.assessments,
        startedAt: prior.lastActivity,
        stageIndex: prior.stageIndex,
        locked: true,
        mock: true,
        doNext: { title: "Locked cycle", body: "This is a mock prior cycle with no detailed data in this build.", href: "/", cta: "Back to cycles" },
        assessments: [],
      };
    }
    return null;
  }

  // ── years (groups of sittings) ────────────────────────────────────────────
  // A year is a grouping over the per-sitting cycles. We derive the year label
  // and sitting (February / May) from each cycle's name — the same mapping the
  // SQL migration applies to the stored rows (see 0005). No engine/scoring code
  // is involved: this is pure presentation grouping.

  /** Stable, route-safe year id from a year label, e.g. "2026" → "year-2026". */
  private yearId(year: string): string {
    return `year-${year}`;
  }

  /** Pull a 4-digit year out of a cycle name (fallback: "Unknown"). */
  private yearOf(name: string): string {
    const m = name.match(/(19|20)\d{2}/);
    return m ? m[0] : "Unknown";
  }

  /** Map a cycle name to its sitting: Jan–Apr → February, otherwise May. */
  private sittingOf(name: string): SittingKey {
    return /\b(jan|feb|mar|apr)/i.test(name) ? "february" : "may";
  }

  private sittingRefFrom(c: CycleSummary, sitting: SittingKey): SittingRef {
    return {
      sitting,
      label: sitting === "february" ? "February" : "May",
      cycleId: c.id,
      cycleName: c.name,
      started: true,
      locked: c.locked,
      stageLabel: c.stageLabel,
      stepsDone: c.stepsDone,
      participants: c.participants,
      assessments: c.assessments,
      lastActivity: c.lastActivity,
      live: c.live,
      mock: c.mock,
    };
  }

  private emptySitting(sitting: SittingKey): SittingRef {
    return {
      sitting,
      label: sitting === "february" ? "February" : "May",
      cycleId: null,
      cycleName: null,
      started: false,
      locked: false,
      stageLabel: "Not started",
      stepsDone: 0,
      participants: 0,
      assessments: 0,
      lastActivity: "—",
      live: false,
      mock: false,
    };
  }

  /** Group every cycle into its year + sitting slot (newest year first). */
  private buildYears(): { id: string; name: string; february: SittingRef; may: SittingRef }[] {
    const order: string[] = [];
    const byYear = new Map<string, { february?: SittingRef; may?: SittingRef }>();
    for (const c of this.listCycles()) {
      const year = this.yearOf(c.name);
      const sitting = this.sittingOf(c.name);
      if (!byYear.has(year)) {
        byYear.set(year, {});
        order.push(year);
      }
      const slot = byYear.get(year)!;
      const ref = this.sittingRefFrom(c, sitting);
      // First write wins per slot; listCycles is newest-first and the live run is
      // first, so the most relevant cycle keeps the slot if names ever collide.
      if (!slot[sitting]) slot[sitting] = ref;
    }
    return order.map((year) => {
      const slot = byYear.get(year)!;
      return {
        id: this.yearId(year),
        name: year,
        february: slot.february ?? this.emptySitting("february"),
        may: slot.may ?? this.emptySitting("may"),
      };
    });
  }

  listYears(): YearSummary[] {
    return this.buildYears().map((y) => {
      const live = y.february.live || y.may.live;
      const mock =
        (!y.february.started || y.february.mock) &&
        (!y.may.started || y.may.mock) &&
        !live;
      const lastActivity =
        (y.may.live && y.may.lastActivity) ||
        (y.february.live && y.february.lastActivity) ||
        (y.may.started && y.may.lastActivity) ||
        (y.february.started && y.february.lastActivity) ||
        "—";
      return {
        id: y.id,
        name: y.name,
        february: y.february,
        may: y.may,
        participants: Math.max(y.february.participants, y.may.participants),
        lastActivity,
        live,
        mock,
      };
    });
  }

  getYear(yearId: string): YearDetail | null {
    const y = this.buildYears().find((yr) => yr.id === yearId);
    if (!y) return null;
    // Overall is the best-of-two-by-award-level rollup — implemented next prompt.
    const ready = y.february.started && y.february.locked && y.may.started && y.may.locked;
    return {
      id: y.id,
      name: y.name,
      february: y.february,
      may: y.may,
      overall: {
        ready,
        note: ready
          ? "Both sittings are locked — the Overall best-of-two rollup runs here."
          : "Overall becomes available once both the February and May sittings are locked.",
      },
    };
  }

  // ── ingest & validate ─────────────────────────────────────────────────────
  getIngest(cycleId: string): IngestModel | null {
    const live = this.seed.liveCycle;
    if (cycleId !== live.id) return null;
    // A raw export has actually been ingested only once some subject has
    // responses. A freshly-created (empty) cycle has none — the Import screen
    // shows its upload prompt instead of an all-zero "validation report".
    const uploaded = live.assessments.some((a) => a.responses.length > 0);
    return {
      cycleId,
      uploaded,
      fileName: live.fileName,
      fileSizeMB: live.fileSizeMB,
      uploadedAgo: live.uploadedAgo,
      report: live.validation,
      preview: live.preview,
      duplicates: live.duplicates,
      canContinue: uploaded && live.validation.passed,
      technicalErrors: this.technicalErrorsUpload(cycleId),
    };
  }

  // ── front of pipeline: combined upload · raw data · cleaning · naive scores ──
  /** Distinct participant ids that have at least one response in an assessment. */
  private participantsIn(a: SeedAssessment): Set<string> {
    const set = new Set<string>();
    for (const r of a.responses) set.add(r.p);
    return set;
  }
  /** Distinct major elements in an assessment, in first-appearance order. */
  private majorsOf(a: SeedAssessment): string[] {
    const seen: string[] = [];
    for (const it of a.items) if (it.major && !seen.includes(it.major)) seen.push(it.major);
    return seen;
  }
  private demandCounts(a: SeedAssessment): { D1: number; D2: number; D3: number } {
    const d = { D1: 0, D2: 0, D3: 0 };
    for (const it of a.items) if (it.demand === "D1" || it.demand === "D2" || it.demand === "D3") d[it.demand] += 1;
    return d;
  }
  /** Build the raw response matrix (participants × items) for a subject. */
  private rawMatrix(a: SeedAssessment): { columns: RawColumnMeta[]; rows: RawDataRow[] } {
    const columns: RawColumnMeta[] = a.items.map((it, i) => ({
      id: it.id,
      qLabel: `Q${i + 1}`,
      major: it.major,
      sub: it.sub,
      demand: it.demand,
    }));
    const score = new Map<string, number>();
    for (const r of a.responses) score.set(`${r.p} ${r.i}`, r.s);
    const present = this.participantsIn(a);
    const rows: RawDataRow[] = this.seed.liveCycle.participants
      .filter((p) => present.has(p.id))
      .map((p) => ({
        id: p.id,
        studentId: p.studentId ?? p.id,
        name: p.label,
        cells: a.items.map((it) => {
          const v = score.get(`${p.id} ${it.id}`);
          return v === undefined ? null : v;
        }),
      }));
    return { columns, rows };
  }

  getCombinedSplit(cycleId: string): CombinedSplitModel | null {
    const live = this.seed.liveCycle;
    if (cycleId !== live.id) return null;
    // The split panel summarises a raw export AFTER it's been ingested. With no
    // upload yet (empty cycle) there is nothing to split — return null so the
    // Import screen shows its upload prompt, not "Detected 0-item subjects".
    if (!live.assessments.some((a) => a.responses.length > 0)) return null;
    const counts = live.assessments.map((a) => this.participantsIn(a).size);
    const maxParts = Math.max(...counts, 0);
    const essayIds = new Set(this.essaySubjectIds());
    const subjects: DetectedSubject[] = live.assessments.map((a) => {
      const participants = this.participantsIn(a).size;
      const warn = participants < maxParts;
      return {
        id: a.id,
        name: a.name,
        shortName: a.shortName,
        items: a.items.length,
        participants,
        elements: this.majorsOf(a),
        rtl: a.rtl,
        hasEssay: essayIds.has(a.id),
        status: warn ? "warn" : "ok",
        note: warn ? `${maxParts - participants} fewer participant${maxParts - participants > 1 ? "s" : ""} than the largest subject` : null,
      };
    });
    return {
      cycleId,
      fileName: live.fileName,
      fileSizeMB: live.fileSizeMB,
      uploadedAgo: live.uploadedAgo,
      totalItems: live.assessments.reduce((n, a) => n + a.items.length, 0),
      totalParticipants: live.participants.length,
      subjects,
    };
  }

  getRawData(cycleId: string, assessmentId: string): RawDataModel | null {
    const a = this.assessment(assessmentId);
    if (cycleId !== this.seed.liveCycle.id || !a) return null;
    const refs = this.assessmentRefs(cycleId);
    const byElement: RawElementBreak[] = this.majorsOf(a).map((major) => {
      const items = a.items.filter((it) => it.major === major);
      const subs: string[] = [];
      for (const it of items) if (it.sub && !subs.includes(it.sub)) subs.push(it.sub);
      return { major, subs, items: items.length };
    });
    const subElementsCount = byElement.reduce((n, e) => n + e.subs.length, 0);
    const { columns, rows } = this.rawMatrix(a);
    return {
      assessment: refs.find((r) => r.id === assessmentId)!,
      assessments: refs,
      participants: this.participantsIn(a).size,
      items: a.items.length,
      elementsCount: byElement.length,
      subElementsCount,
      demand: this.demandCounts(a),
      byElement,
      columns,
      rows,
    };
  }

  getDataCleaning(cycleId: string, assessmentId: string): DataCleaningModel | null {
    const a = this.assessment(assessmentId);
    if (cycleId !== this.seed.liveCycle.id || !a) return null;
    const refs = this.assessmentRefs(cycleId);
    // Surface the REAL validation report as cleaning checks; warnings vs must-fix
    // are distinguished by status. The sample data is clean, so blockers only
    // appear if a real upload fails validation.
    const checks: CleaningCheck[] = this.seed.liveCycle.validation.checks.map((c) => ({
      id: c.id,
      status: c.status,
      title: c.label,
      detail: c.detail || null,
      count: c.count != null ? String(c.count) : null,
      action: c.status === "fail" ? "Resolve" : c.status === "warn" ? "Review" : null,
    }));
    const counts = {
      pass: checks.filter((c) => c.status === "pass").length,
      warn: checks.filter((c) => c.status === "warn").length,
      fail: checks.filter((c) => c.status === "fail").length,
    };
    const { columns, rows } = this.rawMatrix(a);
    return {
      assessment: refs.find((r) => r.id === assessmentId)!,
      assessments: refs,
      checks,
      counts,
      rowsBefore: rows.length,
      rowsAfter: rows.length,
      canProceed: counts.fail === 0,
      columns,
      rows,
    };
  }

  getNaiveScores(cycleId: string, assessmentId: string): NaiveScoresModel | null {
    const a = this.assessment(assessmentId);
    if (cycleId !== this.seed.liveCycle.id || !a) return null;
    const refs = this.assessmentRefs(cycleId);
    const majors = this.majorsOf(a);
    const elements: NaiveElementCol[] = majors.map((major, i) => ({
      major,
      shortId: String.fromCharCode(65 + i), // A, B, C…
      items: a.items.filter((it) => it.major === major).length,
    }));
    // Pre-exclusion raw score = sum of scores over scored (maxScore≥1) items.
    // NO item exclusions applied — this is the as-submitted view, distinct from
    // the post-exclusion scoring used downstream (parity untouched).
    const scoredItems = a.items.filter((it) => (it.maxScore ?? 1) >= 1);
    const mcqMax = scoredItems.length;
    const itemsByMajor = new Map<string, Set<string>>();
    for (const major of majors) itemsByMajor.set(major, new Set(a.items.filter((it) => it.major === major).map((it) => it.id)));

    const present = this.participantsIn(a);
    const students: NaiveStudentRow[] = this.seed.liveCycle.participants
      .filter((p) => present.has(p.id))
      .map((p) => {
        const myScores = a.responses.filter((r) => r.p === p.id);
        const byId = new Map(myScores.map((r) => [r.i, r.s]));
        let raw = 0;
        for (const it of scoredItems) raw += byId.get(it.id) ?? 0;
        const perElement: Record<string, number> = {};
        for (const major of majors) {
          let got = 0;
          for (const id of itemsByMajor.get(major)!) got += byId.get(id) ?? 0;
          perElement[major] = got;
        }
        return {
          id: p.id,
          studentId: p.studentId ?? p.id,
          name: p.label,
          perElement,
          raw,
          pct: mcqMax ? Math.round((raw / mcqMax) * 1000) / 10 : 0,
        };
      })
      .sort((x, y) => y.pct - x.pct);

    const cohortAvgPct = students.length ? Math.round((students.reduce((n, s) => n + s.pct, 0) / students.length) * 10) / 10 : 0;
    return {
      assessment: refs.find((r) => r.id === assessmentId)!,
      assessments: refs,
      hasEssay: new Set(this.essaySubjectIds()).has(a.id),
      mcqItems: mcqMax,
      totalItems: a.items.length,
      cohortAvgPct,
      elements,
      students,
    };
  }

  // ── item review & scoring ───────────────────────────────────────────────--
  getReview(cycleId: string, assessmentId: string): ReviewModel | null {
    const a = this.assessment(assessmentId);
    if (cycleId !== this.seed.liveCycle.id || !a) return null;
    const excluded = this.excludedSet(cycleId, assessmentId);
    const refs = this.assessmentRefs(cycleId);
    const ref = refs.find((r) => r.id === assessmentId)!;

    // Recompute item statistics live so per-student exclusions drop a glitched
    // response from that item's cohort psychometrics. With no per-student
    // exclusions this is byte-identical to the seed (parity-verified).
    const live = this.liveItemStats(cycleId, a);
    const items: ItemRow[] = a.items.map((it) => {
      const s = live.get(it.id);
      return {
        id: it.id,
        wording: it.wording,
        major: it.major,
        sub: it.sub,
        demand: it.demand,
        pValue: s?.pValue ?? it.pValue,
        itemTotal: s ? s.itemTotal : it.itemTotal,
        pointBiserial: s ? s.pointBiserial : it.pointBiserial,
        discrimination: s?.discrimination ?? it.discrimination,
        overallReview: s?.overallReview ?? it.overallReview,
        qualityIndex: s?.qualityIndex ?? it.qualityIndex,
        excluded: excluded.has(it.id),
        reason: this.reasons.get(`${cycleId}:${assessmentId}:${it.id}`) ?? null,
      };
    });

    const pcts = [...this.pctByParticipant(cycleId, a).values()].map((v) => v.pct);
    const cohortMean = round(mean(pcts), 1);
    const cohortSd = round(stddev(pcts), 1);

    // distribution histogram (16 bins over 0..100)
    const bins = 16;
    const distribution = new Array(bins).fill(0) as number[];
    for (const p of pcts) {
      const idx = Math.min(bins - 1, Math.floor((p / 100) * bins));
      distribution[idx] = (distribution[idx] ?? 0) + 1;
    }

    const retained = items.filter((it) => !it.excluded);
    const medianDifficulty = round(median(retained.map((it) => it.pValue)), 2);

    // counts of retained items per element / demand
    const elementCounts = new Map<string, number>();
    const demandCounts = new Map<string, number>();
    for (const it of retained) {
      if (it.major) elementCounts.set(it.major, (elementCounts.get(it.major) ?? 0) + 1);
      if (it.demand) demandCounts.set(it.demand, (demandCounts.get(it.demand) ?? 0) + 1);
    }
    const byElement = [...elementCounts.entries()]
      .map(([k, v]) => ({ k, v }))
      .sort((x, y) => y.v - x.v)
      .slice(0, 6);
    const byDemand = ["D1", "D2", "D3"]
      .filter((d) => demandCounts.has(d))
      .map((d) => ({ k: d, v: demandCounts.get(d) ?? 0 }));

    return {
      assessment: ref,
      assessments: refs,
      kpis: {
        items: a.items.length,
        excluded: excluded.size,
        medianDifficulty,
        cohortMean,
      },
      items,
      distribution,
      cohortMean,
      cohortSd,
      byElement,
      byDemand,
    };
  }

  getItemDetail(cycleId: string, assessmentId: string, itemId: string): ItemDetailModel | null {
    const a = this.assessment(assessmentId);
    if (cycleId !== this.seed.liveCycle.id || !a) return null;
    const index = a.items.findIndex((it) => it.id === itemId);
    if (index < 0) return null;
    const item = a.items[index]!;

    // Full live ItemStat (same engine call as the table) so the per-statistic
    // ratings reflect any per-student exclusions and the configured thresholds.
    const stats = engine.computeItemStats({
      responses: this.responsesOf(a),
      scoringConfig: this.scoringConfig(),
    });
    const s = stats.find((x) => x.itemId === itemId);

    // Live response rows for this item (per-student-excluded responses dropped),
    // for the outcome split and the discrimination upper/lower groups.
    const recs = this.responsesOf(a);
    const totalByP = new Map<string, number>();
    for (const r of recs) totalByP.set(r.participantId, (totalByP.get(r.participantId) ?? 0) + r.score);
    const rows = recs
      .filter((r) => r.itemId === itemId)
      .map((r) => ({ score: r.score, total: totalByP.get(r.participantId) ?? r.score }));
    const answered = rows.length;
    const correct = rows.reduce((acc, r) => acc + (r.score > 0 ? 1 : 0), 0);
    const incorrect = answered - correct;
    const presented = item.participantsPresented;
    const notAnswered = Math.max(0, presented - answered);

    // upper/lower group means (top/bottom g≈n/3 by rest-total desc, tie by total)
    const g = Math.max(1, Math.round(answered / 3));
    const ranked = rows
      .map((r) => ({ score: r.score, rest: r.total - r.score, total: r.total }))
      .sort((x, y) => y.rest - x.rest || y.total - x.total);
    const gmean = (grp: { score: number }[]) => (grp.length ? grp.reduce((acc, r) => acc + r.score, 0) / grp.length : 0);
    const upperMean = round(gmean(ranked.slice(0, g)), 2);
    const lowerMean = round(gmean(ranked.slice(answered - g)), 2);

    const pValue = s?.pValue ?? item.pValue;
    const itemTotal = s ? s.itemTotal : item.itemTotal;
    const pointBiserial = s ? s.pointBiserial : item.pointBiserial;
    const discrimination = s?.discrimination ?? item.discrimination;
    const pRating = s?.pRating ?? item.pRating;
    const itRating = s?.itRating ?? item.itRating;
    const pbRating = s?.pbRating ?? item.pbRating;
    const discRating = s?.discRating ?? item.discRating;
    const overallReview = s?.overallReview ?? item.overallReview;

    return {
      id: itemId,
      qLabel: `Q${String(index + 1).padStart(2, "0")}`,
      wording: item.wording,
      major: item.major,
      sub: item.sub,
      demand: item.demand,
      excluded: this.excludedSet(cycleId, assessmentId).has(itemId),
      reason: this.reasons.get(`${cycleId}:${assessmentId}:${itemId}`) ?? null,
      answered,
      presented,
      notAnswered,
      pValue,
      pRating,
      itemTotal,
      itRating,
      pointBiserial,
      pbRating,
      discrimination,
      discRating,
      overallReview,
      qualityIndex: s ? this.qualityIndexOf(s) : item.qualityIndex,
      groups: { size: g, upperMean, lowerMean },
      outcome: { correct, incorrect, notAnswered },
      reasons: {
        p: this.reasonForP(pValue, pRating),
        it: this.reasonForCorr("item-total correlation", itemTotal, itRating),
        pb: this.reasonForCorr("point-biserial", pointBiserial, pbRating),
        disc: this.reasonForCorr("discrimination", discrimination, discRating),
        overall: `Overall review is ${overallReview} — the worst of the four statistic ratings.`,
      },
    };
  }

  /** Plain-language reason for a p-value rating, using the live thresholds. */
  private reasonForP(p: number, rating: QualityRating): string {
    const t = this.quality.pValue;
    const v = p.toFixed(2);
    if (rating === "Good") return `p-value ${v} sits in the healthy ${t.reviewBelow.toFixed(2)}–${t.goodUpTo.toFixed(2)} band — a sensible difficulty.`;
    if (p < t.reviewBelow) return `p-value ${v} is below ${t.reviewBelow.toFixed(2)} — hard; few students answered correctly.`;
    if (p > t.goodUpTo) return `p-value ${v} is above ${t.goodUpTo.toFixed(2)} — easy; most students answered correctly.`;
    return `p-value ${v} is just outside the Good band.`;
  }

  /** Plain-language reason for a correlation-type rating, using the live thresholds. */
  private reasonForCorr(name: string, value: number | null, rating: QualityRating): string {
    const t = this.quality.itemTotal; // correlation metrics share the band shape
    if (value === null || Number.isNaN(value)) return `${name} is undefined (zero variance) — treated as Flag.`;
    const v = value.toFixed(2);
    if (rating === "Good") return `${name} ${v} is at or above ${t.reviewBelow.toFixed(2)} — discriminates well between stronger and weaker students.`;
    if (value < t.flagBelow) return `${name} ${v} is below ${t.flagBelow.toFixed(2)} — little or negative discrimination.`;
    return `${name} ${v} is between ${t.flagBelow.toFixed(2)} and ${t.reviewBelow.toFixed(2)} — weak discrimination, worth a look.`;
  }

  // ── scoring & grade boundaries ──────────────────────────────────────────---
  private scopePcts(cycleId: string, scope: string): number[] {
    if (scope === "overall") {
      const totals = new Map<string, { raw: number; max: number }>();
      for (const a of this.seed.liveCycle.assessments) {
        for (const [pid, v] of this.pctByParticipant(cycleId, a)) {
          const t = totals.get(pid) ?? { raw: 0, max: 0 };
          t.raw += v.raw;
          t.max += v.max;
          totals.set(pid, t);
        }
      }
      return [...totals.values()].filter((t) => t.max > 0).map((t) => (t.raw / t.max) * 100);
    }
    const a = this.assessment(scope);
    if (!a) return [];
    return [...this.pctByParticipant(cycleId, a).values()].map((v) => v.pct);
  }

  /** Subject total max (raw marks) for a scope, so the UI can show raw alongside %. */
  private scopeMaxRaw(cycleId: string, scope: string): number {
    if (scope === "overall") {
      let max = 0;
      for (const a of this.seed.liveCycle.assessments) {
        const vals = [...this.pctByParticipant(cycleId, a).values()].map((v) => v.max);
        max += vals.length ? Math.max(...vals) : 0;
      }
      return max;
    }
    const a = this.assessment(scope);
    if (!a) return 0;
    const vals = [...this.pctByParticipant(cycleId, a).values()].map((v) => v.max);
    return vals.length ? Math.max(...vals) : 0;
  }

  /**
   * studentId → number of D3 (top-difficulty) items answered CORRECTLY, for a
   * scope. Read-only; the cut-score lane uses this for the cohort-level ½-D3
   * sanity check on the Outstanding cut.
   *
   * LANE NOTE (Wave 3b): Wave 3a may add related per-student D3 logic (its
   * per-student Distinction cap). This helper is deliberately small and isolated
   * so the two can be reconciled / de-duplicated trivially at merge — do not
   * fold award or per-student-cap logic in here.
   *
   * CONFIRM — "correct" is interpreted as FULL MARKS on the item
   * (score ≥ item maxScore). The existing safeguard counts "attempted" (any
   * non-blank response); this helper counts correct on purpose. Flip the
   * predicate if the methodology says otherwise.
   */
  private computeD3CorrectByStudent(cycleId: string, scope: string): Map<string, number> {
    void cycleId;
    const demand = this.resolveTopDifficulty();
    const out = new Map<string, number>();
    const asms =
      scope === "overall"
        ? this.seed.liveCycle.assessments
        : this.seed.liveCycle.assessments.filter((a) => a.id === scope);
    for (const a of asms) {
      const pool = new Map(a.items.filter((it) => it.demand === demand).map((it) => [it.id, it.maxScore]));
      for (const r of a.responses) {
        if (!pool.has(r.i)) continue;
        const maxScore = pool.get(r.i)!;
        const correct = maxScore > 0 ? r.s >= maxScore : r.s > 0;
        if (correct) out.set(r.p, (out.get(r.p) ?? 0) + 1);
        else if (!out.has(r.p)) out.set(r.p, out.get(r.p) ?? 0);
      }
    }
    return out;
  }

  /** Count of D3 (top-difficulty) items in a scope. */
  private scopeD3Total(scope: string): number {
    const demand = this.resolveTopDifficulty();
    const asms =
      scope === "overall"
        ? this.seed.liveCycle.assessments
        : this.seed.liveCycle.assessments.filter((a) => a.id === scope);
    let total = 0;
    for (const a of asms) total += a.items.filter((it) => it.demand === demand).length;
    return total;
  }

  /**
   * ½-D3 cohort sanity check for an Outstanding cut (percent). Looks at the
   * students who clear the cut and asks whether they all reached ≥ ½ of D3 items
   * correct. Warning only — never a clamp. See cut-scores.ts for the flagged
   * interpretation.
   */
  private d3WarningForCut(cycleId: string, scope: string, outstandingCutPct: number): D3HalfWarning {
    const d3Total = this.scopeD3Total(scope);
    const d3Correct = this.computeD3CorrectByStudent(cycleId, scope);
    const max = this.scopeMaxRaw(cycleId, scope);
    // Students at/above the Outstanding cut, by percent of subject max.
    const pctMap = this.scopePctByStudent(cycleId, scope);
    const cleared: number[] = [];
    for (const [pid, pct] of pctMap) {
      if (pct >= outstandingCutPct) cleared.push(d3Correct.get(pid) ?? 0);
    }
    void max;
    const r = checkOutstandingHalfD3(cleared, d3Total);
    return {
      applicable: d3Total > 0 && r.outstandingCount > 0,
      consistent: r.consistent,
      d3Total: r.d3Total,
      halfThreshold: r.halfThreshold,
      outstandingCount: r.outstandingCount,
      belowHalf: r.belowHalf,
      note: r.note,
    };
  }

  /** studentId → percent of subject max for a scope (mirrors scopePcts, keyed). */
  private scopePctByStudent(cycleId: string, scope: string): Map<string, number> {
    if (scope === "overall") {
      const totals = new Map<string, { raw: number; max: number }>();
      for (const a of this.seed.liveCycle.assessments) {
        for (const [pid, v] of this.pctByParticipant(cycleId, a)) {
          const t = totals.get(pid) ?? { raw: 0, max: 0 };
          t.raw += v.raw;
          t.max += v.max;
          totals.set(pid, t);
        }
      }
      const out = new Map<string, number>();
      for (const [pid, t] of totals) if (t.max > 0) out.set(pid, (t.raw / t.max) * 100);
      return out;
    }
    const a = this.assessment(scope);
    const out = new Map<string, number>();
    if (!a) return out;
    for (const [pid, v] of this.pctByParticipant(cycleId, a)) out.set(pid, v.pct);
    return out;
  }

  getBoundaries(cycleId: string, scope: string): BoundaryModel | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const scopes = [
      ...this.seed.liveCycle.assessments.map((a) => ({ id: a.id, label: a.shortName })),
      { id: "overall", label: "Overall award" },
    ];
    const scopeLabel = scopes.find((s) => s.id === scope)?.label ?? "Overall award";

    const scheme = this.schemeFor(scope);
    const levels = scheme.levels;
    const st = this.boundaryState(cycleId, scope);

    const pcts = this.scopePcts(cycleId, scope);
    const n = pcts.length;

    // integer-resolution counts (0..100) for band maths
    const counts = new Array(101).fill(0) as number[];
    for (const p of pcts) {
      const ci = Math.max(0, Math.min(100, Math.round(p)));
      counts[ci] = (counts[ci] ?? 0) + 1;
    }
    const atAbove = new Array(102).fill(0) as number[];
    for (let s = 100; s >= 0; s--) atAbove[s] = atAbove[s + 1]! + counts[s]!;
    const atOrAbove = (cut: number) => atAbove[Math.max(0, Math.min(100, Math.round(cut)))]!;

    // Backsolve the suggestion from the current targets via the cut-score engine
    // (Wave 3b): nearest-achievable snapping + the 25%/90% guard-rails. The award
    // scope keeps its own cumulative banding; the guard-rails are a per-subject
    // performance-cut policy, so we only apply them to non-award scopes.
    const backsolve = scheme.isAward
      ? backsolveCuts(pcts, st.targets, { floorPct: 0, ceilingPct: 100 })
      : backsolveCuts(pcts, st.targets, POLICY_GUARDRAILS);

    // In "pct" mode the effective cuts ARE the backsolved suggestion; in "cuts"
    // mode the user's committed cuts win.
    const effCuts = st.mode === "cuts" ? st.cuts : backsolve.cuts;
    const last = levels.length - 1;
    // Students per band, top → bottom; the lowest band is the remainder.
    const bands: GradeBandRow[] = levels.map((level, i) => {
      let students: number;
      if (i === 0) students = atOrAbove(effCuts[0] ?? 0);
      else if (i === last) students = n - atOrAbove(effCuts[i - 1] ?? 0);
      else students = atOrAbove(effCuts[i] ?? 0) - atOrAbove(effCuts[i - 1] ?? 0);
      return {
        level,
        stars: scheme.isAward ? null : starsFor(level, this.grading.starMap),
        cut: i === last ? null : effCuts[i] ?? null,
        students,
        pct: n ? round((students / n) * 100, 1) : 0,
      };
    });

    // 51 two-point bins for the chart
    const histogram = new Array(51).fill(0) as number[];
    for (let s = 0; s <= 100; s++) {
      const hi = Math.min(50, Math.floor(s / 2));
      histogram[hi] = (histogram[hi] ?? 0) + (counts[s] ?? 0);
    }

    // items scored / excluded for this scope
    let itemsScored = 0;
    let excludedCount = 0;
    if (scope === "overall") {
      for (const a of this.seed.liveCycle.assessments) {
        const ex = this.excludedSet(cycleId, a.id);
        itemsScored += a.items.length - ex.size;
        excludedCount += ex.size;
      }
    } else {
      const a = this.assessment(scope);
      const ex = this.excludedSet(cycleId, scope);
      itemsScored = (a?.items.length ?? 0) - ex.size;
      excludedCount = ex.size;
    }

    const maxRaw = this.scopeMaxRaw(cycleId, scope);
    const notApplicableD3: D3HalfWarning = {
      applicable: false,
      consistent: true,
      d3Total: this.scopeD3Total(scope),
      halfThreshold: Math.ceil(this.scopeD3Total(scope) / 2),
      outstandingCount: 0,
      belowHalf: 0,
      note: scheme.isAward
        ? "The ½-D3 check applies to the per-subject Outstanding cut, not the overall award."
        : "No Outstanding-band students — ½-D3 check not applicable.",
    };
    // ½-D3 warnings: the suggestion's against its own Outstanding cut; the live
    // one against the EFFECTIVE Outstanding cut (so an edit re-evaluates it).
    const suggestionD3 = scheme.isAward
      ? notApplicableD3
      : this.d3WarningForCut(cycleId, scope, backsolve.cuts[0] ?? 100);
    const d3Warning = scheme.isAward
      ? notApplicableD3
      : this.d3WarningForCut(cycleId, scope, effCuts[0] ?? 100);

    return {
      cycleId,
      scope,
      scopeLabel,
      scopes,
      mode: st.mode,
      isAward: scheme.isAward,
      histogram,
      levels,
      cuts: effCuts,
      targets: st.targets,
      bands,
      stats: {
        mean: round(mean(pcts), 1),
        median: round(median(pcts), 0),
        sd: round(stddev(pcts), 1),
        itemsScored,
        excluded: excludedCount,
      },
      n,
      locked: this.locked.has(cycleId),
      guardrails: scheme.isAward
        ? { floorPct: 0, ceilingPct: 100 }
        : { floorPct: POLICY_GUARDRAILS.floorPct, ceilingPct: POLICY_GUARDRAILS.ceilingPct },
      maxRaw,
      suggestion: {
        cuts: backsolve.cuts,
        perCut: backsolve.perCut,
        targets: [...st.targets],
        d3: suggestionD3,
      },
      suggestedCuts: st.suggested ? [...st.suggested] : null,
      d3Warning,
    };
  }

  // ── grades & sign-off ───────────────────────────────────────────────────--
  /** Per-participant overall raw / max / pct across all assessments. */
  private overallScoreByParticipant(cycleId: string): Map<string, { raw: number; max: number; pct: number }> {
    const totals = new Map<string, { raw: number; max: number }>();
    for (const a of this.seed.liveCycle.assessments) {
      for (const [pid, v] of this.pctByParticipant(cycleId, a)) {
        const t = totals.get(pid) ?? { raw: 0, max: 0 };
        t.raw += v.raw;
        t.max += v.max;
        totals.set(pid, t);
      }
    }
    const out = new Map<string, { raw: number; max: number; pct: number }>();
    for (const [pid, t] of totals) out.set(pid, { raw: t.raw, max: t.max, pct: t.max ? (t.raw / t.max) * 100 : 0 });
    return out;
  }
  /** Per-participant overall percentage = total raw / total max across assessments. */
  private overallPctByParticipant(cycleId: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const [pid, s] of this.overallScoreByParticipant(cycleId)) out.set(pid, s.pct);
    return out;
  }

  getGrades(cycleId: string): GradesModel | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const refs = this.assessmentRefs(cycleId);
    const perfLevels = this.grading.performanceLevels;
    const awardLevels = this.grading.awardLevels;

    // per-assessment pct maps + effective cut-points
    const pctMaps = new Map<string, Map<string, number>>();
    const cutsByScope = new Map<string, number[]>();
    for (const a of this.seed.liveCycle.assessments) {
      const m = new Map<string, number>();
      for (const [pid, v] of this.pctByParticipant(cycleId, a)) m.set(pid, v.pct);
      pctMaps.set(a.id, m);
      cutsByScope.set(a.id, this.boundaryState(cycleId, a.id).cuts);
    }
    const overallScores = this.overallScoreByParticipant(cycleId);
    // Layer 2: the award is the deterministic lookup from the five subject
    // performance levels (NOT a cut on an overall score), with the per-student D3
    // cap (Layer 1b) applied to Distinction eligibility.
    const d3Cap = this.d3CapByParticipant(cycleId);
    const overrides = this.distinctionOverrides.get(cycleId);

    const rows = this.seed.liveCycle.participants.map((p) => {
      const grades: Record<string, { level: string; stars: string }> = {};
      const subjectLevels: string[] = [];
      for (const a of this.seed.liveCycle.assessments) {
        const pct = pctMaps.get(a.id)?.get(p.id);
        const level = pct === undefined ? "" : classify(pct, perfLevels, cutsByScope.get(a.id)!);
        grades[a.id] = { level, stars: starsFor(level, this.grading.starMap) };
        subjectLevels.push(level);
      }
      const score = overallScores.get(p.id);
      const d3 = d3Cap.get(p.id);
      const overridden = overrides?.has(p.id) ?? false;
      const outcome = deriveAward(
        { subjectLevels, d3Pass: (d3?.pass ?? true) || overridden },
        { performanceLevels: perfLevels, awardLevels },
      );
      // Surface the working only where the D3 cap actually denied a Distinction.
      const distinctionCap =
        outcome.d3Capped && !overridden && d3?.failing
          ? {
              subject: d3.failing.shortName,
              correct: d3.failing.correct,
              available: d3.failing.available,
              majority: d3.failing.majority,
            }
          : null;
      return {
        id: p.id,
        studentId: p.studentId ?? p.id,
        label: p.label,
        grades,
        award: outcome.award,
        distinctionCap,
        overallRaw: round(score?.raw ?? 0, 1),
        overallMax: round(score?.max ?? 0, 1),
        overallPct: round(score?.pct ?? 0, 1),
      };
    });

    const distCounts = new Map<string, number>();
    for (const r of rows) distCounts.set(r.award, (distCounts.get(r.award) ?? 0) + 1);
    const distribution = awardLevels.map((level) => ({ level, count: distCounts.get(level) ?? 0 }));

    return {
      cycleId,
      assessments: refs,
      rows,
      distribution,
      awardLevels,
      starMap: this.grading.starMap,
      performanceLevels: perfLevels,
      locked: this.locked.has(cycleId),
      canLock: this.user.role === "lead_admin" && !this.locked.has(cycleId),
    };
  }

  // ── Overall (best-of-two across the year's two sittings) ──────────────────
  /**
   * The year's Overall view: per student, per subject, the HIGHER award of the
   * two sittings (by level rank), plus the derived overall award. Pure
   * aggregation over each sitting's signed-off `GradesModel` (see
   * `lib/data/overall.ts`) — no scoring, cut-score, or safeguard work runs here.
   *
   * In this build only the live (May) sitting carries real grades, and live
   * Supabase is unreachable, so the February baseline is synthesized from the May
   * cohort (clearly flagged `demo: true`) to give the rollup two sittings to
   * compare. With real two-sitting data, both sittings' `getGrades` feed the same
   * `rollupOverall` unchanged.
   */
  getOverallGrades(yearId: string): OverallGradesModel | null {
    const year = this.buildYears().find((y) => y.id === yearId);
    if (!year) return null;

    const mayGrades = year.may.cycleId ? this.getGrades(year.may.cycleId) : null;
    const realFeb = year.february.cycleId ? this.getGrades(year.february.cycleId) : null;
    // Demo February baseline (only when there's a real May sitting but no real
    // February grades to compare against).
    const febGrades = realFeb ?? (mayGrades ? this.demoFebruaryGrades(mayGrades) : null);
    const demo = realFeb === null && febGrades !== null;

    if (!mayGrades && !febGrades) return null;

    const perfLevels = this.grading.performanceLevels;
    const awardLevels = this.grading.awardLevels;
    const starMap = this.grading.starMap;
    const assessments = (mayGrades ?? febGrades)!.assessments;

    const rows = rollupOverall({
      february: febGrades,
      may: mayGrades,
      assessments,
      performanceLevels: perfLevels,
      awardLevels,
      starMap,
    });

    const distCounts = new Map<string, number>();
    for (const r of rows) distCounts.set(r.award, (distCounts.get(r.award) ?? 0) + 1);
    const distribution = awardLevels.map((level) => ({ level, count: distCounts.get(level) ?? 0 }));

    const ready = year.february.started && year.february.locked && year.may.started && year.may.locked;
    const note = ready
      ? "Both sittings are signed off — this Overall is final and certificates issue from it."
      : "Overall is provisional until both the February and May sittings are locked; figures shown are the current best-of-two.";

    return {
      yearId: year.id,
      yearName: year.name,
      assessments,
      rows,
      distribution,
      awardLevels,
      starMap,
      performanceLevels: perfLevels,
      february: { cycleId: year.february.cycleId, cycleName: year.february.cycleName },
      may: { cycleId: year.may.cycleId, cycleName: year.may.cycleName },
      ready,
      locked: ready,
      demo,
      note,
    };
  }

  /**
   * Synthesize a DEMO February sitting from the May cohort so the best-of-two
   * rollup has two sittings to compare in this fixtures-only build. Deterministic
   * per (studentId, subject): most subjects sit one level BELOW May (a student who
   * improved by May → May wins), some equal, some ABOVE May (February stands), and
   * a few absent (not sat in February → only May). The February award is derived
   * with the same award rule, so it is a faithful "signed-off" second sitting.
   *
   * NOT real data — `getOverallGrades` flags this with `demo: true`. With real
   * two-sitting data, `getGrades` returns the actual February grades and this is
   * never called.
   */
  private demoFebruaryGrades(may: GradesModel): GradesModel {
    const levels = this.grading.performanceLevels; // best → lowest
    const L = levels.length;
    const awardLevels = this.grading.awardLevels;
    const starMap = this.grading.starMap;

    const rows: GradeMatrixRow[] = may.rows.map((r) => {
      const grades: Record<string, GradeCell> = {};
      for (const a of may.assessments) {
        const mayLevel = r.grades[a.id]?.level ?? "";
        const mr = mayLevel ? levels.indexOf(mayLevel) : L - 1;
        const baseRank = mr < 0 ? L - 1 : mr;
        const b = hash32(`${r.studentId}|${a.id}`) % 10;
        let level: string;
        if (b < 1) level = ""; // ~10%: not sat in February → only May has a result
        else if (b < 6) level = levels[Math.min(L - 1, baseRank + 1)] ?? ""; // ~50%: one below → May wins
        else if (b < 8) level = levels[baseRank] ?? ""; // ~20%: equal
        else level = levels[Math.max(0, baseRank - 1)] ?? ""; // ~20%: one above → February stands
        grades[a.id] = { level, stars: level ? starsFor(level, starMap) : "" };
      }
      const subjectLevels = may.assessments.map((a) => grades[a.id]?.level ?? "");
      const outcome = deriveAward(
        { subjectLevels, d3Pass: true },
        { performanceLevels: levels, awardLevels },
      );
      return {
        id: r.id,
        studentId: r.studentId,
        label: r.label,
        grades,
        award: outcome.award,
        distinctionCap: null,
        overallRaw: r.overallRaw,
        overallMax: r.overallMax,
        overallPct: r.overallPct,
      };
    });

    const distCounts = new Map<string, number>();
    for (const r of rows) distCounts.set(r.award, (distCounts.get(r.award) ?? 0) + 1);
    const distribution = awardLevels.map((level) => ({ level, count: distCounts.get(level) ?? 0 }));

    return { ...may, cycleId: "demo-february", rows, distribution };
  }

  /**
   * Certificates & reports for the Overall (best-of-two) result. Certificates
   * issue from Overall — NOT a single sitting — so this points the document
   * generator at the rolled-up best-of-two awards. Only available once the Overall
   * is signed off (both sittings locked), mirroring the per-sitting lock gate.
   */
  getOverallDocuments(yearId: string): DocumentsModel | null {
    const overall = this.getOverallGrades(yearId);
    if (!overall) return null;
    const locked = overall.locked;

    const refs = overall.assessments;
    const resolve = (re: RegExp) => refs.find((a) => re.test(a.id) || re.test(a.name));
    const slotDefs: { slot: string; re: RegExp }[] = [
      { slot: "S1", re: /applicable math/i },
      { slot: "S2", re: /scientific/i },
      { slot: "S3", re: /arabic/i },
      { slot: "S4", re: /english/i },
      { slot: "S5", re: /life/i },
    ];
    const subjectOrder = slotDefs.map((d) => ({ slot: d.slot, assessment: resolve(d.re)?.name ?? d.slot }));

    const base = this.docSettings(overall.may?.cycleId ?? yearId);
    const settings: DocSettings = { ...base, cycleName: `${overall.yearName} · Overall` };

    if (!locked) {
      return { cycleId: yearId, locked, students: [], settings, subjectOrder };
    }

    const students: StudentSummary[] = overall.rows.map((r) => ({
      participantId: r.id,
      name: r.label,
      award: r.award,
      subjects: slotDefs.map((d) => {
        const ref = resolve(d.re);
        const cell = ref ? r.grades[ref.id] : undefined;
        return {
          slot: d.slot,
          assessment: ref?.name ?? d.slot,
          level: cell?.level ?? "",
          stars: cell?.stars ?? "",
        };
      }),
    }));

    return { cycleId: yearId, locked, students, settings, subjectOrder };
  }

  /**
   * Per-student, per-assessment, per-major-element performance levels for the
   * Students_Performance_Report export. Element levels are computed from the
   * student's retained responses on that element's items, classified with the
   * same per-assessment cut-points the overall subject level uses. All real
   * computed data — nothing fabricated.
   */
  getPerformanceReport(cycleId: string): PerformanceReportModel | null {
    const grades = this.getGrades(cycleId);
    if (!grades) return null;
    const perfLevels = this.grading.performanceLevels;

    // subjects with ordered major elements + sub-elements, and per-participant
    // levels at both major-element and sub-element granularity. The construct
    // structure (3–5 major elements per subject, each with sub-elements) is read
    // from the data, never hardcoded.
    const subjects: PerfReportSubject[] = [];
    const elementLevelByP = new Map<string, Map<string, Map<string, string>>>(); // assessmentId -> pid -> major -> level
    // assessmentId -> pid -> major -> sub -> level
    const subLevelByP = new Map<string, Map<string, Map<string, Map<string, string>>>>();
    for (const a of this.seed.liveCycle.assessments) {
      const cuts = this.boundaryState(cycleId, a.id).cuts;
      const itemMajor = new Map<string, string | null>();
      const itemSub = new Map<string, string | null>();
      const majorOrder: string[] = [];
      const subOrder: Record<string, string[]> = {};
      for (const it of a.items) {
        itemMajor.set(it.id, it.major);
        itemSub.set(it.id, it.sub);
        if (it.major && !majorOrder.includes(it.major)) majorOrder.push(it.major);
        if (it.major && it.sub) {
          (subOrder[it.major] ??= []);
          if (!subOrder[it.major]!.includes(it.sub)) subOrder[it.major]!.push(it.sub);
        }
      }
      subjects.push({ assessmentId: a.id, name: a.name, majorElements: majorOrder, subElements: subOrder });

      const excluded = this.excludedSet(cycleId, a.id);
      // accumulate raw/n per (participant, major) and per (participant, major, sub)
      const acc = new Map<string, Map<string, { raw: number; n: number }>>();
      const subAcc = new Map<string, Map<string, Map<string, { raw: number; n: number }>>>();
      for (const r of this.responsesOf(a)) {
        if (excluded.has(r.itemId)) continue;
        const el = itemMajor.get(r.itemId);
        if (!el) continue;
        let byEl = acc.get(r.participantId);
        if (!byEl) acc.set(r.participantId, (byEl = new Map()));
        const cell = byEl.get(el) ?? { raw: 0, n: 0 };
        cell.raw += r.score;
        cell.n += 1;
        byEl.set(el, cell);

        const sub = itemSub.get(r.itemId);
        if (sub) {
          let byMajor = subAcc.get(r.participantId);
          if (!byMajor) subAcc.set(r.participantId, (byMajor = new Map()));
          let bySub = byMajor.get(el);
          if (!bySub) byMajor.set(el, (bySub = new Map()));
          const sc = bySub.get(sub) ?? { raw: 0, n: 0 };
          sc.raw += r.score;
          sc.n += 1;
          bySub.set(sub, sc);
        }
      }
      const pMap = new Map<string, Map<string, string>>();
      for (const [pid, byEl] of acc) {
        const lvls = new Map<string, string>();
        for (const [el, cell] of byEl) {
          const pct = cell.n ? (cell.raw / cell.n) * 100 : 0;
          lvls.set(el, classify(pct, perfLevels, cuts));
        }
        pMap.set(pid, lvls);
      }
      elementLevelByP.set(a.id, pMap);

      const pSubMap = new Map<string, Map<string, Map<string, string>>>();
      for (const [pid, byMajor] of subAcc) {
        const majorMap = new Map<string, Map<string, string>>();
        for (const [el, bySub] of byMajor) {
          const subLvls = new Map<string, string>();
          for (const [sub, cell] of bySub) {
            const pct = cell.n ? (cell.raw / cell.n) * 100 : 0;
            subLvls.set(sub, classify(pct, perfLevels, cuts));
          }
          majorMap.set(el, subLvls);
        }
        pSubMap.set(pid, majorMap);
      }
      subLevelByP.set(a.id, pSubMap);
    }

    const students: PerfReportStudent[] = grades.rows.map((row) => {
      const sub: Record<string, PerfElementResult> = {};
      for (const a of this.seed.liveCycle.assessments) {
        const level = row.grades[a.id]?.level ?? "";
        const elements: Record<string, string> = {};
        const lvls = elementLevelByP.get(a.id)?.get(row.id);
        if (lvls) for (const [el, lv] of lvls) elements[el] = lv;
        const subElements: Record<string, Record<string, string>> = {};
        const subLvls = subLevelByP.get(a.id)?.get(row.id);
        if (subLvls) for (const [el, bySub] of subLvls) {
          subElements[el] = {};
          for (const [s, lv] of bySub) subElements[el]![s] = lv;
        }
        sub[a.id] = { level, elements, subElements };
      }
      return { participantId: row.id, name: row.label, award: row.award, subjects: sub };
    });

    // canonical Student-Summary columns mapped by subject alias (keyword)
    const refs = grades.assessments;
    const aliasFor = (re: RegExp) => refs.find((r) => re.test(r.id) || re.test(r.name))?.id ?? null;
    const summarySubjects: PerfReportSummarySubject[] = [
      { label: "Applicable Maths", assessmentId: aliasFor(/applicable math/i) },
      { label: "Scientific Thinking", assessmentId: aliasFor(/scientific/i) },
      { label: "Arabic 1st Language", assessmentId: aliasFor(/arabic/i) },
      { label: "English 2nd Language", assessmentId: aliasFor(/english/i) },
      { label: "Life Success Skills", assessmentId: aliasFor(/life/i) },
    ];

    const n = grades.rows.length;
    const awardDistribution = grades.distribution.map((d) => ({
      level: d.level,
      count: d.count,
      pct: n ? round((d.count / n) * 100, 1) : 0,
    }));

    return {
      cycleName: this.seed.liveCycle.name,
      performanceLevels: perfLevels,
      awardLevels: this.grading.awardLevels,
      subjects,
      summarySubjects,
      students,
      awardDistribution,
    };
  }

  // ── live item statistics (per-student exclusions nudge cohort psychometrics)
  /** Transparent 0–100 quality index — mirrors scripts/build-seed.mts exactly. */
  private qualityIndexOf(s: ItemStat): number {
    const score: Record<QualityRating, number> = { Good: 1, Review: 0.55, Flag: 0.12 };
    const avg = (score[s.pRating] + score[s.itRating] + score[s.pbRating] + score[s.discRating]) / 4;
    return Math.round(avg * 100);
  }
  /**
   * Recompute one assessment's item statistics through the engine, dropping any
   * per-student-excluded responses. With no per-student exclusions this is
   * byte-identical to the seed (parity-verified), so the Review screen is
   * unchanged until a technical fault is excluded.
   */
  private liveItemStats(
    cycleId: string,
    a: SeedAssessment,
  ): Map<string, { pValue: number; itemTotal: number | null; pointBiserial: number | null; discrimination: number; overallReview: QualityRating; qualityIndex: number }> {
    const stats = engine.computeItemStats({
      responses: this.responsesOf(a),
      scoringConfig: this.scoringConfig(),
    });
    const out = new Map<
      string,
      { pValue: number; itemTotal: number | null; pointBiserial: number | null; discrimination: number; overallReview: QualityRating; qualityIndex: number }
    >();
    for (const s of stats) {
      out.set(s.itemId, {
        pValue: s.pValue,
        itemTotal: s.itemTotal,
        pointBiserial: s.pointBiserial,
        discrimination: s.discrimination,
        overallReview: s.overallReview,
        qualityIndex: this.qualityIndexOf(s),
      });
    }
    return out;
  }

  // ── per-student technical exclusions (Student review step) ────────────────
  /** All demand levels present across the cycle, ascending (e.g. D1 < D2 < D3). */
  private allDemandLevels(): string[] {
    const set = new Set<string>();
    for (const a of this.seed.liveCycle.assessments) for (const it of a.items) if (it.demand) set.add(it.demand);
    return [...set].sort();
  }
  /** The "top-difficulty" demand: configured value, else the highest present. */
  private resolveTopDifficulty(assessmentId?: string): string {
    if (this.safeguard.topDifficultyDemand) return this.safeguard.topDifficultyDemand;
    const set = new Set<string>();
    const asms = assessmentId
      ? this.seed.liveCycle.assessments.filter((a) => a.id === assessmentId)
      : this.seed.liveCycle.assessments;
    for (const a of asms) for (const it of a.items) if (it.demand) set.add(it.demand);
    const sorted = [...set].sort();
    return sorted[sorted.length - 1] ?? "";
  }
  /** Locate an item across assessments, with a display label (Q-index in order). */
  private itemLocate(itemId: string): { a: SeedAssessment; item: SeedItem; label: string } | null {
    for (const a of this.seed.liveCycle.assessments) {
      const idx = a.items.findIndex((it) => it.id === itemId);
      if (idx >= 0) return { a, item: a.items[idx]!, label: `Q${idx + 1}` };
    }
    return null;
  }
  private buildIncident(
    studentId: string,
    studentName: string,
    itemId: string | null,
    questionRaw: string,
    error: string,
    decision: IncidentDecision = null,
    reason: string | null = null,
  ): TechnicalIncident {
    const loc = itemId ? this.itemLocate(itemId) : null;
    this.incidentSeq += 1;
    return {
      id: `inc-${this.incidentSeq}`,
      studentId,
      studentName,
      assessmentId: loc?.a.id ?? "",
      assessmentName: loc?.a.name ?? "Unmatched",
      itemId: loc ? itemId : null,
      questionLabel: loc?.label ?? questionRaw,
      demand: loc?.item.demand ?? null,
      wording: loc?.item.wording ?? null,
      rtl: loc?.a.rtl ?? false,
      error,
      decision,
      reason,
      by: decision ? this.user.name : null,
      at: decision ? new Date().toISOString() : null,
    };
  }
  /** Match an uploaded student cell to a participant (by id or friendly label). */
  private matchStudent(raw: string): { id: string; name: string } {
    const clean = raw.trim();
    const byId = this.seed.liveCycle.participants.find((p) => p.id.toLowerCase() === clean.toLowerCase());
    if (byId) return { id: byId.id, name: byId.label };
    const byLabel = this.seed.liveCycle.participants.find((p) => p.label.toLowerCase() === clean.toLowerCase());
    if (byLabel) return { id: byLabel.id, name: byLabel.label };
    return { id: clean, name: clean };
  }

  private technicalErrorsUpload(cycleId: string): TechnicalErrorsUpload {
    const te = this.technicalErrors.get(cycleId);
    if (!te || !te.uploaded) {
      return { uploaded: false, fileName: null, incidentCount: 0, matchedCount: 0, preview: { headers: [], rows: [] }, sample: false };
    }
    const matched = te.incidents.filter((i) => i.itemId).length;
    return {
      uploaded: true,
      fileName: te.fileName,
      incidentCount: te.incidents.length,
      matchedCount: matched,
      preview: {
        headers: ["Student", "Question", "Error"],
        rows: te.incidents.slice(0, 5).map((i) => [i.studentName, i.questionLabel, i.error]),
      },
      sample: te.sample,
    };
  }

  getStudentReview(cycleId: string): StudentReviewModel | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const te = this.technicalErrors.get(cycleId);
    const incidents = te?.incidents ?? [];
    const excluded = incidents.filter((i) => i.decision === "excluded").length;
    const kept = incidents.filter((i) => i.decision === "kept").length;
    const awaiting = incidents.filter((i) => i.decision == null).length;
    const students = new Set(incidents.map((i) => i.studentId)).size;
    return {
      cycleId,
      uploaded: !!te?.uploaded,
      sample: !!te?.sample,
      fileName: te?.fileName ?? null,
      incidents,
      counts: { incidents: incidents.length, excluded, kept, awaiting, students },
    };
  }

  uploadTechnicalErrors(cycleId: string, fileName: string, rows: TechnicalErrorRow[]): void {
    if (this.locked.has(cycleId)) return;
    const incidents = rows
      .filter((r) => (r.student ?? "").trim() || (r.question ?? "").trim())
      .map((r) => {
        const stud = this.matchStudent(String(r.student ?? ""));
        const q = String(r.question ?? "").trim();
        const matched = this.itemLocate(q);
        return this.buildIncident(stud.id, stud.name, matched ? q : null, q, String(r.error ?? "").trim() || "Technical fault reported");
      });
    this.technicalErrors.set(cycleId, { uploaded: true, sample: false, fileName, incidents });
    const matched = incidents.filter((i) => i.itemId).length;
    this.audit("upload", "Added technical-errors file", `${fileName} — ${incidents.length} incidents (${matched} matched to items)`, cycleId);
    this.bump();
  }

  /**
   * Load the small, clearly-labelled SAMPLE faults fixture. Every incident
   * references a REAL seeded participant and item (so exclusions genuinely flow
   * into scoring); it is flagged `sample: true` everywhere it surfaces.
   */
  loadSampleTechnicalErrors(cycleId: string): void {
    if (cycleId !== this.seed.liveCycle.id || this.locked.has(cycleId)) return;
    const label = (id: string) => this.seed.liveCycle.participants.find((p) => p.id === id)?.label ?? id;
    const spec: { sid: string; item: string; error: string; decision: IncidentDecision; reason: string | null }[] = [
      { sid: "P0010", item: "100002785246", error: "Calculator tool froze mid-question; ~4 min lost", decision: "excluded", reason: "Confirmed technical fault" },
      { sid: "P0010", item: "100002785119", error: "Graph image failed to load on first attempt", decision: null, reason: null },
      { sid: "P0013", item: "100002785560", error: "Audio clip would not play (listening item)", decision: null, reason: null },
      { sid: "P0015", item: "100002785334", error: "النص العربي لم يظهر بشكل صحيح أثناء الاختبار", decision: null, reason: null },
      { sid: "P0009", item: "100002785120", error: "Power outage in room B; session paused 8 min", decision: "excluded", reason: "Power outage" },
      { sid: "P0013", item: "100002785374", error: "Tablet battery died; resumed on a new device", decision: "kept", reason: null },
    ];
    let seq = 0;
    const incidents = spec.map((s) => {
      void (seq += 1);
      return this.buildIncident(s.sid, label(s.sid), s.item, s.item, s.error, s.decision, s.reason);
    });
    this.technicalErrors.set(cycleId, { uploaded: true, sample: true, fileName: "sample_technical_errors.csv", incidents });
    this.audit("upload", "Loaded sample faults", `${incidents.length} labelled sample incidents (not from a real file)`, cycleId);
    this.bump();
  }

  clearTechnicalErrors(cycleId: string): void {
    if (this.locked.has(cycleId)) return;
    if (!this.technicalErrors.has(cycleId)) return;
    this.technicalErrors.delete(cycleId);
    this.audit("upload", "Removed technical-errors file", "Per-student exclusions cleared", cycleId);
    this.bump();
  }

  // ── essay marks (Part 2) ──────────────────────────────────────────────────
  /**
   * Aggregate raw essay rows into one mark per student per essay subject.
   * CONFIRM: the per-student subject mark is the MEAN of that student's per-essay
   * `TotalScore`s (sum ÷ count). If the real file provides a single final mark,
   * that single value is used directly (count 1). Change the divisor here if the
   * marking team aggregates differently.
   */
  private buildEssayState(rows: EssayUploadRow[], sample: boolean, fileName: string | null) {
    const agg = new Map<string, { participantId: string; subjectCode: string; sum: number; count: number }>();
    for (const r of rows) {
      const k = `${r.participantId}|${r.subjectCode}`;
      const e = agg.get(k) ?? { participantId: r.participantId, subjectCode: r.subjectCode, sum: 0, count: 0 };
      e.sum += r.totalScore;
      e.count += 1;
      agg.set(k, e);
    }
    const marks: EssayMark[] = [];
    const essayCounts = new Map<string, number>();
    const unmatched = new Set<string>();
    for (const e of agg.values()) {
      const a = this.essayAssessmentForCode(e.subjectCode);
      if (!a) continue; // only Arabic/English carry essays
      const stud = this.matchStudent(e.participantId);
      const isMatched = this.seed.liveCycle.participants.some((p) => p.id === stud.id);
      if (!isMatched) {
        unmatched.add(e.participantId);
        continue;
      }
      marks.push({ participantId: stud.id, assessmentId: a.id, mark: e.count ? e.sum / e.count : 0 });
      essayCounts.set(`${stud.id}|${a.id}`, e.count);
    }
    return { uploaded: true, sample, fileName, marks, essayCounts, unmatchedIds: [...unmatched] };
  }

  uploadEssayMarks(cycleId: string, fileName: string, rows: EssayUploadRow[]): void {
    if (this.locked.has(cycleId)) return;
    const st = this.buildEssayState(rows, false, fileName);
    this.essayMarksByCycle.set(cycleId, st);
    const students = new Set(st.marks.map((m) => m.participantId)).size;
    this.audit(
      "upload",
      "Added essay-marks file",
      `${fileName} — ${st.marks.length} subject marks across ${students} students (${st.unmatchedIds.length} unmatched IDs)`,
      cycleId,
    );
    this.bump();
  }

  /**
   * Load a small, clearly-labelled SAMPLE essay-marks set. Every row references a
   * REAL seeded participant (so the marks genuinely flow into Arabic/English
   * subject totals); flagged `sample: true` everywhere it surfaces. Two essays
   * per student per subject exercise the averaging rule.
   */
  loadSampleEssayMarks(cycleId: string): void {
    if (cycleId !== this.seed.liveCycle.id || this.locked.has(cycleId)) return;
    const ids = this.seed.liveCycle.participants.slice(0, 10).map((p) => p.id);
    const rows: EssayUploadRow[] = [];
    ids.forEach((sid, i) => {
      // deterministic, plausible marks out of 20 (two essays each)
      const afl = [11 + (i % 7), 12 + ((i + 3) % 6)];
      const esl = [10 + ((i + 2) % 8), 13 + (i % 5)];
      for (const s of afl) rows.push({ participantId: sid, subjectCode: "AFL", totalScore: Math.min(20, s) });
      for (const s of esl) rows.push({ participantId: sid, subjectCode: "ESL", totalScore: Math.min(20, s) });
    });
    this.essayMarksByCycle.set(cycleId, this.buildEssayState(rows, true, "sample_essay_marks.xlsx"));
    this.audit("upload", "Loaded sample essay marks", `${ids.length} students × 2 essay subjects (labelled sample, not from a real file)`, cycleId);
    this.bump();
  }

  clearEssayMarks(cycleId: string): void {
    if (this.locked.has(cycleId)) return;
    if (!this.essayMarksByCycle.has(cycleId)) return;
    this.essayMarksByCycle.delete(cycleId);
    this.audit("upload", "Removed essay-marks file", "Essay marks cleared from subject totals", cycleId);
    this.bump();
  }

  getEssayMarks(cycleId: string): EssayMarksModel | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const st = this.essayMarksByCycle.get(cycleId);
    const essayIds = new Set(this.essaySubjectIds());
    const subjects: EssaySubjectRef[] = this.seed.liveCycle.assessments
      .filter((a) => essayIds.has(a.id))
      .map((a) => ({
        assessmentId: a.id,
        // Only essay subjects reach here; the non-English one is Arabic (matches
        // whether the name is Latin "Arabic…" or Arabic script).
        code: /english/i.test(a.name) ? "ESL" : "AFL",
        name: a.name,
        count: st ? new Set(st.marks.filter((m) => m.assessmentId === a.id).map((m) => m.participantId)).size : 0,
      }));

    if (!st || !st.uploaded) {
      return { cycleId, uploaded: false, sample: false, fileName: null, subjects, students: [], matchedCount: 0, unmatchedIds: [], preview: { headers: [], rows: [] } };
    }

    const labelOf = (id: string) => this.seed.liveCycle.participants.find((p) => p.id === id)?.label ?? id;
    const byStudent = new Map<string, EssayStudentMark>();
    for (const m of st.marks) {
      let s = byStudent.get(m.participantId);
      if (!s) {
        s = { participantId: m.participantId, name: labelOf(m.participantId), marks: {}, essayCounts: {} };
        byStudent.set(m.participantId, s);
      }
      s.marks[m.assessmentId] = round(m.mark, 1);
      s.essayCounts[m.assessmentId] = st.essayCounts.get(`${m.participantId}|${m.assessmentId}`) ?? 1;
    }
    const students = [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name));
    const preview = {
      headers: ["Student", ...subjects.map((s) => `${s.name} /20`)],
      rows: students.slice(0, 6).map((s) => [s.name, ...subjects.map((sr) => s.marks[sr.assessmentId] ?? "—")] as (string | number | null)[]),
    };
    return {
      cycleId,
      uploaded: true,
      sample: st.sample,
      fileName: st.fileName,
      subjects,
      students,
      matchedCount: new Set(st.marks.map((m) => m.participantId)).size,
      unmatchedIds: st.unmatchedIds,
      preview,
    };
  }

  // ── incident log → alterations triage (Part 3) ────────────────────────────
  /** The subject (assessment) an exam code maps to. Unknown codes return undefined. */
  private subjectForExamCode(code: string | null | undefined): SeedAssessment | undefined {
    const c = (code ?? "").trim();
    if (!c) return undefined;
    const A = this.seed.liveCycle.assessments;
    const map: [RegExp, RegExp][] = [
      [/\bAM\b|applicable|math/i, /applicable math/i],
      [/\bST\b|scientific|science/i, /scientific/i],
      [/\bAFL\b|arabic/i, /arabic/i],
      [/\bESL\b|english/i, /english/i],
      [/\bLSS\b|life/i, /life/i],
    ];
    for (const [codeRe, nameRe] of map) if (codeRe.test(c)) return A.find((a) => nameRe.test(a.name));
    return undefined;
  }
  /** Non-binding roster suggestion from a free-text name (never auto-applied). */
  private suggestStudentId(name: string): string | null {
    const n = name.trim().toLowerCase();
    if (!n || /\ball\b/.test(n)) return null; // "All students" → no single suggestion
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    const target = new Set(norm(n));
    let best: { id: string; score: number } | null = null;
    for (const p of this.seed.liveCycle.participants) {
      const toks = norm(p.label);
      if (toks.length === 0) continue;
      if (p.label.toLowerCase() === n || p.id.toLowerCase() === n) return p.id;
      const overlap = toks.filter((t) => target.has(t)).length;
      const score = overlap / Math.max(toks.length, target.size);
      if (score > 0.5 && (!best || score > best.score)) best = { id: p.id, score };
    }
    return best?.id ?? null;
  }

  private rebuildAlterations(cycleId: string): void {
    const st = this.incidentLogByCycle.get(cycleId);
    const out: Alteration[] = [];
    if (st) {
      for (const inc of st.incidents) {
        if (!inc.subjectId || !inc.marks) continue;
        if (inc.applyTo === "student" && inc.studentId) {
          out.push({ participantId: inc.studentId, assessmentId: inc.subjectId, marks: inc.marks });
        } else if (inc.applyTo === "subject") {
          // bulk: every roster student in that subject
          for (const p of this.seed.liveCycle.participants) {
            out.push({ participantId: p.id, assessmentId: inc.subjectId, marks: inc.marks });
          }
        }
      }
    }
    this.alterationsByCycle.set(cycleId, out);
  }

  uploadIncidentLog(cycleId: string, fileName: string, rows: IncidentInput[]): void {
    if (this.locked.has(cycleId)) return;
    const incidents = rows.map((r) => this.buildTriageIncident(r));
    this.incidentLogByCycle.set(cycleId, { uploaded: true, sample: false, fileName, incidents });
    this.rebuildAlterations(cycleId);
    this.audit("upload", "Added incident log", `${fileName} — ${incidents.length} incident(s) queued for triage`, cycleId);
    this.bump();
  }

  private buildTriageIncident(r: IncidentInput): AdjustmentIncident {
    this.adjIncidentSeq += 1;
    const subj = this.subjectForExamCode(r.exam);
    return {
      id: `inc-${this.adjIncidentSeq}`,
      source: r.source,
      studentName: r.studentName ?? "",
      exam: r.exam ?? null,
      issueType: r.issueType ?? null,
      actionTaken: r.actionTaken ?? null,
      questionsAffected: r.questionsAffected ?? null,
      staff: r.staff ?? null,
      email: r.email ?? null,
      school: r.school ?? null,
      description: r.description ?? null,
      suggestedStudentId: this.suggestStudentId(r.studentName ?? ""),
      suggestedSubjectId: subj?.id ?? null,
      applyTo: null,
      studentId: null,
      subjectId: subj?.id ?? null, // default the subject; reviewer can override
      marks: 0,
      reason: null,
      decidedBy: null,
      decidedAt: null,
    };
  }

  /**
   * Load a small, clearly-labelled SAMPLE incident log. Names reference real
   * roster labels (so suggestions resolve) and one row is an "All students"
   * subject-wide case; flagged `sample: true` everywhere it surfaces. Nothing is
   * auto-applied — every row still needs a human decision.
   */
  loadSampleIncidentLog(cycleId: string): void {
    if (cycleId !== this.seed.liveCycle.id || this.locked.has(cycleId)) return;
    const label = (i: number) => this.seed.liveCycle.participants[i]?.label ?? `Student ${i}`;
    const rows: IncidentInput[] = [
      { source: "incident_log", studentName: label(0), exam: "AM", issueType: "Calculator tool froze", actionTaken: "Allowed 4 extra minutes", questionsAffected: "Q12", staff: "R. Mansour" },
      { source: "incident_log", studentName: label(3), exam: "ESL", issueType: "Audio clip would not play", actionTaken: "Replayed on staff device", questionsAffected: "n/a", staff: "T. Haddad" },
      { source: "incident_log", studentName: "All students", exam: "ST", issueType: "Projector flicker for 2 minutes", actionTaken: "Paused the room", questionsAffected: "n/a", staff: "Invigilation team" },
      { source: "incident_log", studentName: label(8), exam: "AFL", issueType: "النص لم يظهر بشكل صحيح", actionTaken: "Reloaded the item", questionsAffected: "Q5, Q6", staff: "S. Khoury" },
      { source: "complaint", studentName: label(5), email: "student5@example.org", school: "Alsama Shatila 1", description: "Felt the maths paper started late and was rushed at the end." },
    ];
    const incidents = rows.map((r) => this.buildTriageIncident(r));
    this.incidentLogByCycle.set(cycleId, { uploaded: true, sample: true, fileName: "sample_incident_log.xlsx", incidents });
    this.rebuildAlterations(cycleId);
    this.audit("upload", "Loaded sample incident log", `${incidents.length} labelled sample incidents (not from a real file)`, cycleId);
    this.bump();
  }

  clearIncidentLog(cycleId: string): void {
    if (this.locked.has(cycleId)) return;
    if (!this.incidentLogByCycle.has(cycleId)) return;
    this.incidentLogByCycle.delete(cycleId);
    this.rebuildAlterations(cycleId);
    this.audit("upload", "Removed incident log", "Alterations cleared from subject totals", cycleId);
    this.bump();
  }

  decideIncident(cycleId: string, incidentId: string, decision: IncidentDecisionInput): void {
    if (this.locked.has(cycleId)) return;
    const st = this.incidentLogByCycle.get(cycleId);
    const inc = st?.incidents.find((i) => i.id === incidentId);
    if (!inc) return;
    inc.applyTo = decision.applyTo;
    inc.studentId = decision.applyTo === "student" ? decision.studentId ?? null : null;
    inc.subjectId = decision.subjectId ?? inc.subjectId;
    inc.marks = decision.applyTo === "none" ? 0 : Math.trunc(decision.marks ?? 0);
    inc.reason = decision.reason ?? null;
    inc.decidedBy = this.user.name;
    inc.decidedAt = new Date().toISOString();
    this.rebuildAlterations(cycleId);

    // Audit (who, when, which student/subject, marks, reason, source incident).
    const subjName = inc.subjectId ? this.assessment(inc.subjectId)?.name ?? inc.subjectId : "—";
    if (decision.applyTo === "none") {
      this.audit("student", "Incident — no action", `${inc.studentName || "incident"} (${inc.source}) marked informational`, cycleId);
    } else if (decision.applyTo === "subject") {
      const n = this.seed.liveCycle.participants.length;
      this.audit("student", "Alteration (whole subject)", `${subjName}: ${inc.marks >= 0 ? "+" : ""}${inc.marks} for all ${n} students — ${inc.reason ?? "no reason"} (source: ${inc.studentName || inc.source})`, cycleId);
    } else {
      const who = inc.studentId ? this.seed.liveCycle.participants.find((p) => p.id === inc.studentId)?.label ?? inc.studentId : inc.studentName;
      this.audit("student", "Alteration (one student)", `${who} · ${subjName}: ${inc.marks >= 0 ? "+" : ""}${inc.marks} — ${inc.reason ?? "no reason"} (source: ${inc.source})`, cycleId);
    }
    this.bump();
  }

  getAdjustments(cycleId: string): AdjustmentsModel | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const st = this.incidentLogByCycle.get(cycleId);
    const incidents = st?.incidents ?? [];
    const roster = this.seed.liveCycle.participants.map((p) => ({ id: p.id, name: p.label }));
    const subjects = this.seed.liveCycle.assessments.map((a) => ({
      id: a.id,
      name: a.name,
      code: /applicable math/i.test(a.name) ? "AM" : /scientific/i.test(a.name) ? "ST" : /arabic/i.test(a.name) ? "AFL" : /english/i.test(a.name) ? "ESL" : /life/i.test(a.name) ? "LSS" : null,
    }));
    const decided = incidents.filter((i) => i.applyTo != null).length;
    const alterations = this.alterationsFor(cycleId).length;
    const netBySubject: Record<string, number> = {};
    for (const alt of this.alterationsFor(cycleId)) netBySubject[alt.assessmentId] = (netBySubject[alt.assessmentId] ?? 0) + alt.marks;
    return {
      cycleId,
      uploaded: !!st?.uploaded,
      sample: !!st?.sample,
      fileName: st?.fileName ?? null,
      incidents,
      roster,
      subjects,
      counts: { incidents: incidents.length, decided, awaiting: incidents.length - decided, alterations },
      netBySubject,
    };
  }

  /**
   * Usable (post-exclusion) responses + item metadata across every subject —
   * the same item set scoring uses (cohort-excluded items dropped). Feeds the
   * additive Cronbach's-α reliability output.
   */
  private usableResponsesAndItems(cycleId: string): { responses: ResponseRecord[]; items: ItemMeta[] } {
    const responses: ResponseRecord[] = [];
    const items: ItemMeta[] = [];
    for (const a of this.seed.liveCycle.assessments) {
      const excluded = this.excludedSet(cycleId, a.id);
      for (const r of a.responses) {
        if (excluded.has(r.i)) continue;
        responses.push({ participantId: r.p, itemId: r.i, assessmentId: a.id, score: r.s });
      }
      for (const it of a.items) {
        if (excluded.has(it.id)) continue;
        items.push({
          itemId: it.id,
          assessmentId: a.id,
          majorElement: it.major,
          subElement: it.sub,
          demandLevel: it.demand,
          maxScore: it.maxScore,
        });
      }
    }
    return { responses, items };
  }

  /** Cronbach's-α reliability for the cycle, at every construct grouping (read-only). */
  getReliability(cycleId: string): ReliabilityModel | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const { responses, items } = this.usableResponsesAndItems(cycleId);
    const result = engine.computeReliability({ responses, items });
    const nameById = new Map(this.seed.liveCycle.assessments.map((a) => [a.id, a.name]));

    const rows: ReliabilityRow[] = result.groups.map((g) => ({
      level: g.level,
      assessmentId: g.assessmentId,
      assessmentName: g.assessmentId ? nameById.get(g.assessmentId) ?? g.assessmentId : null,
      key: g.key,
      // the subject group's raw label is the assessment id; show the real name.
      label: g.level === "subject" && g.assessmentId ? nameById.get(g.assessmentId) ?? g.label : g.label,
      k: g.k,
      n: g.n,
      alpha: g.alpha,
      note: g.note,
      lowItems: g.lowItems,
      smallSample: g.smallSample,
    }));
    const overall = rows.find((r) => r.level === "overall")!;
    return {
      cycleId,
      engineVersion: result.engineVersion,
      participants: this.seed.liveCycle.participants.length,
      lowItemsThreshold: LOW_ITEMS_THRESHOLD,
      smallSampleThreshold: SMALL_SAMPLE_THRESHOLD,
      overall,
      rows,
    };
  }

  /**
   * Engine primitives for the overall-score-analysis export. Reuses the same
   * responses/items/exclusions the score engine reads — assembly + workbook
   * building happen in the page (so xlsx-js-style stays out of the main bundle).
   */
  getScoreAnalysisData(cycleId: string, preExclusion = false): AssembleScoreAnalysisArgs | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const responses: ResponseRecord[] = [];
    const items: ItemMeta[] = [];
    const excludedItemIds: string[] = [];
    for (const a of this.seed.liveCycle.assessments) {
      responses.push(...this.responsesOf(a));
      items.push(...this.itemMetasFor(a));
      if (!preExclusion) {
        const excluded = this.excludedSet(cycleId, a.id);
        for (const it of a.items) if (excluded.has(it.id)) excludedItemIds.push(it.id);
      }
    }
    return {
      assessments: this.seed.liveCycle.assessments.map((a) => ({ id: a.id, name: a.name })),
      participants: this.seed.liveCycle.participants.map((p) => ({ id: p.id, label: p.label })),
      responses,
      items,
      excludedItemIds,
      scoreRunNote: preExclusion
        ? "Naive (pre-exclusion) overall scores — computed before item review; no items excluded."
        : "Overall scores after item-review exclusions.",
    };
  }

  /** Engine primitives for the item-analysis export (full ItemStat per item). */
  getItemAnalysisData(cycleId: string): AssembleItemAnalysisArgs | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const stats: ItemStat[] = [];
    const facts: ItemResponseFact[] = [];
    const reviews: Record<string, ItemReviewDecision> = {};
    for (const a of this.seed.liveCycle.assessments) {
      stats.push(...engine.computeItemStats({ responses: this.responsesOf(a), scoringConfig: this.scoringConfig() }));
      const excluded = this.excludedSet(cycleId, a.id);
      for (const r of a.responses) facts.push({ assessmentId: a.id, itemId: r.i, participantId: r.p, answered: true, responseTime: null });
      for (const it of a.items) {
        if (excluded.has(it.id)) reviews[it.id] = { exclude: true, reason: this.reasons.get(`${cycleId}:${a.id}:${it.id}`) ?? null };
      }
    }
    return {
      cycleName: this.getCycle(cycleId)?.name ?? "Cycle",
      assessments: this.seed.liveCycle.assessments.map((a) => ({ id: a.id, name: a.name })),
      stats,
      facts,
      reviews,
    };
  }

  getDiagnostics(cycleId: string): DiagnosticsModel | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const shortOf = new Map(this.seed.liveCycle.assessments.map((a) => [a.id, a.shortName]));
    return {
      cycleId,
      assessments: (this.seed.liveCycle.diagnostics ?? []).map((d) => ({
        assessmentId: d.assessmentId,
        assessmentName: d.assessmentName,
        shortName: shortOf.get(d.assessmentId) ?? d.assessmentName,
        groups: d.groups,
      })),
    };
  }

  getComposition(cycleId: string): CompositionModel | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const essayIds = new Set(this.essaySubjectIds());
    const subjects = this.seed.liveCycle.assessments.map((a) => ({ id: a.id, name: a.name, shortName: a.shortName, hasEssay: essayIds.has(a.id) }));
    const labelOf = (id: string) => this.seed.liveCycle.participants.find((p) => p.id === id)?.label ?? id;

    // participant -> assessment -> ParticipantScore
    const byP = new Map<string, SubjectComposition[]>();
    for (const a of this.seed.liveCycle.assessments) {
      // Per-demand rollup over the SAME retained MCQ items the engine scores
      // (cohort-excluded items dropped). Fixed demand levels D1/D2/D3, only those
      // present as items. Additive reporting — no change to scoring.
      const excluded = this.excludedSet(cycleId, a.id);
      const demandLevels = ["D1", "D2", "D3"] as const;
      const demandItems = new Map<string, { ids: Set<string>; max: number }>();
      for (const it of a.items) {
        if ((it.maxScore ?? 1) < 1 || excluded.has(it.id)) continue;
        if (it.demand !== "D1" && it.demand !== "D2" && it.demand !== "D3") continue;
        let g = demandItems.get(it.demand);
        if (!g) demandItems.set(it.demand, (g = { ids: new Set(), max: 0 }));
        g.ids.add(it.id);
        g.max += it.maxScore ?? 1;
      }
      const scoreByPI = new Map<string, number>(); // `${pid}␟${itemId}` -> score
      for (const r of a.responses) scoreByPI.set(`${r.p}␟${r.i}`, r.s);

      for (const [pid, s] of this.pctByParticipant(cycleId, a)) {
        const byDemand: DemandScore[] = demandLevels
          .filter((d) => demandItems.has(d))
          .map((d) => {
            const g = demandItems.get(d)!;
            let score = 0;
            for (const id of g.ids) score += scoreByPI.get(`${pid}␟${id}`) ?? 0;
            return { demand: d, score: round(score, 2), max: g.max };
          });
        const list = byP.get(pid) ?? [];
        list.push({
          assessmentId: a.id,
          name: a.name,
          hasEssay: essayIds.has(a.id),
          mcq: s.mcq,
          essay: s.essay,
          alterations: s.alterations,
          total: s.raw,
          max: s.max,
          pct: s.pct,
          byDemand,
        });
        byP.set(pid, list);
      }
    }

    const students: StudentComposition[] = [...byP.entries()].map(([pid, subs]) => {
      const total = subs.reduce((t, s) => t + s.total, 0);
      const max = subs.reduce((t, s) => t + s.max, 0);
      return {
        participantId: pid,
        name: labelOf(pid),
        subjects: subs,
        overall: { total: round(total, 2), max, pct: max ? round((total / max) * 100, 1) : 0 },
      };
    });
    students.sort((a, b) => b.overall.pct - a.overall.pct);
    return { cycleId, subjects, students };
  }

  setIncidentDecision(cycleId: string, incidentId: string, decision: IncidentDecision, reason?: string | null): void {
    if (this.locked.has(cycleId)) return;
    const te = this.technicalErrors.get(cycleId);
    const inc = te?.incidents.find((i) => i.id === incidentId);
    if (!te || !inc) return;
    inc.decision = decision;
    inc.reason = decision === "excluded" ? reason ?? "Confirmed technical fault" : null;
    inc.by = decision ? this.user.name : null;
    inc.at = decision ? new Date().toISOString() : null;
    if (decision === "excluded") {
      this.audit("student", "Excluded question for one student", `${inc.studentName} · ${inc.questionLabel} (${inc.assessmentName}) — ${inc.reason}`, cycleId);
    } else if (decision === "kept") {
      this.audit("student", "Kept question for one student", `${inc.studentName} · ${inc.questionLabel} (${inc.assessmentName}) — scored normally`, cycleId);
    }
    this.bump();
  }

  // ── distinction safeguard (grading stage) ─────────────────────────────────
  /**
   * D3 status for one student on one assessment: the count of **available** D3
   * items (top-difficulty, after cohort item exclusions) and how many the student
   * answered **correctly** (score > 0). This is the corrected metric — correct,
   * not attempted; available, not attempted.
   */
  private d3StatusFor(
    cycleId: string,
    a: SeedAssessment,
    studentId: string,
    demand: string,
  ): { correct: number; available: number; majority: number } {
    const excluded = this.excludedSet(cycleId, a.id);
    const pool = new Set(a.items.filter((it) => it.demand === demand && !excluded.has(it.id)).map((it) => it.id));
    let correct = 0;
    for (const r of a.responses) {
      if (r.p !== studentId || !pool.has(r.i)) continue;
      if (r.s > 0) correct += 1;
    }
    return { correct, available: pool.size, majority: d3MajorityThreshold(pool.size) };
  }

  /**
   * Per-student D3-majority cap (Layer 1b). A student passes only if they cleared
   * the majority of available D3 items on **every** exam that carries D3 items;
   * a single exam below its majority caps them below Distinction. Surfaces the
   * per-exam working and the first failing exam so the cap is explainable.
   */
  private d3CapByParticipant(cycleId: string): Map<string, D3CapStatus> {
    const demand = this.resolveTopDifficulty();
    const out = new Map<string, D3CapStatus>();
    for (const p of this.seed.liveCycle.participants) {
      const exams: D3ExamStatus[] = [];
      for (const a of this.seed.liveCycle.assessments) {
        const { correct, available, majority } = this.d3StatusFor(cycleId, a, p.id, demand);
        if (available <= 0) continue; // no D3 items on this exam — cannot deny anyone
        exams.push({
          assessmentId: a.id,
          name: a.name,
          shortName: a.shortName,
          correct,
          available,
          majority,
          pass: passesD3Majority(correct, available),
        });
      }
      const failing = exams.find((e) => !e.pass) ?? null;
      out.set(p.id, { pass: !failing, exams, failing });
    }
    return out;
  }

  /** Per-participant subject performance levels, in assessment order (Layer 1). */
  private subjectLevelsByParticipant(cycleId: string): Map<string, string[]> {
    const perfLevels = this.grading.performanceLevels;
    const ids = this.seed.liveCycle.participants.map((p) => p.id);
    const out = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const a of this.seed.liveCycle.assessments) {
      const cuts = this.boundaryState(cycleId, a.id).cuts;
      const pct = this.pctByParticipant(cycleId, a);
      for (const id of ids) {
        const v = pct.get(id);
        out.get(id)!.push(v === undefined ? "" : classify(v.pct, perfLevels, cuts));
      }
    }
    return out;
  }

  /**
   * Participants whose **level pattern** qualifies for Distinction (★★★ in ≥3 AND
   * ≥★ Meets in the rest) — i.e. "in line for Distinction", before the D3 cap.
   * The award no longer comes from a cut on an overall score (the old placeholder);
   * it is the deterministic Layer-2 lookup, so candidacy is a level-pattern test.
   */
  private provisionalDistinctionIds(cycleId: string): string[] {
    const perfLevels = this.grading.performanceLevels;
    const levelsByP = this.subjectLevelsByParticipant(cycleId);
    const ids: string[] = [];
    for (const p of this.seed.liveCycle.participants) {
      const levels = levelsByP.get(p.id) ?? [];
      if (qualifiesForDistinctionByLevels(levels, perfLevels)) ids.push(p.id);
    }
    return ids;
  }
  /** studentId → safeguard result, for the grade-matrix cap (used by getGrades). */
  private distinctionDecisions(cycleId: string): Map<string, SafeguardResult> {
    const overrides = this.distinctionOverrides.get(cycleId);
    const d3 = this.d3CapByParticipant(cycleId);
    const out = new Map<string, SafeguardResult>();
    for (const sid of this.provisionalDistinctionIds(cycleId)) {
      if (overrides?.has(sid)) {
        out.set(sid, "override");
        continue;
      }
      out.set(sid, d3.get(sid)?.pass === false ? "capped" : "pass");
    }
    return out;
  }

  getDistinctionSafeguard(cycleId: string, scope?: string): DistinctionSafeguardModel | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const assessments = this.seed.liveCycle.assessments;
    const scopes = assessments.map((a) => ({ id: a.id, label: a.shortName }));
    const scopeId = scope && assessments.some((a) => a.id === scope) ? scope : assessments[0]?.id ?? "";
    const a = this.assessment(scopeId);
    const demand = this.resolveTopDifficulty();
    // Pool = available D3 items on the selected exam (after item exclusions); the
    // threshold is the DYNAMIC majority of that pool (e.g. 7 → 4), not a fixed N.
    const pool = a ? a.items.filter((it) => it.demand === demand && !this.excludedSet(cycleId, a.id).has(it.id)).length : 0;
    const majority = d3MajorityThreshold(pool);
    const awardLevels = this.grading.awardLevels;
    const topAward = awardLevels[0] ?? "";
    const cappedTo = awardLevels[1] ?? topAward;

    const decisions = this.distinctionDecisions(cycleId);
    const overrides = this.distinctionOverrides.get(cycleId);
    const inLineIds = this.provisionalDistinctionIds(cycleId);
    const d3Cap = this.d3CapByParticipant(cycleId);
    const labelOf = new Map(this.seed.liveCycle.participants.map((p) => [p.id, p.label] as const));

    const candidates: DistinctionCandidate[] = inLineIds.map((sid) => {
      const scopeStatus = a ? this.d3StatusFor(cycleId, a, sid, demand) : { correct: 0, available: 0, majority: 0 };
      const result = decisions.get(sid) ?? "pass";
      const failing = d3Cap.get(sid)?.failing ?? null;
      const ov = overrides?.get(sid);
      const capReason =
        result === "capped" && failing
          ? `Capped below ${topAward} — ${failing.correct}/${failing.available} D3 items correct in ${failing.shortName}; majority is ${failing.majority}`
          : null;
      return {
        id: sid,
        name: labelOf.get(sid) ?? sid,
        topDifficultyCorrect: scopeStatus.correct,
        topDifficultyAvailable: scopeStatus.available,
        majority: scopeStatus.majority,
        meets: passesD3Majority(scopeStatus.correct, scopeStatus.available),
        provisionalAward: topAward,
        cappedAward: cappedTo,
        result,
        capReason,
        overrideReason: ov?.reason ?? null,
        overrideBy: ov?.by ?? null,
      };
    });
    // Closest to the line first: lowest margin of (correct − majority) on the scope.
    candidates.sort(
      (x, y) => (x.topDifficultyCorrect - x.majority) - (y.topDifficultyCorrect - y.majority),
    );

    const vals = [...decisions.values()];
    return {
      cycleId,
      threshold: majority,
      topDifficultyDemand: demand,
      topDifficultyPool: pool,
      scope: scopeId,
      scopes,
      topAward,
      cappedTo,
      candidates,
      counts: {
        inLine: inLineIds.length,
        meet: vals.filter((v) => v === "pass").length,
        capped: vals.filter((v) => v === "capped").length,
        overridden: vals.filter((v) => v === "override").length,
      },
      canOverride: this.user.role === "lead_admin",
      attemptedNote:
        "Eligibility uses D3 items answered CORRECTLY against the MAJORITY of D3 items AVAILABLE on each exam (dynamic per exam; recomputed after exclusions) — not attempts, and not a fixed count.",
    };
  }

  confirmDistinctionCaps(cycleId: string): void {
    if (this.locked.has(cycleId)) return;
    const capped = [...this.distinctionDecisions(cycleId).values()].filter((v) => v === "capped").length;
    this.distinctionConfirmed.add(cycleId);
    this.audit(
      "safeguard",
      "Confirmed Distinction safeguard",
      capped ? `${capped} award(s) capped to ${this.grading.awardLevels[1] ?? "the next award"}` : "No caps — every candidate met the rule",
      cycleId,
    );
    this.bump();
  }

  overrideDistinctionCap(cycleId: string, studentId: string, reason: string): void {
    if (this.user.role !== "lead_admin" || this.locked.has(cycleId)) return;
    const clean = reason.trim();
    if (!clean) return;
    const m = this.distinctionOverrides.get(cycleId) ?? new Map<string, { reason: string; by: string }>();
    m.set(studentId, { reason: clean, by: this.user.name });
    this.distinctionOverrides.set(cycleId, m);
    const label = this.seed.liveCycle.participants.find((p) => p.id === studentId)?.label ?? studentId;
    this.audit("safeguard", "Overrode Distinction cap", `${label} kept at ${this.grading.awardLevels[0] ?? "Distinction"} — ${clean}`, cycleId);
    this.bump();
  }

  undoDistinctionOverride(cycleId: string, studentId: string): void {
    if (this.user.role !== "lead_admin" || this.locked.has(cycleId)) return;
    const m = this.distinctionOverrides.get(cycleId);
    if (m?.delete(studentId)) {
      const label = this.seed.liveCycle.participants.find((p) => p.id === studentId)?.label ?? studentId;
      this.audit("safeguard", "Removed Distinction override", `${label} returned to its safeguard result`, cycleId);
      this.bump();
    }
  }

  setSafeguardConfig(patch: { distinctionThreshold?: number; topDifficultyDemand?: string }): void {
    if (this.user.role !== "lead_admin") return;
    if (patch.distinctionThreshold != null && Number.isFinite(patch.distinctionThreshold)) {
      this.safeguard.distinctionThreshold = Math.max(1, Math.round(patch.distinctionThreshold));
    }
    if (patch.topDifficultyDemand != null) {
      this.safeguard.topDifficultyDemand = patch.topDifficultyDemand;
    }
    this.audit("safeguard", "Updated Distinction safeguard", `Threshold ${this.safeguard.distinctionThreshold} · top-difficulty ${this.resolveTopDifficulty()}`, null);
    this.bump();
  }

  // ── document generation (Student Summary) ────────────────────────────────
  getDocuments(cycleId: string): DocumentsModel | null {
    if (cycleId !== this.seed.liveCycle.id) return null;
    const locked = this.locked.has(cycleId);

    // Canonical template slots S1..S5 mapped to suite assessments by alias
    // (keyword), NOT by position — the template order differs from the suite's.
    const refs = this.assessmentRefs(cycleId);
    const resolve = (re: RegExp) => refs.find((a) => re.test(a.id) || re.test(a.name));
    const slotDefs: { slot: string; re: RegExp }[] = [
      { slot: "S1", re: /applicable math/i },
      { slot: "S2", re: /scientific/i },
      { slot: "S3", re: /arabic/i },
      { slot: "S4", re: /english/i },
      { slot: "S5", re: /life/i },
    ];
    const subjectOrder = slotDefs.map((d) => ({
      slot: d.slot,
      assessment: resolve(d.re)?.name ?? d.slot,
    }));

    const settings = this.docSettings(cycleId);

    if (!locked) {
      return { cycleId, locked, students: [], settings, subjectOrder };
    }

    const grades = this.getGrades(cycleId)!;
    // Element/sub-element levels for the UNOFFICIAL diagnostic report (Part 4) —
    // a richer, internal/learner breakdown than the official certificate/report.
    const perf = this.getPerformanceReport(cycleId);
    const starOf = (lvl: string) => starsFor(lvl, this.grading.starMap);
    // DOWNSTREAM: the Student Summary carries each subject's performance `level`
    // + its report `stars`, and the overall `award`, as free strings. Stars come
    // from the configured level→stars map (ScoringConfig), so an added/removed
    // performance level needs a star mapping (already part of the config), and an
    // added/removed award needs the certificate/report template to handle that
    // award label. The next prompt (Settings CRUD + certificates) wires the
    // validation that every configured level has a star mapping and every award
    // has a template slot before generation.
    const students: StudentSummary[] = grades.rows.map((r) => {
      const perfStudent = perf?.students.find((s) => s.participantId === r.id);
      const unofficial: UnofficialSubject[] = slotDefs.map((d) => {
        const ref = resolve(d.re);
        const cell = ref ? r.grades[ref.id] : undefined;
        const subjectMeta = ref ? perf?.subjects.find((s) => s.assessmentId === ref.id) : undefined;
        const result = ref ? perfStudent?.subjects[ref.id] : undefined;
        const elements: UnofficialElement[] = (subjectMeta?.majorElements ?? []).map((major) => ({
          major,
          level: result?.elements[major] ?? "",
          stars: starOf(result?.elements[major] ?? ""),
          subs: (subjectMeta?.subElements[major] ?? []).map((sub) => ({
            sub,
            level: result?.subElements[major]?.[sub] ?? "",
            stars: starOf(result?.subElements[major]?.[sub] ?? ""),
          })),
        }));
        return {
          slot: d.slot,
          assessment: ref?.name ?? d.slot,
          level: cell?.level ?? "",
          stars: cell?.stars ?? "",
          elements,
        };
      });
      return {
        participantId: r.id,
        name: r.label,
        award: r.award,
        subjects: slotDefs.map((d) => {
          const ref = resolve(d.re);
          const cell = ref ? r.grades[ref.id] : undefined;
          return {
            slot: d.slot,
            assessment: ref?.name ?? d.slot,
            level: cell?.level ?? "",
            stars: cell?.stars ?? "",
          };
        }),
        unofficial,
      };
    });

    return { cycleId, locked, students, settings, subjectOrder };
  }

  private docSettings(cycleId: string): DocSettings {
    const existing = this.docSettingsByCycle.get(cycleId);
    if (existing) return existing;
    void cycleId;
    // Defaults: cycle name + the template's sample test centre; dates from the
    // cycle. These are per-cycle settings, editable in the UI.
    return {
      cycleName: this.seed.liveCycle.name,
      testCentre: "Alsama Shatila 1",
      examDate: "11 May 2026",
      issueDate: "10 June 2026",
    };
  }

  setDocumentSettings(cycleId: string, patch: Partial<DocSettings>): void {
    this.docSettingsByCycle.set(cycleId, { ...this.docSettings(cycleId), ...patch });
    this.bump();
  }

  getGradingDefaults(): GradingDefaultsModel {
    return {
      performanceLevels: this.grading.performanceLevels,
      starMap: this.grading.starMap,
      awardLevels: this.grading.awardLevels,
      performanceCuts: this.grading.performanceCuts,
      awardCuts: this.grading.awardCuts,
      // The award is now the confirmed Layer-2 level-combination rule + D3 cap
      // (lib/engine/award.ts), not the old overall-score-cut placeholder.
      awardRuleUnconfirmed: false,
    };
  }

  // ── writes ────────────────────────────────────────────────────────────────
  setItemExcluded(
    cycleId: string,
    assessmentId: string,
    itemId: string,
    excluded: boolean,
    reason?: string | null,
  ): void {
    if (this.locked.has(cycleId)) return;
    const key = `${cycleId}:${assessmentId}`;
    const set = this.exclusions.get(key) ?? new Set<string>();
    if (excluded) {
      set.add(itemId);
      if (reason != null) this.reasons.set(`${key}:${itemId}`, reason);
      const a = this.assessment(assessmentId);
      this.audit("exclude", "Excluded item", `${a?.name ?? assessmentId} — reason: ${reason ?? "flagged in review"}`, cycleId);
    } else {
      set.delete(itemId);
      this.reasons.delete(`${key}:${itemId}`);
      const a = this.assessment(assessmentId);
      this.audit("exclude", "Restored item", `${a?.name ?? assessmentId} — item returned to scoring`, cycleId);
    }
    this.exclusions.set(key, set);
    this.bump();
  }

  setBoundary(cycleId: string, scope: string, input: SetBoundaryInput): void {
    if (this.locked.has(cycleId)) return;
    const key = `${cycleId}:${scope}`;
    const cur = this.boundaryState(cycleId, scope);
    const isAward = scope === "overall";
    const scopeName = isAward ? "Overall award" : this.assessment(scope)?.name ?? scope;

    let cuts = input.cuts ? [...input.cuts] : [...cur.cuts];
    const targets = input.targets ? [...input.targets] : [...cur.targets];
    if (input.targetIndex != null && input.targetValue != null) targets[input.targetIndex] = input.targetValue;

    // Drag a handle in "Set distribution" mode: translate the dragged score-axis
    // position into the implied target share for that band, then let the read
    // model re-solve via the existing Wave 3b backsolver so the handle settles at
    // the nearest achievable cut. The cohort share at-or-above the dragged score
    // equals the combined share of every band above this cut, so this band's
    // target is that cumulative share minus the bands above it. Same underlying
    // value as the table's % column — drag and type stay in two-way sync.
    if (input.dragTargetIndex != null && input.dragScoreValue != null) {
      const idx = input.dragTargetIndex;
      if (idx >= 0 && idx < targets.length) {
        const pcts = this.scopePcts(cycleId, scope);
        const n = pcts.length;
        if (n > 0) {
          const v = Math.max(0, Math.min(100, Math.round(input.dragScoreValue)));
          const atOrAbove = pcts.reduce((c, p) => c + (Math.round(p) >= v ? 1 : 0), 0);
          const cumPct = (atOrAbove / n) * 100;
          const precedeSum = targets.slice(0, idx).reduce((a, b) => a + (Number(b) || 0), 0);
          const otherSum = targets.reduce((a, b, j) => (j === idx ? a : a + (Number(b) || 0)), 0);
          // Clamp so the band stays non-negative and the lowest band (remainder)
          // never goes below zero.
          targets[idx] = Math.max(0, Math.min(100 - otherSum, Math.round(cumPct - precedeSum)));
        }
      }
    }

    let mode: BoundaryMode = input.mode ?? cur.mode;
    let suggested = cur.suggested ? [...cur.suggested] : undefined;
    let waived = cur.waived ? [...cur.waived] : undefined;

    // ── re-suggest: backsolve cuts from the current targets, adopt them as the
    //    editable starting point + snapshot, and switch to editable "cuts" mode.
    if (input.suggest) {
      const bounds = isAward ? { floorPct: 0, ceilingPct: 100 } : POLICY_GUARDRAILS;
      const solved = backsolveCuts(this.scopePcts(cycleId, scope), targets, bounds);
      cuts = [...solved.cuts];
      suggested = [...solved.cuts];
      waived = new Array(cuts.length).fill(false);
      mode = "cuts";
      this.audit("boundary", "Suggested boundaries", `${scopeName} — backsolved cuts from target distribution`, cycleId);
    }

    // ── reset to the stored suggestion (all cuts, or a single one).
    if (input.resetToSuggestion && suggested) {
      cuts = [...suggested];
      if (waived) waived = new Array(cuts.length).fill(false);
      this.audit("boundary", "Reset to suggestion", `${scopeName} — all cuts reset to the suggested values`, cycleId);
    }
    if (input.resetCutIndex != null && suggested && suggested[input.resetCutIndex] != null) {
      cuts[input.resetCutIndex] = suggested[input.resetCutIndex]!;
      if (waived) waived[input.resetCutIndex] = false;
    }

    // ── single-cut edit (drag / type).
    if (input.cutIndex != null && input.cutValue != null) cuts[input.cutIndex] = input.cutValue;

    // Keep cut-points strictly descending (cuts[0] highest) within [1, 99].
    // NOTE: this is the STRUCTURAL ordering guard, not the policy 25%/90%
    // guard-rail. The policy bounds are surfaced (and clampable) in the read
    // model; a user may deliberately WAIVE them (waiveGuardrail) and keep a value
    // outside [25, 90] — that is recorded, not silently re-clamped here.
    for (let i = 0; i < cuts.length; i++) {
      const v = Math.max(0, Math.min(100, Math.round(cuts[i] ?? 0)));
      const hi = i > 0 ? (cuts[i - 1] ?? 100) - 1 : 99;
      const lo = i < cuts.length - 1 ? (cuts[i + 1] ?? 0) + 1 : 1;
      cuts[i] = Math.max(lo, Math.min(hi, v));
    }

    // Record a deliberate guard-rail waiver (value knowingly outside policy bounds).
    if (input.waiveGuardrail && input.cutIndex != null) {
      waived = waived ?? new Array(cuts.length).fill(false);
      waived[input.cutIndex] = true;
      this.audit(
        "boundary",
        "Waived cut guard-rail",
        `${scopeName} — cut ${input.cutIndex + 1} kept at ${cuts[input.cutIndex]}% (outside policy bounds, waived)`,
        cycleId,
      );
    }

    // Audit only deliberate cut/target edits (not every drag tick): when a
    // single cut value is committed via the table input.
    if (input.cutIndex != null && input.cutValue != null && !input.waiveGuardrail) {
      this.audit("boundary", "Changed boundary", `${scopeName} — cut ${input.cutIndex + 1} set to ${cuts[input.cutIndex]}%`, cycleId);
    }

    this.boundaries.set(key, { mode, cuts, targets, suggested, waived });
    this.bump();
  }

  setGradingDefaults(patch: Partial<GradingConfig>): void {
    if (this.user.role !== "lead_admin") return;
    // When the level/award arrays are replaced, replace the star map wholesale
    // (rather than merging) so renamed/removed levels don't leave stale stars.
    const starMap = patch.starMap
      ? patch.performanceLevels
        ? { ...patch.starMap }
        : { ...this.grading.starMap, ...patch.starMap }
      : this.grading.starMap;
    this.grading = { ...this.grading, ...patch, starMap };
    // Drop any boundary state that no longer matches the new band count so it
    // re-derives from the updated defaults.
    const perfLen = this.grading.performanceLevels.length - 1;
    const awardLen = this.grading.awardLevels.length - 1;
    for (const [key, st] of [...this.boundaries.entries()]) {
      const isAward = key.endsWith(":overall");
      if (st.cuts.length !== (isAward ? awardLen : perfLen)) this.boundaries.delete(key);
    }
    this.audit(
      "config",
      "Updated grading defaults",
      `${this.grading.performanceLevels.length} performance levels · ${this.grading.awardLevels.length} award levels`,
      null,
    );
    this.bump();
  }

  setQualityThresholds(patch: Partial<QualityThresholds>): void {
    if (this.user.role !== "lead_admin") return;
    this.quality = {
      pValue: { ...this.quality.pValue, ...(patch.pValue ?? {}) },
      itemTotal: { ...this.quality.itemTotal, ...(patch.itemTotal ?? {}) },
      pointBiserial: { ...this.quality.pointBiserial, ...(patch.pointBiserial ?? {}) },
      discrimination: { ...this.quality.discrimination, ...(patch.discrimination ?? {}) },
    };
    this.audit("config", "Changed item-quality thresholds", "Engine Good/Review/Flag rating bands updated", null);
    this.bump();
  }

  /**
   * Ingest a combined raw export into the (single) live cycle: rebuild its
   * subjects/participants/items/responses from the cleaned responses by running
   * the real engine, exactly as the seed builder does. There is no database in
   * this build, so the rebuilt data lives in memory (and resets on reload); the
   * Supabase provider overrides this to persist + recompute server-side.
   */
  ingestRawExport(
    cycleId: string,
    file: { name: string; sizeMB: number },
    clean: CleanResponse[],
    report: ValidationReport,
    // The faithful 3-CSV canonical model is forwarded by the live provider to the
    // server persist path; the in-memory provider has no DB, so it only uses it
    // for the sitting tag in the audit line (the engine matrix is rebuilt from
    // `clean`, keeping parity untouched).
    extra?: { canonical?: CanonicalModel; files?: { items?: string; assessments?: string; topics?: string } },
  ): Promise<void> {
    const lc = this.seed.liveCycle;
    if (cycleId !== lc.id) return Promise.resolve();

    const built = buildLiveCycleData(clean);

    // Re-ingesting replaces the data set, so any prior per-item/per-scope
    // decisions for this cycle no longer apply — clear them so the rebuilt
    // (clean) subjects are served without stale exclusions/boundaries/locks.
    for (const key of [...this.exclusions.keys()]) if (key.startsWith(`${cycleId}:`)) this.exclusions.delete(key);
    for (const key of [...this.reasons.keys()]) if (key.startsWith(`${cycleId}:`)) this.reasons.delete(key);
    for (const key of [...this.boundaries.keys()]) if (key.startsWith(`${cycleId}:`)) this.boundaries.delete(key);
    this.locked.delete(cycleId);

    lc.fileName = file.name;
    lc.fileSizeMB = file.sizeMB;
    lc.uploadedAgo = "just now";
    lc.lastActivity = "just now";
    lc.validation = report;
    lc.preview = built.preview;
    lc.duplicates = report.checks.find((c) => c.id === "duplicates")?.count ?? 0;
    lc.participants = built.participants;
    lc.assessments = built.assessments;
    lc.diagnostics = built.diagnostics;
    lc.stageIndex = 1; // uploaded → next action is Clean

    const sittingNote = extra?.canonical?.sitting ? ` · ${extra.canonical.sitting.label} sitting` : "";
    this.audit(
      "upload",
      "Ingested raw export",
      `${built.assessments.length} subjects · ${built.participants.length} participants · ${file.name}${sittingNote}`,
      cycleId,
    );
    this.bump();
    return Promise.resolve();
  }

  // Destructive sitting controls (0007). The demo has a single seeded live
  // cycle with no database, so — like createCycle / resolveDuplicates — these
  // record the audited intent and resolve; the real cycle-scoped delete runs in
  // the Supabase provider via the SECURITY DEFINER RPCs. Kept async to match the
  // interface (and the live provider, which awaits the DB).
  clearSittingData(cycleId: string): Promise<void> {
    this.audit("upload", "Cleared sitting data", "Emptied ingested data — sitting returned to the Upload state", cycleId);
    this.bump();
    return Promise.resolve();
  }
  deleteSitting(cycleId: string): Promise<void> {
    const name = cycleId === this.seed.liveCycle.id ? this.seed.liveCycle.name : cycleId;
    this.audit("cycle", "Deleted sitting", `Removed sitting "${name}" and all its ingested data`, null);
    this.bump();
    return Promise.resolve();
  }

  resolveDuplicates(cycleId: string, strategy: DuplicateStrategy): void {
    // MOCK: records the choice in memory only; no DB write and no row mutation.
    // The real provider will call a server action that rewrites the response set.
    void strategy;
    this.audit("upload", "Resolved duplicates", `Strategy: ${strategy.replace("_", " ")}`, cycleId);
    this.bump();
  }

  lockCycle(cycleId: string): void {
    if (this.user.role !== "lead_admin") return;
    this.locked.add(cycleId);
    const n = this.seed.liveCycle.participants.length;
    this.audit("lock", "Locked grades", `${n} students signed off across ${this.seed.liveCycle.assessments.length} assessments`, cycleId);
    this.bump();
  }
  unlockCycle(cycleId: string): void {
    if (this.user.role !== "lead_admin") return;
    this.locked.delete(cycleId);
    this.audit("reopen", "Re-opened cycle", "Cycle unlocked for further review", cycleId);
    this.bump();
  }

  // ── members & roles ───────────────────────────────────────────────────────
  getMembers(): MembersModel {
    return {
      members: this.members.map((m) => ({ ...m, roleName: this.roles.find((r) => r.id === m.roleId)?.name ?? m.roleName })),
      roles: this.roles.map((r) => ({ id: r.id, name: r.name })),
    };
  }

  private roleMemberCount(roleId: string): number {
    return this.members.filter((m) => m.roleId === roleId).length;
  }

  getRoles(): RolesModel {
    return {
      roles: this.roles.map((r) => ({ ...r, memberCount: this.roleMemberCount(r.id) })),
      groups: CAPABILITY_GROUPS,
      matrix: this.matrix,
    };
  }

  inviteMember(email: string, roleId: string): void {
    if (this.user.role !== "lead_admin") return;
    const clean = email.trim();
    if (!clean || this.members.some((m) => m.email.toLowerCase() === clean.toLowerCase())) return;
    const name = clean
      .split("@")[0]!
      .split(/[._]/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");
    const roleName = this.roles.find((r) => r.id === roleId)?.name ?? "Data Scientist";
    this.members.push({
      id: `m-${Date.now()}`,
      name: name || clean,
      email: clean,
      roleId,
      roleName,
      status: "invited",
      lastActive: "Invite sent just now",
      isCurrent: false,
    });
    this.audit("upload", "Invited person", `${clean} as ${roleName}`, null);
    this.bump();
  }
  setMemberRole(memberId: string, roleId: string): void {
    if (this.user.role !== "lead_admin") return;
    const m = this.members.find((x) => x.id === memberId);
    const role = this.roles.find((r) => r.id === roleId);
    if (!m || !role) return;
    m.roleId = roleId;
    m.roleName = role.name;
    this.bump();
  }
  removeMember(memberId: string): void {
    if (this.user.role !== "lead_admin" || memberId === this.user.id) return;
    this.members = this.members.filter((m) => m.id !== memberId);
    this.bump();
  }
  resendInvite(memberId: string): void {
    const m = this.members.find((x) => x.id === memberId);
    if (m && m.status === "invited") {
      m.lastActive = "Invite re-sent just now";
      this.bump();
    }
  }
  createRole(name: string): void {
    if (this.user.role !== "lead_admin") return;
    const clean = name.trim();
    if (!clean) return;
    const id = `role-${Date.now()}`;
    this.roles.push({ id, name: clean, isLead: false, memberCount: 0 });
    // New roles start with no capabilities — tick what they need.
    this.matrix[id] = Object.fromEntries(ALL_CAPABILITY_IDS.map((c) => [c, false]));
    this.bump();
  }
  renameRole(roleId: string, name: string): void {
    if (this.user.role !== "lead_admin") return;
    const r = this.roles.find((x) => x.id === roleId);
    const clean = name.trim();
    if (!r || !clean) return;
    r.name = clean;
    for (const m of this.members) if (m.roleId === roleId) m.roleName = clean;
    this.bump();
  }
  setCapability(roleId: string, capabilityId: string, granted: boolean): void {
    if (this.user.role !== "lead_admin") return;
    const row = this.matrix[roleId] ?? (this.matrix[roleId] = {});
    row[capabilityId] = granted;
    this.bump();
  }
  deleteRole(roleId: string): void {
    if (this.user.role !== "lead_admin") return;
    const role = this.roles.find((r) => r.id === roleId);
    // The Lead archetype is undeletable, and a role still assigned to members
    // can't be removed (reassign them first).
    if (!role || role.isLead || this.roleMemberCount(roleId) > 0) return;
    this.roles = this.roles.filter((r) => r.id !== roleId);
    delete this.matrix[roleId];
    this.audit("config", "Deleted role", `Removed role "${role.name}"`, null);
    this.bump();
  }

  // ── configuration ─────────────────────────────────────────────────────────
  getConfig(): ConfigModel {
    return {
      // Display rows derived from the *live* item-quality thresholds, so the
      // Configuration screen reflects whatever the engine is actually using.
      thresholds: qualityThresholdRows(this.quality),
      retention: { ...this.retention },
      branding: { ...this.branding },
      safeguard: {
        // The D3 safeguard reads this demand level (editable); the threshold is
        // the dynamic per-exam majority of available D3 items, not a fixed count.
        topDifficultyDemand: this.resolveTopDifficulty(),
        demandLevels: this.allDemandLevels(),
      },
    };
  }

  getScoringConfig(): ScoringConfig {
    return this.scoringConfig();
  }
  setRetention(patch: Partial<RetentionConfig>): void {
    this.retention = { ...this.retention, ...patch };
    this.bump();
  }
  setBranding(patch: Partial<BrandingConfig>): void {
    this.branding = { ...this.branding, ...patch };
    this.bump();
  }

  // ── audit ─────────────────────────────────────────────────────────────────
  getAuditLog(cycleId: string | null, filter: AuditFilter, search: string): AuditModel {
    const filterTypes: Record<AuditFilter, AuditType[] | null> = {
      all: null,
      exclude: ["exclude"],
      boundary: ["boundary"],
      lock: ["lock", "reopen"],
      export: ["export", "document"],
    };
    const types = filterTypes[filter];
    const q = search.trim().toLowerCase();
    const entries = this.auditEntries.filter((e) => {
      if (cycleId && e.cycleId && e.cycleId !== cycleId) return false;
      if (types && !types.includes(e.type)) return false;
      if (q && !`${e.action} ${e.detail} ${e.actorName}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return { entries, total: this.auditEntries.length };
  }

  recordExport(cycleId: string, detail: string): void {
    this.audit("export", "Exported data", detail, cycleId);
    this.bump();
  }
  recordDocuments(cycleId: string, detail: string): void {
    this.audit("document", "Generated documents", detail, cycleId);
    this.bump();
  }

  // ── analytics (real live cycle, mock priors) ──────────────────────────────
  private liveAggregates() {
    const cycleId = this.seed.liveCycle.id;
    const overallPcts = [...this.overallPctByParticipant(cycleId).values()];
    const grades = this.getGrades(cycleId);
    const awardLevels = this.grading.awardLevels;
    const awardDist: Record<string, number> = {};
    const n = grades?.rows.length ?? 0;
    for (const lvl of awardLevels) {
      const c = grades?.distribution.find((d) => d.level === lvl)?.count ?? 0;
      awardDist[lvl] = n ? round((c / n) * 100, 0) : 0;
    }
    // per-assessment cohort mean + excluded + mean quality
    const byAssessment: Record<string, number> = {};
    let totalExcluded = 0;
    let qualitySum = 0;
    let qualityCount = 0;
    for (const a of this.seed.liveCycle.assessments) {
      const pcts = [...this.pctByParticipant(cycleId, a).values()].map((v) => v.pct);
      byAssessment[a.id] = round(mean(pcts), 1);
      totalExcluded += this.excludedSet(cycleId, a.id).size;
      for (const it of a.items) {
        qualitySum += it.qualityIndex;
        qualityCount += 1;
      }
    }
    return {
      participants: this.seed.liveCycle.participants.length,
      cohortMean: round(mean(overallPcts), 1),
      median: round(median(overallPcts), 0),
      sd: round(stddev(overallPcts), 1),
      itemsScored: this.seed.liveCycle.assessments.reduce((s, a) => s + a.items.length, 0) - totalExcluded,
      itemsExcluded: totalExcluded,
      meanQuality: qualityCount ? Math.round(qualitySum / qualityCount) : 0,
      awardDist,
      byAssessment,
    };
  }

  getAnalyticsTrends(): AnalyticsTrends {
    const live = this.liveAggregates();
    const awardLevels = this.grading.awardLevels;
    const assessmentIds = this.seed.liveCycle.assessments.map((a) => a.id);
    const priors = mockPriors(awardLevels, assessmentIds);

    const series = (pick: (p: { participants: number; cohortMean: number; itemsExcluded: number; meanQuality: number }) => number, liveVal: number) =>
      [...priors.map(pick), liveVal];
    const delta = (pts: number[]) => {
      const a = pts[pts.length - 1] ?? 0;
      const b = pts[pts.length - 2] ?? a;
      const d = round(a - b, 1);
      return `${d >= 0 ? "+" : "−"}${Math.abs(d)} vs last`;
    };
    const ptsParticipants = series((p) => p.participants, live.participants);
    const ptsMean = series((p) => p.cohortMean, live.cohortMean);
    const ptsExcluded = series((p) => p.itemsExcluded, live.itemsExcluded);
    const ptsQuality = series((p) => p.meanQuality, live.meanQuality);

    const kpis: TrendKpi[] = [
      { label: "Participants", value: live.participants.toLocaleString(), delta: delta(ptsParticipants), points: ptsParticipants, format: "intComma" },
      { label: "Cohort mean", value: `${live.cohortMean}%`, delta: delta(ptsMean), points: ptsMean, format: "pct" },
      { label: "Items excluded", value: String(live.itemsExcluded), delta: delta(ptsExcluded), points: ptsExcluded, format: "int" },
      { label: "Mean item quality", value: String(live.meanQuality), delta: delta(ptsQuality), points: ptsQuality, format: "int" },
    ];

    const byAssessment = this.seed.liveCycle.assessments.map((a) => {
      const pts = [...priors.map((p) => p.byAssessment[a.id] ?? 0), live.byAssessment[a.id] ?? 0];
      const d = round((pts[pts.length - 1] ?? 0) - (pts[pts.length - 2] ?? 0), 1);
      return { name: a.shortName, points: pts, now: `${live.byAssessment[a.id] ?? 0}%`, delta: `${d >= 0 ? "+" : "−"}${Math.abs(d)}` };
    });

    const awardOverTime = [
      ...priors.map((p) => ({ label: p.label, dist: p.awardDist })),
      { label: ANALYTICS_CYCLE_LABELS[ANALYTICS_CYCLE_LABELS.length - 1] ?? "May 26", dist: live.awardDist },
    ];

    // Full cycle names: mock priors' names, with the last replaced by the real
    // live cycle name. Parallel to cycleLabels; the last entry is "current".
    const cycleNames = ANALYTICS_CYCLE_LABELS.map((_, i) =>
      i === ANALYTICS_CYCLE_LABELS.length - 1
        ? this.seed.liveCycle.name
        : ANALYTICS_CYCLE_NAMES[i] ?? ANALYTICS_CYCLE_LABELS[i] ?? "",
    );

    return {
      cycleLabels: ANALYTICS_CYCLE_LABELS,
      cycleNames,
      currentIndex: ANALYTICS_CYCLE_LABELS.length - 1,
      kpis,
      byAssessment,
      awardOverTime,
      awardLevels,
      priorsAreMock: true,
    };
  }

  getAnalyticsCompare(): AnalyticsCompare {
    const live = this.liveAggregates();
    const awardLevels = this.grading.awardLevels;
    const prior = mockPriors(awardLevels, this.seed.liveCycle.assessments.map((a) => a.id))[2]!; // Jan 26

    const topAward = awardLevels[0] ?? "";
    const lowAward = awardLevels[awardLevels.length - 1] ?? "";
    const metrics = [
      { key: "participants", label: "Participants" },
      { key: "cohortMean", label: "Cohort mean" },
      { key: "median", label: "Median score" },
      { key: "sd", label: "Std. dev (σ)" },
      { key: "itemsScored", label: "Items scored" },
      { key: "itemsExcluded", label: "Items excluded" },
      { key: "topShare", label: `${topAward} share` },
      { key: "lowShare", label: `${lowAward} share` },
    ];

    const liveCol: CompareColumn = {
      cycle: this.seed.liveCycle.name,
      mock: false,
      metrics: {
        participants: live.participants.toLocaleString(),
        cohortMean: `${live.cohortMean}%`,
        median: String(live.median),
        sd: String(live.sd),
        itemsScored: String(live.itemsScored),
        itemsExcluded: String(live.itemsExcluded),
        topShare: `${live.awardDist[topAward] ?? 0}%`,
        lowShare: `${live.awardDist[lowAward] ?? 0}%`,
      },
      dist: live.awardDist,
    };
    const priorCol: CompareColumn = {
      cycle: "January 2026",
      mock: true,
      metrics: {
        participants: prior.participants.toLocaleString(),
        cohortMean: `${prior.cohortMean}%`,
        median: String(prior.median),
        sd: String(prior.sd),
        itemsScored: String(prior.itemsScored),
        itemsExcluded: String(prior.itemsExcluded),
        topShare: `${prior.awardDist[topAward] ?? 0}%`,
        lowShare: `${prior.awardDist[lowAward] ?? 0}%`,
      },
      dist: prior.awardDist,
    };

    return { metrics, columns: [liveCol, priorCol], awardLevels, priorsAreMock: true };
  }

  // ── compare cycles (per-subject, multi-cycle) ─────────────────────────────
  // Read-only. The live cycle's figures are REAL — read from the existing
  // computed outputs (boundaries, review, reliability, grades). Prior cycles
  // have no real per-subject history, so their columns use clearly-labelled
  // MOCK figures (see mockCompareSubjects), consistent with Trends/Compare.
  getCompareCycles(cycleIds?: string[]): CompareCyclesModel {
    const liveId = this.seed.liveCycle.id;
    const all = this.listCycles();
    const available = all.map((c) => ({ id: c.id, name: c.name, mock: c.mock, live: c.live }));

    // Default = the two most recent cycles (listCycles is newest → oldest).
    const wanted = (cycleIds && cycleIds.length >= 1 ? cycleIds : available.slice(0, 2).map((c) => c.id))
      .filter((id) => available.some((c) => c.id === id));
    const selected = wanted.length >= 1 ? wanted : available.slice(0, 2).map((c) => c.id);
    // Render oldest → newest so slope/line charts read left-to-right in time.
    const orderIndex = (id: string) => available.findIndex((c) => c.id === id);
    const selectedIds = [...selected].sort((a, b) => orderIndex(b) - orderIndex(a));

    const awardLevels = this.grading.awardLevels;
    const performanceLevels = this.grading.performanceLevels;
    const lowestAward = awardLevels[awardLevels.length - 1] ?? "";
    const lowestPerf = performanceLevels[performanceLevels.length - 1] ?? "";

    const subjects = this.seed.liveCycle.assessments.map((a) => ({
      id: a.id,
      short: a.shortName,
      full: a.name,
    }));

    const meanOf = (xs: (number | null)[]): number | null => {
      const vs = xs.filter((v): v is number => v != null && Number.isFinite(v));
      return vs.length ? round(vs.reduce((s, v) => s + v, 0) / vs.length, 2) : null;
    };

    const buildLive = (): CompareCycleData => {
      const grades = this.getGrades(liveId);
      const awardDist: Record<string, number> = {};
      for (const lvl of awardLevels) {
        awardDist[lvl] = grades?.distribution.find((d) => d.level === lvl)?.count ?? 0;
      }
      const subjectsOut: Record<string, CompareSubjectMetrics> = {};
      for (const a of this.seed.liveCycle.assessments) {
        const b = this.getBoundaries(liveId, a.id);
        const review = this.getReview(liveId, a.id);
        const alphaRow = this.getReliability(liveId)?.rows.find(
          (r) => r.level === "subject" && r.assessmentId === a.id,
        );
        // average p-value / point-biserial over RETAINED items (read, not recomputed)
        const retained = (review?.items ?? []).filter((it) => !it.excluded);
        const avgPValue = meanOf(retained.map((it) => it.pValue));
        const avgPointBiserial = meanOf(retained.map((it) => it.pointBiserial));
        const perfCounts: Record<string, number> = {};
        for (const band of b?.bands ?? []) perfCounts[band.level] = band.students;
        const cuts: CompareCut[] = (b?.cuts ?? []).map((c, i) => ({
          name: `${b?.levels[i + 1] ?? ""} → ${b?.levels[i] ?? ""}`,
          value: b ? Math.round((c / 100) * b.maxRaw) : null,
        }));
        const n = b?.n ?? null;
        const lowCount = perfCounts[lowestPerf] ?? 0;
        subjectsOut[a.id] = {
          participants: n,
          scoreMean: b ? b.stats.mean : null,
          scoreMedian: b ? b.stats.median : null,
          scoreMax: b ? b.maxRaw : null,
          avgPValue,
          avgPointBiserial,
          alpha: alphaRow?.alpha ?? null,
          itemsUsable: b ? b.stats.itemsScored : null,
          itemsRemoved: b ? b.stats.excluded : null,
          cuts,
          perfCounts,
          passOrAbove: n ? round(((n - lowCount) / n) * 100, 0) : null,
        };
      }
      const partTotal = Object.values(subjectsOut).reduce<number>((s, m) => s + (m.participants ?? 0), 0);
      const awardedCount = awardLevels
        .filter((l) => l !== lowestAward)
        .reduce((s, l) => s + (awardDist[l] ?? 0), 0);
      return {
        id: liveId,
        name: this.seed.liveCycle.name,
        mock: false,
        live: true,
        participantsTotal: partTotal,
        avgScoreAllSubjects: meanOf(Object.values(subjectsOut).map((m) => m.scoreMean)),
        passOrAboveCount: awardedCount,
        avgPValue: meanOf(Object.values(subjectsOut).map((m) => m.avgPValue)),
        avgAlpha: meanOf(Object.values(subjectsOut).map((m) => m.alpha)),
        awardDist,
        subjects: subjectsOut,
      };
    };

    const buildMock = (ref: { id: string; name: string }): CompareCycleData => {
      const mock = mockCompareSubjects(
        ref.id,
        this.seed.liveCycle.assessments.map((a) => ({ id: a.id, itemCount: a.items.length })),
      );
      const subjectsOut: Record<string, CompareSubjectMetrics> = {};
      let partTotal = 0;
      // award distribution: derived from the per-subject mock performance mix so
      // the overall award chart stays coherent with the per-subject charts.
      const awardDist: Record<string, number> = Object.fromEntries(awardLevels.map((l) => [l, 0]));
      for (const a of this.seed.liveCycle.assessments) {
        const m = mock[a.id]!;
        partTotal += m.participants;
        // Spread participants across performance levels by a simple difficulty mix.
        const perfCounts: Record<string, number> = {};
        const weights = [0.18, 0.32, 0.3, 0.2]; // top → lowest, illustrative
        let assigned = 0;
        performanceLevels.forEach((lvl, i) => {
          const last = i === performanceLevels.length - 1;
          const c = last ? m.participants - assigned : Math.round(m.participants * (weights[i] ?? 0));
          perfCounts[lvl] = Math.max(0, c);
          assigned += perfCounts[lvl];
        });
        const cuts: CompareCut[] = performanceLevels.slice(0, -1).map((_, i) => ({
          name: `${performanceLevels[i + 1] ?? ""} → ${performanceLevels[i] ?? ""}`,
          value: Math.round((m.scoreMax * (0.3 + i * 0.22)) ),
        }));
        const lowCount = perfCounts[lowestPerf] ?? 0;
        subjectsOut[a.id] = {
          participants: m.participants,
          scoreMean: m.scoreMean,
          scoreMedian: m.scoreMedian,
          scoreMax: m.scoreMax,
          avgPValue: m.avgPValue,
          avgPointBiserial: m.avgPointBiserial,
          alpha: m.alpha,
          itemsUsable: m.itemsUsable,
          itemsRemoved: m.itemsRemoved,
          cuts,
          perfCounts,
          passOrAbove: m.participants ? round(((m.participants - lowCount) / m.participants) * 100, 0) : null,
        };
      }
      // Overall award mix: top award when ≥3 top-perf subjects is hard to fake
      // cheaply, so approximate from the cohort spread (clearly mock anyway).
      const nStudents = Math.round(partTotal / Math.max(1, this.seed.liveCycle.assessments.length));
      const awardWeights = [0.12, 0.26, 0.34]; // top three; lowest is the remainder
      let awardAssigned = 0;
      awardLevels.forEach((lvl, i) => {
        const last = i === awardLevels.length - 1;
        const c = last ? nStudents - awardAssigned : Math.round(nStudents * (awardWeights[i] ?? 0));
        awardDist[lvl] = Math.max(0, c);
        awardAssigned += awardDist[lvl] ?? 0;
      });
      const awardedCount = awardLevels
        .filter((l) => l !== lowestAward)
        .reduce((s, l) => s + (awardDist[l] ?? 0), 0);
      return {
        id: ref.id,
        name: ref.name,
        mock: true,
        live: false,
        participantsTotal: partTotal,
        avgScoreAllSubjects: meanOf(Object.values(subjectsOut).map((m) => m.scoreMean)),
        passOrAboveCount: awardedCount,
        avgPValue: meanOf(Object.values(subjectsOut).map((m) => m.avgPValue)),
        avgAlpha: meanOf(Object.values(subjectsOut).map((m) => m.alpha)),
        awardDist,
        subjects: subjectsOut,
      };
    };

    const cycles = selectedIds.map((id) => {
      const ref = available.find((c) => c.id === id)!;
      return ref.live ? buildLive() : buildMock(ref);
    });

    return {
      available,
      selectedIds,
      cycles,
      subjects,
      awardLevels,
      performanceLevels,
      anyMock: cycles.some((c) => c.mock),
    };
  }

  // ── new cycle ─────────────────────────────────────────────────────────────
  getNewCycle(): NewCycleModel {
    // The picker offers the canonical G12++ subject catalog, not the assessments
    // of whatever cycle happens to be loaded — so it is fully populated even
    // before any cycle exists (live Supabase, fresh database).
    return {
      defaultName: "May 2026",
      sittingDate: "14 May 2026",
      assessments: SUBJECT_CATALOG.map((s) => ({
        id: s.id,
        name: s.name,
        rtl: s.rtl,
        included: true,
        fileName: null,
      })),
    };
  }

  createCycle(input: CreateCycleInput): Promise<string> {
    // In-memory/demo mode has no database: record the intent in the audit log and
    // resolve to the demo cycle id (the only one with real data) so navigation
    // works. The Supabase provider overrides this to persist a real cycle.
    this.audit("cycle", "Created cycle", `${input.name} — ${input.assessmentIds.length} assessments`, this.seed.liveCycle.id);
    this.bump();
    return Promise.resolve(this.seed.liveCycle.id);
  }
}
