/**
 * Speededness & timing diagnostics — informational, computed from the raw QM
 * export (response-time + answer columns), exactly as the team's Python notebooks
 * do. These never affect grading; they flag whether an assessment was speeded
 * (students running out of time) and whether time-on-task relates to score.
 *
 * Definitions (matched to the notebooks):
 *  - Omission rate   = omitted presentations ÷ total (omitted = blank answer).
 *  - Completion      = 1 − omission.
 *  - Late items      = final 25% of unique items by earliest presented order,
 *                      ceil(0.25 × n_items), min 1; early items = the rest.
 *  - Speededness Index = ( max(0, lateOmission − earlyOmission)
 *                          + max(0, earlyAccuracy − lateAccuracy) ) ÷ 2,
 *                      where accuracy = correct ÷ answered (among attempts).
 *  - Timing–performance: aggregate to student level (score %, median item time),
 *                      then Pearson + Spearman between median item time and
 *                      score %.
 */

export interface DiagResponse {
  participantId: string;
  itemId: string;
  majorElement: string | null;
  /** Presentation order (lower = earlier). */
  order: number;
  /** Whether a (non-blank) answer was given. */
  answered: boolean;
  /** Whether the answer was correct (score === 1). */
  correct: boolean;
  /** Response time in seconds; null when missing. */
  responseTime: number | null;
}

export type DiagStatus = "Good" | "Review" | "Flag";

export interface SpeededResult {
  nItems: number;
  nPresentations: number;
  omissionRate: number;
  completion: number;
  speedednessIndex: number;
  earlyOmission: number;
  lateOmission: number;
  earlyAccuracy: number;
  lateAccuracy: number;
  omissionStatus: DiagStatus;
  completionStatus: DiagStatus;
  speededStatus: DiagStatus;
}

export interface TimingResult {
  nStudents: number;
  pearson: number | null;
  spearman: number | null;
  pearsonStrength: string;
  spearmanStrength: string;
}

const rnd = (v: number, d = 4) => {
  const f = 10 ** d;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
};

/** Pearson product-moment correlation; null when either side has zero variance. */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n < 2 || y.length !== n) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i]!, yi = y[i]!;
    sx += xi; sy += yi; sxx += xi * xi; syy += yi * yi; sxy += xi * yi;
  }
  const denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (denom === 0) return null;
  return (n * sxy - sx * sy) / denom;
}

/** Fractional ranks (ties get the average rank), for Spearman. */
function rank(values: readonly number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]!.v === idx[i]!.v) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank
    for (let k = i; k <= j; k++) ranks[idx[k]!.i] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation = Pearson on ranks. */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length || x.length < 2) return null;
  return pearson(rank(x), rank(y));
}

export function correlationStrength(r: number | null): string {
  if (r === null) return "Undefined";
  const a = Math.abs(r);
  const dir = r < 0 ? "negative" : "positive";
  if (a < 0.1) return "Negligible";
  if (a < 0.3) return `Weak ${dir}`;
  if (a < 0.5) return `Moderate ${dir}`;
  if (a < 0.7) return `Strong ${dir}`;
  return `Very strong ${dir}`;
}

const band = (v: number, good: (x: number) => boolean, review: (x: number) => boolean): DiagStatus =>
  good(v) ? "Good" : review(v) ? "Review" : "Flag";

/** The late-item set: the final 25% of unique items by earliest presented order. */
export function lateItemIds(records: readonly DiagResponse[]): Set<string> {
  const earliest = new Map<string, number>();
  for (const r of records) {
    const cur = earliest.get(r.itemId);
    if (cur === undefined || r.order < cur) earliest.set(r.itemId, r.order);
  }
  const ordered = [...earliest.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const nLate = Math.max(1, Math.ceil(0.25 * ordered.length));
  return new Set(ordered.slice(ordered.length - nLate));
}

/** Speededness / omission / completion over one group of responses. */
export function speededness(records: readonly DiagResponse[]): SpeededResult {
  const items = new Set(records.map((r) => r.itemId));
  const late = lateItemIds(records);
  const nPres = records.length;
  const omitted = records.filter((r) => !r.answered).length;
  const omissionRate = nPres ? omitted / nPres : 0;

  const omissionOf = (set: (r: DiagResponse) => boolean) => {
    const sub = records.filter(set);
    return sub.length ? sub.filter((r) => !r.answered).length / sub.length : 0;
  };
  const accuracyOf = (set: (r: DiagResponse) => boolean) => {
    const answered = records.filter((r) => set(r) && r.answered);
    return answered.length ? answered.filter((r) => r.correct).length / answered.length : 0;
  };

  const isLate = (r: DiagResponse) => late.has(r.itemId);
  const earlyOmission = omissionOf((r) => !isLate(r));
  const lateOmission = omissionOf(isLate);
  const earlyAccuracy = accuracyOf((r) => !isLate(r));
  const lateAccuracy = accuracyOf(isLate);

  const speedednessIndex = (Math.max(0, lateOmission - earlyOmission) + Math.max(0, earlyAccuracy - lateAccuracy)) / 2;

  return {
    nItems: items.size,
    nPresentations: nPres,
    omissionRate: rnd(omissionRate),
    completion: rnd(1 - omissionRate),
    speedednessIndex: rnd(speedednessIndex),
    earlyOmission: rnd(earlyOmission),
    lateOmission: rnd(lateOmission),
    earlyAccuracy: rnd(earlyAccuracy),
    lateAccuracy: rnd(lateAccuracy),
    omissionStatus: band(omissionRate, (v) => v <= 0.05, (v) => v <= 0.1),
    completionStatus: band(1 - omissionRate, (v) => v >= 0.95, (v) => v >= 0.9),
    speededStatus: band(speedednessIndex, (v) => v <= 0.05, (v) => v <= 0.15),
  };
}

/** Median of a numeric array. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Timing–performance correlation over one group of responses. */
export function timingPerformance(records: readonly DiagResponse[]): TimingResult {
  // Aggregate to student level: score % (correct ÷ presented) and median item time.
  const byStudent = new Map<string, { correct: number; presented: number; times: number[] }>();
  for (const r of records) {
    let s = byStudent.get(r.participantId);
    if (!s) { s = { correct: 0, presented: 0, times: [] }; byStudent.set(r.participantId, s); }
    s.presented += 1;
    if (r.correct) s.correct += 1;
    if (r.responseTime !== null && Number.isFinite(r.responseTime)) s.times.push(r.responseTime);
  }
  const scorePct: number[] = [];
  const medTime: number[] = [];
  for (const s of byStudent.values()) {
    if (s.presented === 0 || s.times.length === 0) continue;
    scorePct.push((s.correct / s.presented) * 100);
    medTime.push(median(s.times));
  }
  const p = pearson(medTime, scorePct);
  const sp = spearman(medTime, scorePct);
  return {
    nStudents: scorePct.length,
    pearson: p === null ? null : rnd(p),
    spearman: sp === null ? null : rnd(sp),
    pearsonStrength: correlationStrength(p),
    spearmanStrength: correlationStrength(sp),
  };
}

/** Group records by a key, preserving first-seen order. */
export function groupBy<T>(rows: readonly T[], key: (r: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k == null || k === "") continue;
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}
