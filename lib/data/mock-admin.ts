/**
 * Static fixtures for the admin/analytics areas. Members, roles and the prior
 * cycles here are MOCK (clearly labelled in the UI) — there is no real auth or
 * cross-cycle history yet. The item-quality thresholds are the engine's REAL
 * active rating rules (display-only), mirroring `lib/engine/stats.ts`.
 */
import type {
  AuditEntry,
  Capability,
  Member,
  QualityThresholdRow,
  RoleDef,
} from "./types";

export const ROLE_LEAD = "role-lead";
export const ROLE_DS = "role-ds";

export const DEFAULT_ROLES: RoleDef[] = [
  { id: ROLE_LEAD, name: "G12 Lead", isLead: true, memberCount: 0 },
  { id: ROLE_DS, name: "Data Scientist", isLead: false, memberCount: 0 },
];

export const CAPABILITY_GROUPS: { group: string; capabilities: Capability[] }[] = [
  {
    group: "Cycle pipeline",
    capabilities: [
      { id: "cap-create", group: "Cycle pipeline", label: "Create a cycle" },
      { id: "cap-upload", group: "Cycle pipeline", label: "Upload / replace an export" },
      { id: "cap-validate", group: "Cycle pipeline", label: "Resolve validation issues" },
      { id: "cap-review", group: "Cycle pipeline", label: "Review & exclude items" },
      { id: "cap-boundaries", group: "Cycle pipeline", label: "Set grade boundaries" },
      { id: "cap-lock", group: "Cycle pipeline", label: "Lock & sign off grades" },
      { id: "cap-reopen", group: "Cycle pipeline", label: "Re-open a locked cycle" },
    ],
  },
  {
    group: "Output",
    capabilities: [{ id: "cap-certs", group: "Output", label: "Generate certificates & reports" }],
  },
  {
    group: "Admin & analytics",
    capabilities: [
      { id: "cap-analytics", group: "Admin & analytics", label: "View analytics" },
      { id: "cap-users", group: "Admin & analytics", label: "Manage users" },
      { id: "cap-settings", group: "Admin & analytics", label: "Edit settings" },
    ],
  },
];

export const ALL_CAPABILITY_IDS = CAPABILITY_GROUPS.flatMap((g) => g.capabilities.map((c) => c.id));

/** Default grant matrix: Lead = everything; Data Scientist = all but sign-off/admin/create. */
export function defaultMatrix(): Record<string, Record<string, boolean>> {
  const lead: Record<string, boolean> = {};
  const ds: Record<string, boolean> = {};
  for (const id of ALL_CAPABILITY_IDS) {
    lead[id] = true;
    ds[id] = !["cap-create", "cap-lock", "cap-reopen", "cap-certs", "cap-users", "cap-settings"].includes(id);
  }
  return { [ROLE_LEAD]: lead, [ROLE_DS]: ds };
}

export function defaultMembers(): Member[] {
  return [
    { id: "m-rana", name: "Rana Mansour", email: "rana.mansour@alsamaproject.com", roleId: ROLE_LEAD, roleName: "G12 Lead", status: "active", lastActive: "2h ago", isCurrent: true },
    { id: "m-sami", name: "Sami Haddad", email: "s.haddad@alsamaproject.com", roleId: ROLE_DS, roleName: "Data Scientist", status: "active", lastActive: "Yesterday", isCurrent: false },
    { id: "m-karim", name: "Karim Osman", email: "k.osman@alsamaproject.com", roleId: ROLE_DS, roleName: "Data Scientist", status: "invited", lastActive: "Invite sent 3d ago", isCurrent: false },
  ];
}

/** A few illustrative audit entries so the log isn't empty before any action. */
export function seedAuditEntries(cycleId: string): AuditEntry[] {
  const now = Date.now();
  const mins = (m: number) => new Date(now - m * 60000).toISOString();
  const e = (
    id: string,
    tsMin: number,
    actorName: string,
    actorRole: string,
    type: AuditEntry["type"],
    action: string,
    detail: string,
  ): AuditEntry => ({
    id, ts: mins(tsMin), actorId: actorName === "Rana Mansour" ? "m-rana" : "m-sami",
    actorName, actorRole, type, action, detail, cycleId, seeded: true,
  });
  return [
    e("a1", 200, "Sami Haddad", "Data Scientist", "exclude", "Excluded item", "Q23 — reason: negative discrimination"),
    e("a2", 215, "Sami Haddad", "Data Scientist", "exclude", "Excluded item", "Q31 — reason: ambiguous wording"),
    e("a3", 320, "Sami Haddad", "Data Scientist", "export", "Exported data", "Cleaned response matrix (English 2nd Lang)"),
    e("a4", 1700, "Rana Mansour", "G12 Lead", "upload", "Re-uploaded export", "Arabic 1st Lang — corrected duplicate submissions"),
    e("a5", 1760, "Rana Mansour", "G12 Lead", "boundary", "Changed boundary", "Meets cut 40% → 42% (English 2nd Lang)"),
  ];
}

/** The engine's REAL active rating thresholds (see lib/engine/stats.ts) — display-only. */
export const QUALITY_THRESHOLDS: QualityThresholdRow[] = [
  { metric: "p-value (difficulty)", good: "0.30 – 0.85", review: "0.20–0.30 / 0.85–0.90", flag: "< 0.20 / > 0.90" },
  { metric: "Item-total correlation", good: "≥ 0.30", review: "0.10 – 0.30", flag: "< 0.10 / undefined" },
  { metric: "Point-biserial", good: "≥ 0.30", review: "0.10 – 0.30", flag: "< 0.10 / undefined" },
  { metric: "Discrimination", good: "≥ 0.30", review: "0.10 – 0.30", flag: "< 0.10" },
];

// --- Analytics: MOCK prior cycles (no real history yet) ----------------------
// Only the *live* cycle's aggregates are real; these priors are illustrative.
export const ANALYTICS_CYCLE_LABELS = ["May 25", "Nov 25", "Jan 26", "May 26"];
/** Full cycle names (parallel to ANALYTICS_CYCLE_LABELS) for explicit labelling. */
export const ANALYTICS_CYCLE_NAMES = ["May 2025", "November 2025", "January 2026", "May 2026"];

export interface MockPrior {
  label: string;
  participants: number;
  cohortMean: number;
  median: number;
  sd: number;
  itemsScored: number;
  itemsExcluded: number;
  meanQuality: number;
  /** award-distribution percentages keyed by award level. */
  awardDist: Record<string, number>;
  /** per-assessment cohort mean, keyed by assessment id. */
  byAssessment: Record<string, number>;
}

// --- Compare cycles: per-subject MOCK metrics for prior cycles ---------------
// There is no real per-subject psychometric history for prior cycles in this
// build (the seed marks them mock with no item-level data). To keep the Compare
// cycles charts meaningful, prior columns use these deterministic, clearly
// MOCK-labelled per-subject figures — consistent with the mock-priors
// convention already used by Trends/Compare. Only the live cycle is real.

export interface MockCompareSubject {
  participants: number;
  scoreMean: number;
  scoreMedian: number;
  scoreMax: number;
  avgPValue: number;
  avgPointBiserial: number;
  alpha: number;
  itemsUsable: number;
  itemsRemoved: number;
}

/** Deterministic 0..1 hash from a string seed (no external deps). */
function seededUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // map to [0,1)
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Deterministic mock per-subject metrics for a prior cycle, keyed by assessment
 * id. `cycleSeed` (e.g. the cycle id) varies the figures between cycles; the
 * `itemCount`/`maxRaw` anchor usable-item and cut-score scales to the subject.
 */
export function mockCompareSubjects(
  cycleSeed: string,
  subjects: { id: string; itemCount: number }[],
): Record<string, MockCompareSubject> {
  const out: Record<string, MockCompareSubject> = {};
  for (const s of subjects) {
    const u = (k: string) => seededUnit(`${cycleSeed}|${s.id}|${k}`);
    const removed = Math.round(2 + u("rm") * 5); // 2..7 removed
    const usable = Math.max(1, s.itemCount - removed);
    const mean = Math.round(40 + u("mean") * 28); // 40..68 %
    out[s.id] = {
      participants: Math.round(9 + u("part") * 9), // 9..18
      scoreMean: mean,
      scoreMedian: Math.min(100, Math.max(0, mean + Math.round((u("med") - 0.5) * 6))),
      scoreMax: s.itemCount,
      avgPValue: Math.round((0.33 + u("p") * 0.35) * 100) / 100, // .33..0.68
      avgPointBiserial: Math.round((0.18 + u("rp") * 0.16) * 100) / 100, // .18..0.34
      alpha: Math.round((0.68 + u("a") * 0.16) * 100) / 100, // .68..0.84
      itemsUsable: usable,
      itemsRemoved: removed,
    };
  }
  return out;
}

/** Mock priors for the three sittings before the live cycle (oldest → newest). */
export function mockPriors(awardLevels: string[], assessmentIds: string[]): MockPrior[] {
  const award = (a: number, b: number, c: number, d: number): Record<string, number> =>
    Object.fromEntries(awardLevels.map((lvl, i) => [lvl, [a, b, c, d][i] ?? 0]));
  const per = (vals: number[]): Record<string, number> =>
    Object.fromEntries(assessmentIds.map((id, i) => [id, vals[i % vals.length] ?? 0]));
  return [
    { label: "May 25", participants: 15, cohortMean: 44.1, median: 45, sd: 12.4, itemsScored: 188, itemsExcluded: 6, meanQuality: 62, awardDist: award(6, 18, 40, 36), byAssessment: per([42, 47, 41, 52, 55]) },
    { label: "Nov 25", participants: 16, cohortMean: 45.6, median: 46, sd: 12.9, itemsScored: 190, itemsExcluded: 5, meanQuality: 66, awardDist: award(8, 21, 39, 32), byAssessment: per([44, 48, 43, 53, 57]) },
    { label: "Jan 26", participants: 17, cohortMean: 46.4, median: 47, sd: 13.2, itemsScored: 191, itemsExcluded: 4, meanQuality: 68, awardDist: award(9, 24, 34, 33), byAssessment: per([45, 49, 44, 54, 58]) },
  ];
}
