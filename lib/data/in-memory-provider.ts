/**
 * In-memory DataProvider. Seeds from genuine engine output (seed.generated.json)
 * and recomputes scores/distributions/grades through the real engine on every
 * change. Decisions (exclusions, boundaries, locks) live in memory and reset on
 * reload — there is no database in this build.
 */

import { getEngine, defaultScoringConfig } from "@/lib/engine";
import type {
  ItemStat,
  PerStudentExclusion,
  QualityRating,
  QualityThresholds,
  ResponseRecord,
  ScoringConfig,
} from "@/lib/engine";
import seedJson from "./seed.generated.json";
import type { Seed, SeedAssessment, SeedItem } from "./seed-types";
import type { DataProvider, SetBoundaryInput, TechnicalErrorRow } from "./provider";
import {
  PIPELINE,
  type AnalyticsCompare,
  type AnalyticsTrends,
  type AssessmentRef,
  type AuditEntry,
  type AuditFilter,
  type AuditModel,
  type AuditType,
  type BoundaryMode,
  type BoundaryModel,
  type BrandingConfig,
  type ConfigModel,
  type CompareColumn,
  type CreateCycleInput,
  type CurrentUser,
  type CycleDetail,
  type CycleSummary,
  type DocSettings,
  type DocumentsModel,
  type DuplicateStrategy,
  type GradeBandRow,
  type GradesModel,
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
  type RoleDef,
  type RolesModel,
  type StudentSummary,
  type DistinctionCandidate,
  type DistinctionSafeguardModel,
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
  CAPABILITY_GROUPS,
  DEFAULT_ROLES,
  defaultMatrix,
  defaultMembers,
  mockPriors,
  seedAuditEntries,
} from "./mock-admin";

const seed = seedJson as unknown as Seed;
const engine = getEngine();

interface BoundaryState {
  mode: BoundaryMode;
  cuts: number[];
  targets: number[];
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

  // technical errors / per-student exclusions + distinction safeguard
  private technicalErrors = new Map<string, { uploaded: boolean; sample: boolean; fileName: string | null; incidents: TechnicalIncident[] }>();
  private incidentSeq = 0;
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
    // MOCK: no real auth yet. The signed-in user is a Lead (G12 Lead role) so
    // role-gated controls (Lock, admin) are exercised; swap for the real
    // Microsoft-authenticated user when Supabase auth lands.
    name: "Rana Mansour",
    initials: "RM",
    role: "lead_admin",
  };

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
    return seed.liveCycle.assessments.find((a) => a.id === assessmentId);
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
  /** participantId -> percentage on retained items for one assessment. */
  private pctByParticipant(
    cycleId: string,
    a: SeedAssessment,
  ): Map<string, { raw: number; itemsSeen: number; pct: number }> {
    const excluded = [...this.excludedSet(cycleId, a.id)];
    const perStudent = this.perStudentExclusions(cycleId, a.id);
    const scores = engine.computeScores(this.responsesOf(a), excluded, perStudent);
    return new Map(scores.map((s) => [s.participantId, { raw: s.raw, itemsSeen: s.itemsSeen, pct: s.pct }]));
  }

  /** Per-student (participant, item) exclusions from confirmed technical incidents. */
  private perStudentExclusions(cycleId: string, assessmentId?: string): PerStudentExclusion[] {
    const te = this.technicalErrors.get(cycleId);
    if (!te) return [];
    const out: PerStudentExclusion[] = [];
    for (const inc of te.incidents) {
      if (inc.decision !== "excluded" || !inc.itemId) continue;
      if (assessmentId && inc.assessmentId !== assessmentId) continue;
      out.push({ participantId: inc.studentId, itemId: inc.itemId });
    }
    return out;
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
    return seed.liveCycle.assessments.map((a) => ({
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
    const live = seed.liveCycle;
    const liveSummary: CycleSummary = {
      id: live.id,
      name: live.name,
      stageIndex: live.stageIndex,
      stageLabel: this.locked.has(live.id) ? "Locked & exported" : PIPELINE[live.stageIndex] ?? "Draft",
      stepsDone: this.locked.has(live.id) ? 8 : live.stageIndex,
      participants: live.participants.length,
      assessments: live.assessments.length,
      lastActivity: live.lastActivity,
      locked: this.locked.has(live.id),
      live: true,
      mock: false,
    };
    const priors: CycleSummary[] = seed.priorCycles.map((p) => ({
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
    const live = seed.liveCycle;
    if (cycleId === live.id) {
      const refs = this.assessmentRefs(cycleId);
      const first = refs[0];
      return {
        id: live.id,
        name: live.name,
        participants: live.participants.length,
        assessmentCount: refs.length,
        startedAt: live.startedAt,
        stageIndex: this.locked.has(live.id) ? 7 : live.stageIndex,
        locked: this.locked.has(live.id),
        mock: false,
        doNext: this.locked.has(live.id)
          ? { title: "Generate documents", body: "Grades are signed off. Generate certificates and performance reports for every student.", href: `/cycles/${live.id}/documents`, cta: "Generate documents" }
          : {
              title: "Review item quality",
              body: "Assessments are validated and waiting for quality review before scoring.",
              href: first ? `/cycles/${live.id}/review/${encodeURIComponent(first.id)}` : `/cycles/${live.id}`,
              cta: "Go to item review",
            },
        assessments: refs,
      };
    }
    const prior = seed.priorCycles.find((p) => p.id === cycleId);
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

  // ── ingest & validate ─────────────────────────────────────────────────────
  getIngest(cycleId: string): IngestModel | null {
    const live = seed.liveCycle;
    if (cycleId !== live.id) return null;
    return {
      cycleId,
      fileName: live.fileName,
      fileSizeMB: live.fileSizeMB,
      uploadedAgo: live.uploadedAgo,
      report: live.validation,
      preview: live.preview,
      duplicates: live.duplicates,
      canContinue: live.validation.passed,
      technicalErrors: this.technicalErrorsUpload(cycleId),
    };
  }

  // ── item review & scoring ───────────────────────────────────────────────--
  getReview(cycleId: string, assessmentId: string): ReviewModel | null {
    const a = this.assessment(assessmentId);
    if (cycleId !== seed.liveCycle.id || !a) return null;
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
    if (cycleId !== seed.liveCycle.id || !a) return null;
    const index = a.items.findIndex((it) => it.id === itemId);
    if (index < 0) return null;
    const item = a.items[index]!;

    // Full live ItemStat (same engine call as the table) so the per-statistic
    // ratings reflect any per-student exclusions and the configured thresholds.
    const perStudent = this.perStudentExclusions(cycleId, assessmentId);
    const stats = engine.computeItemStats({
      responses: this.responsesOf(a),
      perStudentExcluded: perStudent,
      scoringConfig: this.scoringConfig(),
    });
    const s = stats.find((x) => x.itemId === itemId);

    // Live response rows for this item (per-student-excluded responses dropped),
    // for the outcome split and the discrimination upper/lower groups.
    const ps = new Set(perStudent.map((e) => `${e.participantId} ${e.itemId}`));
    const recs = this.responsesOf(a).filter((r) => !ps.has(`${r.participantId} ${r.itemId}`));
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
      const totals = new Map<string, { raw: number; seen: number }>();
      for (const a of seed.liveCycle.assessments) {
        for (const [pid, v] of this.pctByParticipant(cycleId, a)) {
          const t = totals.get(pid) ?? { raw: 0, seen: 0 };
          t.raw += v.raw;
          t.seen += v.itemsSeen;
          totals.set(pid, t);
        }
      }
      return [...totals.values()].filter((t) => t.seen > 0).map((t) => (t.raw / t.seen) * 100);
    }
    const a = this.assessment(scope);
    if (!a) return [];
    return [...this.pctByParticipant(cycleId, a).values()].map((v) => v.pct);
  }

  getBoundaries(cycleId: string, scope: string): BoundaryModel | null {
    if (cycleId !== seed.liveCycle.id) return null;
    const scopes = [
      ...seed.liveCycle.assessments.map((a) => ({ id: a.id, label: a.shortName })),
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

    // Solve cut-points from cumulative-from-top cohort-% targets.
    const cutsFromTargets = (t: number[]): number[] => {
      let cum = 0;
      return t.map((share) => {
        cum += Number(share) || 0;
        const want = (cum / 100) * n;
        let best = 0;
        let bd = Infinity;
        for (let s = 0; s <= 100; s++) {
          const d = Math.abs(atOrAbove(s) - want);
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
        return best;
      });
    };

    const effCuts = st.mode === "cuts" ? st.cuts : cutsFromTargets(st.targets);
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
      for (const a of seed.liveCycle.assessments) {
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
    };
  }

  // ── grades & sign-off ───────────────────────────────────────────────────--
  /** Per-participant overall percentage = total raw / total max across assessments. */
  private overallPctByParticipant(cycleId: string): Map<string, number> {
    const totals = new Map<string, { raw: number; seen: number }>();
    for (const a of seed.liveCycle.assessments) {
      for (const [pid, v] of this.pctByParticipant(cycleId, a)) {
        const t = totals.get(pid) ?? { raw: 0, seen: 0 };
        t.raw += v.raw;
        t.seen += v.itemsSeen;
        totals.set(pid, t);
      }
    }
    const out = new Map<string, number>();
    for (const [pid, t] of totals) out.set(pid, t.seen ? (t.raw / t.seen) * 100 : 0);
    return out;
  }

  getGrades(cycleId: string): GradesModel | null {
    if (cycleId !== seed.liveCycle.id) return null;
    const refs = this.assessmentRefs(cycleId);
    const perfLevels = this.grading.performanceLevels;
    const awardLevels = this.grading.awardLevels;

    // per-assessment pct maps + effective cut-points
    const pctMaps = new Map<string, Map<string, number>>();
    const cutsByScope = new Map<string, number[]>();
    for (const a of seed.liveCycle.assessments) {
      const m = new Map<string, number>();
      for (const [pid, v] of this.pctByParticipant(cycleId, a)) m.set(pid, v.pct);
      pctMaps.set(a.id, m);
      cutsByScope.set(a.id, this.boundaryState(cycleId, a.id).cuts);
    }
    const awardCuts = this.boundaryState(cycleId, "overall").cuts;
    const overallPcts = this.overallPctByParticipant(cycleId);
    const safeguard = this.distinctionDecisions(cycleId); // studentId -> capped?

    const rows = seed.liveCycle.participants.map((p) => {
      const grades: Record<string, { level: string; stars: string }> = {};
      for (const a of seed.liveCycle.assessments) {
        const pct = pctMaps.get(a.id)?.get(p.id);
        const level = pct === undefined ? "" : classify(pct, perfLevels, cutsByScope.get(a.id)!);
        grades[a.id] = { level, stars: starsFor(level, this.grading.starMap) };
      }
      const op = overallPcts.get(p.id);
      let award = op === undefined ? "" : classify(op, awardLevels, awardCuts);
      // Distinction safeguard: cap a Distinction that fell short of the rule
      // (unless a Lead overrode it). awardLevels[1] = Advanced achievement.
      if (award === awardLevels[0] && safeguard.get(p.id) === "capped") {
        award = awardLevels[1] ?? award;
      }
      return { id: p.id, label: p.label, grades, award };
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

    // subjects with ordered major elements + per-(participant,element) levels
    const subjects: PerfReportSubject[] = [];
    const elementLevelByP = new Map<string, Map<string, Map<string, string>>>(); // assessmentId -> pid -> element -> level
    for (const a of seed.liveCycle.assessments) {
      const cuts = this.boundaryState(cycleId, a.id).cuts;
      const itemMajor = new Map<string, string | null>();
      const majorOrder: string[] = [];
      for (const it of a.items) {
        itemMajor.set(it.id, it.major);
        if (it.major && !majorOrder.includes(it.major)) majorOrder.push(it.major);
      }
      subjects.push({ assessmentId: a.id, name: a.name, majorElements: majorOrder });

      const excluded = this.excludedSet(cycleId, a.id);
      const ps = new Set(this.perStudentExclusions(cycleId, a.id).map((e) => `${e.participantId} ${e.itemId}`));
      // accumulate raw/n per (participant, element)
      const acc = new Map<string, Map<string, { raw: number; n: number }>>();
      for (const r of this.responsesOf(a)) {
        if (excluded.has(r.itemId)) continue;
        if (ps.has(`${r.participantId} ${r.itemId}`)) continue;
        const el = itemMajor.get(r.itemId);
        if (!el) continue;
        let byEl = acc.get(r.participantId);
        if (!byEl) acc.set(r.participantId, (byEl = new Map()));
        const cell = byEl.get(el) ?? { raw: 0, n: 0 };
        cell.raw += r.score;
        cell.n += 1;
        byEl.set(el, cell);
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
    }

    const students: PerfReportStudent[] = grades.rows.map((row) => {
      const sub: Record<string, PerfElementResult> = {};
      for (const a of seed.liveCycle.assessments) {
        const level = row.grades[a.id]?.level ?? "";
        const elements: Record<string, string> = {};
        const lvls = elementLevelByP.get(a.id)?.get(row.id);
        if (lvls) for (const [el, lv] of lvls) elements[el] = lv;
        sub[a.id] = { level, elements };
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
      cycleName: seed.liveCycle.name,
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
      perStudentExcluded: this.perStudentExclusions(cycleId, a.id),
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
    for (const a of seed.liveCycle.assessments) for (const it of a.items) if (it.demand) set.add(it.demand);
    return [...set].sort();
  }
  /** The "top-difficulty" demand: configured value, else the highest present. */
  private resolveTopDifficulty(assessmentId?: string): string {
    if (this.safeguard.topDifficultyDemand) return this.safeguard.topDifficultyDemand;
    const set = new Set<string>();
    const asms = assessmentId
      ? seed.liveCycle.assessments.filter((a) => a.id === assessmentId)
      : seed.liveCycle.assessments;
    for (const a of asms) for (const it of a.items) if (it.demand) set.add(it.demand);
    const sorted = [...set].sort();
    return sorted[sorted.length - 1] ?? "";
  }
  /** Locate an item across assessments, with a display label (Q-index in order). */
  private itemLocate(itemId: string): { a: SeedAssessment; item: SeedItem; label: string } | null {
    for (const a of seed.liveCycle.assessments) {
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
    const byId = seed.liveCycle.participants.find((p) => p.id.toLowerCase() === clean.toLowerCase());
    if (byId) return { id: byId.id, name: byId.label };
    const byLabel = seed.liveCycle.participants.find((p) => p.label.toLowerCase() === clean.toLowerCase());
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
    if (cycleId !== seed.liveCycle.id) return null;
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
    if (cycleId !== seed.liveCycle.id || this.locked.has(cycleId)) return;
    const label = (id: string) => seed.liveCycle.participants.find((p) => p.id === id)?.label ?? id;
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
  /** Top-difficulty questions a student attempted in one assessment (minus their exclusions). */
  private topDiffAnswered(cycleId: string, a: SeedAssessment, studentId: string, demand: string): number {
    const excl = new Set(
      this.perStudentExclusions(cycleId, a.id)
        .filter((e) => e.participantId === studentId)
        .map((e) => e.itemId),
    );
    const pool = new Set(a.items.filter((it) => it.demand === demand).map((it) => it.id));
    let n = 0;
    for (const r of a.responses) {
      if (r.p !== studentId || !pool.has(r.i) || excl.has(r.i)) continue;
      n += 1;
    }
    return n;
  }
  /** Participants whose provisional overall award is the top award (before the safeguard). */
  private provisionalDistinctionIds(cycleId: string): string[] {
    const awardLevels = this.grading.awardLevels;
    const topAward = awardLevels[0] ?? "";
    const awardCuts = this.boundaryState(cycleId, "overall").cuts;
    const overall = this.overallPctByParticipant(cycleId);
    const ids: string[] = [];
    for (const p of seed.liveCycle.participants) {
      const op = overall.get(p.id);
      if (op === undefined) continue;
      if (classify(op, awardLevels, awardCuts) === topAward) ids.push(p.id);
    }
    return ids;
  }
  /** studentId → safeguard result, for the grade-matrix cap (used by getGrades). */
  private distinctionDecisions(cycleId: string): Map<string, SafeguardResult> {
    const demand = this.resolveTopDifficulty();
    const threshold = this.safeguard.distinctionThreshold;
    const overrides = this.distinctionOverrides.get(cycleId);
    const out = new Map<string, SafeguardResult>();
    for (const sid of this.provisionalDistinctionIds(cycleId)) {
      if (overrides?.has(sid)) {
        out.set(sid, "override");
        continue;
      }
      let capped = false;
      for (const a of seed.liveCycle.assessments) {
        const pool = a.items.filter((it) => it.demand === demand).length;
        if (pool < threshold) continue; // can't require more top-difficulty items than exist
        if (this.topDiffAnswered(cycleId, a, sid, demand) < threshold) {
          capped = true;
          break;
        }
      }
      out.set(sid, capped ? "capped" : "pass");
    }
    return out;
  }

  getDistinctionSafeguard(cycleId: string, scope?: string): DistinctionSafeguardModel | null {
    if (cycleId !== seed.liveCycle.id) return null;
    const assessments = seed.liveCycle.assessments;
    const scopes = assessments.map((a) => ({ id: a.id, label: a.shortName }));
    const scopeId = scope && assessments.some((a) => a.id === scope) ? scope : assessments[0]?.id ?? "";
    const a = this.assessment(scopeId);
    const demand = this.resolveTopDifficulty();
    const threshold = this.safeguard.distinctionThreshold;
    const pool = a ? a.items.filter((it) => it.demand === demand).length : 0;
    const awardLevels = this.grading.awardLevels;
    const topAward = awardLevels[0] ?? "";
    const cappedTo = awardLevels[1] ?? topAward;

    const decisions = this.distinctionDecisions(cycleId);
    const overrides = this.distinctionOverrides.get(cycleId);
    const inLineIds = this.provisionalDistinctionIds(cycleId);
    const labelOf = new Map(seed.liveCycle.participants.map((p) => [p.id, p.label] as const));
    const effThreshold = pool > 0 ? Math.min(threshold, pool) : threshold;

    const candidates: DistinctionCandidate[] = inLineIds.map((sid) => {
      const answered = a ? this.topDiffAnswered(cycleId, a, sid, demand) : 0;
      const ov = overrides?.get(sid);
      return {
        id: sid,
        name: labelOf.get(sid) ?? sid,
        topDifficultyAnswered: answered,
        meets: answered >= effThreshold,
        provisionalAward: topAward,
        cappedAward: cappedTo,
        result: decisions.get(sid) ?? "pass",
        overrideReason: ov?.reason ?? null,
        overrideBy: ov?.by ?? null,
      };
    });
    candidates.sort((x, y) => x.topDifficultyAnswered - y.topDifficultyAnswered);

    const vals = [...decisions.values()];
    return {
      cycleId,
      threshold,
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
      // CONFIRM: "answered" is treated as attempted (a non-blank response), not
      // "answered correctly". Flip topDiffAnswered to count score>0 to change.
      attemptedNote: '"Answered" counts an attempted (non-blank) response, not a correct one.',
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
    const label = seed.liveCycle.participants.find((p) => p.id === studentId)?.label ?? studentId;
    this.audit("safeguard", "Overrode Distinction cap", `${label} kept at ${this.grading.awardLevels[0] ?? "Distinction"} — ${clean}`, cycleId);
    this.bump();
  }

  undoDistinctionOverride(cycleId: string, studentId: string): void {
    if (this.user.role !== "lead_admin" || this.locked.has(cycleId)) return;
    const m = this.distinctionOverrides.get(cycleId);
    if (m?.delete(studentId)) {
      const label = seed.liveCycle.participants.find((p) => p.id === studentId)?.label ?? studentId;
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
    if (cycleId !== seed.liveCycle.id) return null;
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
    // DOWNSTREAM: the Student Summary carries each subject's performance `level`
    // + its report `stars`, and the overall `award`, as free strings. Stars come
    // from the configured level→stars map (ScoringConfig), so an added/removed
    // performance level needs a star mapping (already part of the config), and an
    // added/removed award needs the certificate/report template to handle that
    // award label. The next prompt (Settings CRUD + certificates) wires the
    // validation that every configured level has a star mapping and every award
    // has a template slot before generation.
    const students: StudentSummary[] = grades.rows.map((r) => ({
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

    return { cycleId, locked, students, settings, subjectOrder };
  }

  private docSettings(cycleId: string): DocSettings {
    const existing = this.docSettingsByCycle.get(cycleId);
    if (existing) return existing;
    void cycleId;
    // Defaults: cycle name + the template's sample test centre; dates from the
    // cycle. These are per-cycle settings, editable in the UI.
    return {
      cycleName: seed.liveCycle.name,
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
      // CONFIRM: award derivation is the placeholder rule (see lib/data/grading.ts).
      awardRuleUnconfirmed: true,
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

    const cuts = input.cuts ? [...input.cuts] : [...cur.cuts];
    if (input.cutIndex != null && input.cutValue != null) cuts[input.cutIndex] = input.cutValue;
    const targets = input.targets ? [...input.targets] : [...cur.targets];
    if (input.targetIndex != null && input.targetValue != null) targets[input.targetIndex] = input.targetValue;

    // Keep cut-points strictly descending (cuts[0] highest) within [1, 99].
    for (let i = 0; i < cuts.length; i++) {
      const v = Math.max(0, Math.min(100, Math.round(cuts[i] ?? 0)));
      const hi = i > 0 ? (cuts[i - 1] ?? 100) - 1 : 99;
      const lo = i < cuts.length - 1 ? (cuts[i + 1] ?? 0) + 1 : 1;
      cuts[i] = Math.max(lo, Math.min(hi, v));
    }

    // Audit only deliberate cut/target edits (not every drag tick): when a
    // single cut value is committed via the table input.
    if (input.cutIndex != null && input.cutValue != null) {
      const scopeName = scope === "overall" ? "Overall award" : this.assessment(scope)?.name ?? scope;
      this.audit("boundary", "Changed boundary", `${scopeName} — cut ${input.cutIndex + 1} set to ${cuts[input.cutIndex]}%`, cycleId);
    }

    this.boundaries.set(key, { mode: input.mode ?? cur.mode, cuts, targets });
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
    const n = seed.liveCycle.participants.length;
    this.audit("lock", "Locked grades", `${n} students signed off across ${seed.liveCycle.assessments.length} assessments`, cycleId);
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
        distinctionThreshold: this.safeguard.distinctionThreshold,
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
    const cycleId = seed.liveCycle.id;
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
    for (const a of seed.liveCycle.assessments) {
      const pcts = [...this.pctByParticipant(cycleId, a).values()].map((v) => v.pct);
      byAssessment[a.id] = round(mean(pcts), 1);
      totalExcluded += this.excludedSet(cycleId, a.id).size;
      for (const it of a.items) {
        qualitySum += it.qualityIndex;
        qualityCount += 1;
      }
    }
    return {
      participants: seed.liveCycle.participants.length,
      cohortMean: round(mean(overallPcts), 1),
      median: round(median(overallPcts), 0),
      sd: round(stddev(overallPcts), 1),
      itemsScored: seed.liveCycle.assessments.reduce((s, a) => s + a.items.length, 0) - totalExcluded,
      itemsExcluded: totalExcluded,
      meanQuality: qualityCount ? Math.round(qualitySum / qualityCount) : 0,
      awardDist,
      byAssessment,
    };
  }

  getAnalyticsTrends(): AnalyticsTrends {
    const live = this.liveAggregates();
    const awardLevels = this.grading.awardLevels;
    const assessmentIds = seed.liveCycle.assessments.map((a) => a.id);
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

    const kpis = [
      { label: "Participants", value: live.participants.toLocaleString(), delta: delta(ptsParticipants), points: ptsParticipants },
      { label: "Cohort mean", value: `${live.cohortMean}%`, delta: delta(ptsMean), points: ptsMean },
      { label: "Items excluded", value: String(live.itemsExcluded), delta: delta(ptsExcluded), points: ptsExcluded },
      { label: "Mean item quality", value: String(live.meanQuality), delta: delta(ptsQuality), points: ptsQuality },
    ];

    const byAssessment = seed.liveCycle.assessments.map((a) => {
      const pts = [...priors.map((p) => p.byAssessment[a.id] ?? 0), live.byAssessment[a.id] ?? 0];
      const d = round((pts[pts.length - 1] ?? 0) - (pts[pts.length - 2] ?? 0), 1);
      return { name: a.shortName, points: pts, now: `${live.byAssessment[a.id] ?? 0}%`, delta: `${d >= 0 ? "+" : "−"}${Math.abs(d)}` };
    });

    const awardOverTime = [
      ...priors.map((p) => ({ label: p.label, dist: p.awardDist })),
      { label: ANALYTICS_CYCLE_LABELS[ANALYTICS_CYCLE_LABELS.length - 1] ?? "May 26", dist: live.awardDist },
    ];

    return {
      cycleLabels: ANALYTICS_CYCLE_LABELS,
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
    const prior = mockPriors(awardLevels, seed.liveCycle.assessments.map((a) => a.id))[2]!; // Jan 26

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
      cycle: seed.liveCycle.name,
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

  // ── new cycle ─────────────────────────────────────────────────────────────
  getNewCycle(): NewCycleModel {
    return {
      defaultName: "May 2026",
      sittingDate: "14 May 2026",
      assessments: seed.liveCycle.assessments.map((a) => ({
        id: a.id,
        name: a.name,
        rtl: a.rtl,
        included: true,
        fileName: null,
      })),
    };
  }

  createCycle(input: CreateCycleInput): string {
    // MOCK: cycles need the database. Records the intent in the audit log and
    // returns the live cycle id (the only one with real data) so navigation works.
    this.audit("cycle", "Created cycle", `${input.name} — ${input.assessmentIds.length} assessments`, seed.liveCycle.id);
    this.bump();
    return seed.liveCycle.id;
  }
}
