/**
 * Supabase → Seed hydration for the live provider.
 *
 * The DataProvider interface is synchronous and the InMemoryDataProvider already
 * computes every read-model from a `Seed` plus decision state. So the Supabase
 * provider hydrates a `Seed` from the database (using the real row UUIDs as the
 * Seed ids, so write RPCs can pass those ids straight through), then REPLAYS the
 * stored decisions through the in-memory provider's own mutators to reach a
 * faithful local state. Reads then delegate to that inner provider; writes go to
 * the SECURITY DEFINER RPCs (see supabase-provider.ts).
 *
 * Nothing here writes to the database — it is read + assemble only.
 *
 * Note on typing: the installed postgrest-js resolves `select("*")` rows to
 * `never` against a hand-written Database type, so we cast each result to the
 * hand-written Row interfaces in lib/types/database.ts (our source of truth).
 */
import type { SupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  ExamCycleRow,
  ExamYearRow,
  TestCentreRow,
  AssessmentRow,
  ItemRow,
  ItemStatsRow,
  ParticipantRow,
  ResponseRow,
  ItemReviewRow,
  CleanExclusionRow,
  GradeSchemeRow,
  GradeRow,
  EssayMarkRow,
  IncidentRow,
  AlterationRow,
  DistinctionStateRow,
  DistinctionOverrideRow,
  DocumentSettingsRow,
  WorkspaceSettingRow,
  ImportBatchRow,
  MemberRole,
} from "@/lib/types/database";
import type { CurrentUser, Role } from "./types";
import type {
  Seed,
  SeedAssessment,
  SeedItem,
  SeedResponse,
  SeedParticipant,
  SeedAssessmentDiagnostics,
  SeedPriorCycle,
  SeedTechnicalIncident,
} from "./seed-types";
import { isTechnicalIncidentStatus } from "./result-status";
import { ENGINE_VERSION, type QualityRating } from "@/lib/engine";
import { buildAssessmentDiagnostics, type DiagResponse } from "@/lib/diagnostics";
import type { EssayUploadRow, IncidentInput, IncidentDecisionInput } from "./provider";
import type { ValidationReport } from "@/lib/ingest/types";

type DB = SupabaseBrowserClient;

/** Run a select and cast the rows to our hand-written Row type. */
async function sel<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data } = await p;
  return (data ?? []) as T[];
}
async function selOne<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
  const { data } = await p;
  return (data ?? null) as T | null;
}

// ── assessment name → display + subject code ────────────────────────────────
interface NameInfo {
  shortName: string;
  rtl: boolean;
  order: number;
  subjectCode: "AFL" | "ESL" | "AM" | "ST" | null;
}
function classify(rawName: string): NameInfo {
  if (/[؀-ۿ]/.test(rawName) || /arabic/i.test(rawName))
    return { shortName: "Arabic 1st Lang", rtl: true, order: 3, subjectCode: "AFL" };
  if (/applicable math/i.test(rawName))
    return { shortName: "Applicable Math", rtl: false, order: 0, subjectCode: "AM" };
  if (/english/i.test(rawName))
    return { shortName: "English 2nd Lang", rtl: false, order: 1, subjectCode: "ESL" };
  if (/scientific/i.test(rawName))
    return { shortName: "Scientific", rtl: false, order: 2, subjectCode: "ST" };
  if (/life/i.test(rawName))
    return { shortName: "Life Skills", rtl: false, order: 4, subjectCode: null };
  return { shortName: rawName, rtl: false, order: 9, subjectCode: null };
}

const RATING_SCORE: Record<QualityRating, number> = { Good: 1, Review: 0.55, Flag: 0.12 };
function qualityIndex(s: { pRating: QualityRating; itRating: QualityRating; pbRating: QualityRating; discRating: QualityRating }): number {
  const avg = (RATING_SCORE[s.pRating] + RATING_SCORE[s.itRating] + RATING_SCORE[s.pbRating] + RATING_SCORE[s.discRating]) / 4;
  return Math.round(avg * 100);
}
function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "U";
}

// ── session → current user (invite-only via memberships) ────────────────────
export type SessionStatus = "ok" | "no-session" | "not-member";
export interface SessionUser {
  status: SessionStatus;
  user: CurrentUser | null;
}
function pickRole(roles: Role[]): Role {
  if (roles.includes("lead_admin")) return "lead_admin";
  if (roles.includes("reviewer")) return "reviewer";
  return "viewer";
}
export async function fetchSessionUser(supabase: DB): Promise<SessionUser> {
  const { data: auth } = await supabase.auth.getUser();
  const u = auth.user;
  if (!u) return { status: "no-session", user: null };

  const memberships = await sel<{ role: MemberRole }>(
    supabase.from("memberships").select("role").eq("user_id", u.id),
  );
  if (memberships.length === 0) return { status: "not-member", user: null };

  const role = pickRole(memberships.map((m) => m.role));
  const name =
    ((u.user_metadata?.full_name as string | undefined) ||
      (u.email ? u.email.split("@")[0] : undefined)) ??
    "User";
  return { status: "ok", user: { id: u.id, name, initials: initialsOf(name), role } };
}

// ── decision state replayed into the inner provider ─────────────────────────
export interface DecisionState {
  exclusions: { assessmentId: string; itemId: string; reason: string | null }[];
  /** Clean-stage non-destructive removals, grouped per subject. */
  cleanRemovals: { assessmentId: string; rows: string[]; cols: string[] }[];
  schemes: { scope: string; method: string; bands: { label: string; min: number; max: number }[] }[];
  locked: boolean;
  essays: EssayUploadRow[];
  incidents: IncidentInput[];
  /** Aligned to `incidents` order (inner ids become inc-1, inc-2, …). */
  incidentDecisions: (IncidentDecisionInput | null)[];
  distinctionConfirmed: boolean;
  distinctionOverrides: { studentId: string; reason: string }[];
  docSettings: Record<string, unknown> | null;
  workspace: Record<string, unknown>;
}
export interface Hydrated {
  seed: Seed;
  decisions: DecisionState;
  /** Id-resolution maps the provider needs to translate UI ids → DB ids for RPCs. */
  lookups: {
    /** qm_participant_id (A-A-…) → participant uuid (for essay-file uploads). */
    qmToUuid: Map<string, string>;
    /** essay subject code (AFL/ESL) → assessment uuid. */
    subjectCodeToAssessmentId: Map<string, string>;
    /** DB incident uuids in the same order they are replayed (→ inner inc-1, inc-2 …). */
    incidentDbIds: string[];
  };
}

// A brand-new cycle has no raw export yet: an empty-but-well-formed report so
// every reader (the Import screen reads `report.stats.mcqRows`) is safe before
// any upload. `stats` is required by ValidationReport — never leave it absent.
const EMPTY_VALIDATION: ValidationReport = {
  passed: true,
  checks: [],
  stats: { rawRows: 0, mcqRows: 0, droppedSurveyRows: 0, droppedNonMcqRows: 0, assessments: 0, participants: 0, items: 0 },
};
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export async function hydrate(supabase: DB): Promise<Hydrated | null> {
  const cycles = await sel<ExamCycleRow>(
    supabase.from("exam_cycles").select("*").order("created_at", { ascending: false }),
  );
  if (cycles.length === 0) return null;
  const live = cycles[0]!;
  const cycleId = live.id;

  // 0010 — test centres + the year→centre map, so each sitting resolves to its
  // centre (exam_cycles.year_id → exam_years.test_centre_id). Defensive against a
  // pre-0010 database (no rows / column): the provider falls back to a default
  // centre when the list is empty.
  const [testCentreRows, yearRows] = await Promise.all([
    sel<TestCentreRow>(supabase.from("test_centres").select("*").order("created_at", { ascending: true })),
    sel<ExamYearRow>(supabase.from("exam_years").select("*")),
  ]);
  const yearToCentre = new Map<string, string>();
  for (const y of yearRows) if (y.test_centre_id) yearToCentre.set(y.id, y.test_centre_id);
  const centreOfCycle = (c: ExamCycleRow): string | undefined =>
    c.year_id ? yearToCentre.get(c.year_id) : undefined;
  const seedTestCentres = testCentreRows.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    slug: t.slug,
    active: t.active,
  }));

  const [assessments, items, participants, responses] = await Promise.all([
    sel<AssessmentRow>(supabase.from("assessments").select("*").eq("cycle_id", cycleId)),
    sel<ItemRow>(supabase.from("items").select("*").eq("cycle_id", cycleId)),
    sel<ParticipantRow>(supabase.from("participants").select("*").eq("cycle_id", cycleId)),
    sel<ResponseRow>(supabase.from("responses").select("*").eq("cycle_id", cycleId)),
  ]);

  const itemIds = items.map((i) => i.id);
  const idFilter = itemIds.length ? itemIds : [ZERO_UUID];
  const [stats, reviews] = await Promise.all([
    sel<ItemStatsRow>(supabase.from("item_stats").select("*").in("item_id", idFilter)),
    sel<ItemReviewRow>(supabase.from("item_reviews").select("*").in("item_id", idFilter)),
  ]);

  const [schemes, grades, essayRows, incidentRows, alterationRows, distOverrides, workspace] =
    await Promise.all([
      sel<GradeSchemeRow>(supabase.from("grade_schemes").select("*").eq("cycle_id", cycleId)),
      sel<GradeRow>(supabase.from("grades").select("*").eq("cycle_id", cycleId)),
      sel<EssayMarkRow>(supabase.from("essay_marks").select("*").eq("cycle_id", cycleId)),
      sel<IncidentRow>(supabase.from("incidents").select("*").eq("cycle_id", cycleId).order("created_at", { ascending: true })),
      sel<AlterationRow>(supabase.from("alterations").select("*").eq("cycle_id", cycleId)),
      sel<DistinctionOverrideRow>(supabase.from("distinction_overrides").select("*").eq("cycle_id", cycleId)),
      sel<WorkspaceSettingRow>(supabase.from("workspace_settings").select("*")),
    ]);
  const cleanExclusionRows = await sel<CleanExclusionRow>(
    supabase.from("clean_exclusions").select("*").eq("cycle_id", cycleId),
  );
  const distState = await selOne<DistinctionStateRow>(
    supabase.from("distinction_state").select("*").eq("cycle_id", cycleId).maybeSingle(),
  );
  const docRow = await selOne<DocumentSettingsRow>(
    supabase.from("document_settings").select("*").eq("cycle_id", cycleId).maybeSingle(),
  );
  // Latest raw-export ingest batch — its stored validation report + file ref are
  // what the Upload screen shows after a refresh (proving persistence, and
  // surfacing any blocking issues from the original upload).
  const importBatch = await selOne<ImportBatchRow>(
    supabase
      .from("import_batches")
      .select("*")
      .eq("cycle_id", cycleId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );

  // Index helpers ----------------------------------------------------------
  const statByItem = new Map(stats.map((s) => [s.item_id, s]));
  const infoByAssessment = new Map(assessments.map((a) => [a.id, classify(a.name)] as const));
  const subjectCodeByAssessment = new Map(assessments.map((a) => [a.id, classify(a.name).subjectCode] as const));
  const itemAssessment = new Map(items.map((it) => [it.id, it.assessment_id]));

  const seedParticipants: SeedParticipant[] = participants
    .map((p, i) => ({
      id: p.id,
      // Real full name when present (RLS gates who can read it); fall back to the
      // pseudonym, then a positional placeholder, so the column is never blank.
      label: p.full_name || p.pseudonym_id || `Student ${String(i + 1).padStart(2, "0")}`,
      // Real Student ID (qm_participant_id) for display; the row UUID stays the key.
      studentId: p.qm_participant_id || p.pseudonym_id || p.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const respByAssessment = new Map<string, ResponseRow[]>();
  for (const r of responses) {
    const aId = itemAssessment.get(r.item_id);
    if (!aId) continue;
    (respByAssessment.get(aId) ?? respByAssessment.set(aId, []).get(aId)!).push(r);
  }

  const seedAssessments: (SeedAssessment & { _order: number })[] = [];
  const diagnostics: (SeedAssessmentDiagnostics & { _order: number })[] = [];
  const rate = (v: QualityRating | null): QualityRating => v ?? "Review";

  for (const a of assessments) {
    const info = infoByAssessment.get(a.id)!;
    const aItems = items.filter((it) => it.assessment_id === a.id);
    const aResp = respByAssessment.get(a.id) ?? [];

    const seedItems: SeedItem[] = aItems.map((it) => {
      const s = statByItem.get(it.id);
      const composite = { pRating: rate(s?.p_rating ?? null), itRating: rate(s?.it_rating ?? null), pbRating: rate(s?.pb_rating ?? null), discRating: rate(s?.disc_rating ?? null) };
      const presented = aResp.filter((r) => r.item_id === it.id);
      const answered = presented.filter((r) => r.answer_given != null);
      const times = answered.map((r) => r.response_time).filter((t): t is number => t != null && Number.isFinite(t));
      return {
        id: it.id,
        wording: it.wording,
        major: it.major_element,
        sub: it.sub_element,
        demand: it.demand_level,
        maxScore: it.max_score ?? 1,
        participantsAnswered: answered.length,
        participantsPresented: presented.length,
        avgResponseTime: times.length ? Math.round((times.reduce((x, y) => x + y, 0) / times.length) * 10) / 10 : null,
        pValue: s?.p_value ?? 0,
        pRating: composite.pRating,
        itemTotal: s?.item_total ?? null,
        itRating: composite.itRating,
        pointBiserial: s?.point_biserial ?? null,
        pbRating: composite.pbRating,
        discrimination: s?.discrimination ?? 0,
        discRating: composite.discRating,
        overallReview: rate(s?.overall_review ?? null),
        qualityIndex: qualityIndex(composite),
      };
    });

    const seedResponses: SeedResponse[] = aResp.map((r) => {
      const resp: SeedResponse = { p: r.participant_id, i: r.item_id, s: Number(r.answer_score) };
      if (r.answer_given == null) resp.a = false;
      return resp;
    });

    // Per-participant technical incidents from the sitting's result_status flag.
    const statusByP = new Map<string, string>();
    for (const r of aResp) {
      if (r.result_status && !statusByP.has(r.participant_id)) statusByP.set(r.participant_id, r.result_status);
    }
    const technicalIncidents: SeedTechnicalIncident[] = [...statusByP.entries()]
      .filter(([, status]) => isTechnicalIncidentStatus(status))
      .map(([p, status]) => ({ p, status }));

    const ordered = [...aResp].sort((x, y) => (x.created_at < y.created_at ? -1 : 1));
    const order = new Map<string, number>();
    for (const r of ordered) if (!order.has(r.item_id)) order.set(r.item_id, order.size);
    const demandByItem = new Map(aItems.map((it) => [it.id, it.demand_level]));
    const itemSetByItem = new Map(aItems.map((it) => [it.id, it.item_set]));
    const diagRecs: DiagResponse[] = aResp.map((r) => ({
      participantId: r.participant_id,
      itemId: r.item_id,
      demandLevel: demandByItem.get(r.item_id) ?? null,
      itemSet: itemSetByItem.get(r.item_id) ?? null,
      order: order.get(r.item_id) ?? 0,
      answered: r.answer_given != null,
      correct: Number(r.answer_score) === 1,
      responseTime: r.response_time,
    }));
    diagnostics.push({ assessmentId: a.id, assessmentName: a.name, ...buildAssessmentDiagnostics(diagRecs), _order: info.order });

    seedAssessments.push({
      id: a.id,
      name: a.name,
      shortName: info.shortName,
      rtl: info.rtl,
      stageIndex: 1,
      items: seedItems,
      responses: seedResponses,
      technicalIncidents,
      _order: info.order,
    });
  }

  seedAssessments.sort((a, b) => a._order - b._order);
  diagnostics.sort((a, b) => a._order - b._order);

  // The stored validation report (if a raw export has been ingested) drives the
  // Upload screen's validation panel + blocking-issue gating across refreshes.
  const ingestReport =
    (importBatch?.report_json as ValidationReport | null | undefined) ?? null;
  const ingestValidation: ValidationReport = ingestReport ?? EMPTY_VALIDATION;
  // Name the upload from the real 3-CSV source filenames (the assessments export
  // is the representative); fall back through the others, then to a neutral
  // 3-CSV label. NOT the legacy single-file "exam_export.xlsx" default.
  const ingestFileName =
    importBatch?.file_ref ||
    importBatch?.assessments_file ||
    importBatch?.items_file ||
    importBatch?.topics_file ||
    "Questionmark CSV exports";
  // Real combined size persisted at ingest (migration 0009); 0 when unknown.
  const ingestFileSizeMB = importBatch?.file_size_mb ?? 0;
  // The three QM CSVs recognised at ingest (migration 0006 columns). null per kind
  // when absent (legacy single-file rows) — the Upload step then shows that kind as
  // missing/unrecognised rather than inventing a filename.
  const ingestFiles = {
    items: importBatch?.items_file ?? null,
    assessments: importBatch?.assessments_file ?? null,
    topics: importBatch?.topics_file ?? null,
  };
  const ingestDuplicates = ingestReport?.checks.find((c) => c.id === "duplicates")?.count ?? 0;

  const priorCycles: SeedPriorCycle[] = cycles.slice(1).map((c) => ({
    id: c.id,
    name: c.name,
    testCentreId: centreOfCycle(c),
    yearId: c.year_id ?? undefined,
    stageIndex: 7,
    stepsDone: 8,
    participants: 0,
    assessments: 0,
    lastActivity: new Date(c.updated_at).toLocaleDateString(),
    locked: c.status === "locked",
    mock: false,
  }));

  const seed: Seed = {
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    testCentres: seedTestCentres.length > 0 ? seedTestCentres : undefined,
    liveCycle: {
      id: cycleId,
      name: live.name,
      region: live.region,
      testCentreId: centreOfCycle(live),
      yearId: live.year_id ?? undefined,
      startedAt: new Date(live.created_at).toLocaleDateString(),
      lastActivity: new Date(live.updated_at).toLocaleString(),
      stageIndex: stageIndexFromStatus(live.status),
      fileName: ingestFileName,
      fileSizeMB: ingestFileSizeMB,
      files: ingestFiles,
      uploadedAgo: importBatch ? new Date(importBatch.created_at).toLocaleString() : new Date(live.created_at).toLocaleDateString(),
      validation: ingestValidation,
      preview: { headers: [], rows: [] },
      duplicates: ingestDuplicates,
      participants: seedParticipants,
      assessments: seedAssessments.map(({ _order, ...a }) => { void _order; return a; }),
      diagnostics: diagnostics.map(({ _order, ...d }) => { void _order; return d; }),
    },
    priorCycles,
  };

  // ── decision state ────────────────────────────────────────────────────
  const excluded = new Set([
    ...items.filter((it) => it.status === "excluded").map((it) => it.id),
    ...reviews.filter((r) => r.exclude).map((r) => r.item_id),
  ]);
  const reasonByItem = new Map(reviews.map((r) => [r.item_id, r.reason]));
  const exclusions = [...excluded]
    .map((itemId) => ({ itemId, assessmentId: itemAssessment.get(itemId) ?? "", reason: reasonByItem.get(itemId) ?? null }))
    .filter((e) => e.assessmentId);

  const essays: EssayUploadRow[] = essayRows
    .map((e) => {
      const code = subjectCodeByAssessment.get(e.assessment_id);
      if (code !== "AFL" && code !== "ESL") return null;
      return { participantId: e.participant_id, subjectCode: code, totalScore: Number(e.mark) };
    })
    .filter((r): r is EssayUploadRow => r !== null);

  const altByIncident = new Map(alterationRows.filter((a) => a.incident_id).map((a) => [a.incident_id!, a]));
  const incidents: IncidentInput[] = incidentRows.map((r) => ({
    source: r.source,
    studentName: r.student_name ?? "",
    exam: r.exam ?? undefined,
    issueType: r.issue_type ?? undefined,
    actionTaken: r.action_taken ?? undefined,
    questionsAffected: r.questions_affected ?? undefined,
    staff: r.staff ?? undefined,
    email: r.email ?? undefined,
    school: r.school ?? undefined,
    description: r.description ?? undefined,
  }));
  const incidentDecisions: (IncidentDecisionInput | null)[] = incidentRows.map((r) => {
    const al = altByIncident.get(r.id);
    if (!al) return null;
    return { applyTo: al.apply_to, studentId: al.participant_id, subjectId: al.assessment_id, marks: Number(al.marks), reason: al.reason };
  });

  // Clean-stage removals, grouped per subject (rows = participants, cols = items).
  const cleanByAssessment = new Map<string, { rows: string[]; cols: string[] }>();
  for (const r of cleanExclusionRows) {
    const g = cleanByAssessment.get(r.assessment_id) ?? { rows: [], cols: [] };
    (r.kind === "row" ? g.rows : g.cols).push(r.target_id);
    cleanByAssessment.set(r.assessment_id, g);
  }
  const cleanRemovals = [...cleanByAssessment.entries()].map(([assessmentId, g]) => ({ assessmentId, ...g }));

  const decisions: DecisionState = {
    exclusions,
    cleanRemovals,
    schemes: schemes.map((s) => ({ scope: s.scope, method: s.method, bands: s.bands })),
    locked: grades.some((g) => g.locked),
    essays,
    incidents,
    incidentDecisions,
    distinctionConfirmed: distState?.confirmed ?? false,
    distinctionOverrides: distOverrides.map((o) => ({ studentId: o.participant_id, reason: o.reason })),
    docSettings: (docRow?.settings as Record<string, unknown> | undefined) ?? null,
    workspace: Object.fromEntries(workspace.map((w) => [w.key, w.value])),
  };

  const subjectCodeToAssessmentId = new Map<string, string>();
  for (const a of assessments) {
    const code = classify(a.name).subjectCode;
    if (code) subjectCodeToAssessmentId.set(code, a.id);
  }
  const lookups = {
    qmToUuid: new Map(participants.map((p) => [p.qm_participant_id, p.id])),
    subjectCodeToAssessmentId,
    incidentDbIds: incidentRows.map((r) => r.id),
  };

  return { seed, decisions, lookups };
}

function stageIndexFromStatus(status: string): number {
  // 10-stage order: Upload(0) Clean(1) Raw scores(2) Question review(3)
  // Diagnostics(4) Essay marks(5) Technical adjustments(6) Score(7)
  // Cut scores(8) Grades(9). Grades is the final per-sitting step — document
  // generation lives at the cycle/overall level, not on a sitting.
  switch (status) {
    case "draft":
    case "ingested": return 0;
    case "validated": return 1; // Clean
    case "in_review": return 3; // Question review
    case "scored": return 7; // Score (computed post-adjustment)
    case "graded": return 9; // Grades
    case "locked": return 9; // Grades (signed off) — terminal per-sitting step
    default: return 1;
  }
}
