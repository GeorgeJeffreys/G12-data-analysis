/**
 * In-memory DataProvider. Seeds from genuine engine output (seed.generated.json)
 * and recomputes scores/distributions/grades through the real engine on every
 * change. Decisions (exclusions, boundaries, locks) live in memory and reset on
 * reload — there is no database in this build.
 */

import { getEngine } from "@/lib/engine";
import type { ResponseRecord } from "@/lib/engine";
import seedJson from "./seed.generated.json";
import type { Seed, SeedAssessment } from "./seed-types";
import type { DataProvider, SetBoundaryInput } from "./provider";
import {
  PIPELINE,
  type AssessmentRef,
  type BoundaryMode,
  type BoundaryModel,
  type CurrentUser,
  type CycleDetail,
  type CycleSummary,
  type DuplicateStrategy,
  type GradeBandRow,
  type GradesModel,
  type GradingDefaultsModel,
  type IngestModel,
  type ItemRow,
  type ReviewModel,
} from "./types";
import {
  classify,
  defaultGradingConfig,
  starsFor,
  type GradingConfig,
  DEFAULT_PERFORMANCE_TARGETS,
  DEFAULT_AWARD_TARGETS,
} from "./grading";

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

export class InMemoryDataProvider implements DataProvider {
  private version = 0;
  private listeners = new Set<() => void>();

  // mutable decision state
  private exclusions = new Map<string, Set<string>>(); // cycle:assessment -> itemIds
  private reasons = new Map<string, string>(); // cycle:assessment:item -> reason
  private boundaries = new Map<string, BoundaryState>(); // cycle:scope -> state
  private locked = new Set<string>();
  private grading: GradingConfig = defaultGradingConfig();

  private readonly user: CurrentUser = {
    id: "u-lead",
    name: "Workspace Lead",
    initials: "RM",
    // MOCK: no real auth yet. Lead role so role-gated controls (Lock) are
    // exercised; swap for the signed-in user when Supabase auth lands.
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
    const scores = engine.computeScores(this.responsesOf(a), excluded);
    return new Map(scores.map((s) => [s.participantId, { raw: s.raw, itemsSeen: s.itemsSeen, pct: s.pct }]));
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
      stepsDone: this.locked.has(live.id) ? 7 : live.stageIndex,
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
        stageIndex: this.locked.has(live.id) ? 6 : live.stageIndex,
        locked: this.locked.has(live.id),
        mock: false,
        doNext: this.locked.has(live.id)
          ? { title: "Cycle locked", body: "Grades are signed off. Export the workbooks or re-open to make changes.", href: `/cycles/${live.id}/grades`, cta: "View grades" }
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
    };
  }

  // ── item review & scoring ───────────────────────────────────────────────--
  getReview(cycleId: string, assessmentId: string): ReviewModel | null {
    const a = this.assessment(assessmentId);
    if (cycleId !== seed.liveCycle.id || !a) return null;
    const excluded = this.excludedSet(cycleId, assessmentId);
    const refs = this.assessmentRefs(cycleId);
    const ref = refs.find((r) => r.id === assessmentId)!;

    const items: ItemRow[] = a.items.map((it) => ({
      id: it.id,
      wording: it.wording,
      major: it.major,
      sub: it.sub,
      demand: it.demand,
      pValue: it.pValue,
      itemTotal: it.itemTotal,
      pointBiserial: it.pointBiserial,
      discrimination: it.discrimination,
      overallReview: it.overallReview,
      qualityIndex: it.qualityIndex,
      excluded: excluded.has(it.id),
      reason: this.reasons.get(`${cycleId}:${assessmentId}:${it.id}`) ?? null,
    }));

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

    const retained = a.items.filter((it) => !excluded.has(it.id));
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
      { id: "overall", label: "Overall" },
    ];
    const scopeLabel = scopes.find((s) => s.id === scope)?.label ?? "Overall";

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

    const rows = seed.liveCycle.participants.map((p) => {
      const grades: Record<string, { level: string; stars: string }> = {};
      for (const a of seed.liveCycle.assessments) {
        const pct = pctMaps.get(a.id)?.get(p.id);
        const level = pct === undefined ? "" : classify(pct, perfLevels, cutsByScope.get(a.id)!);
        grades[a.id] = { level, stars: starsFor(level, this.grading.starMap) };
      }
      const op = overallPcts.get(p.id);
      return {
        id: p.id,
        label: p.label,
        grades,
        award: op === undefined ? "" : classify(op, awardLevels, awardCuts),
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
    } else {
      set.delete(itemId);
      this.reasons.delete(`${key}:${itemId}`);
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

    this.boundaries.set(key, { mode: input.mode ?? cur.mode, cuts, targets });
    this.bump();
  }

  setGradingDefaults(patch: Partial<GradingConfig>): void {
    this.grading = {
      ...this.grading,
      ...patch,
      starMap: { ...this.grading.starMap, ...(patch.starMap ?? {}) },
    };
    // Drop any boundary state that no longer matches the new band count so it
    // re-derives from the updated defaults.
    const perfLen = this.grading.performanceLevels.length - 1;
    const awardLen = this.grading.awardLevels.length - 1;
    for (const [key, st] of [...this.boundaries.entries()]) {
      const isAward = key.endsWith(":overall");
      if (st.cuts.length !== (isAward ? awardLen : perfLen)) this.boundaries.delete(key);
    }
    this.bump();
  }

  resolveDuplicates(cycleId: string, strategy: DuplicateStrategy): void {
    // MOCK: records the choice in memory only; no DB write and no row mutation.
    // The real provider will call a server action that rewrites the response set.
    void cycleId;
    void strategy;
    this.bump();
  }

  lockCycle(cycleId: string): void {
    if (this.user.role !== "lead_admin") return;
    this.locked.add(cycleId);
    this.bump();
  }
  unlockCycle(cycleId: string): void {
    if (this.user.role !== "lead_admin") return;
    this.locked.delete(cycleId);
    this.bump();
  }
}
