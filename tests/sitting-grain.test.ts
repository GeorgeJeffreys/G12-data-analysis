/**
 * Sitting-grain persistence + cleaned export (task 17, grade-bearing).
 *
 * Root cause of the ~7-per-subject collapse: `responses` was keyed at the
 * PARTICIPANT × question grain (one synthetic id per participant email), so a
 * participant's separate subject-sittings folded into one identity and the cleaned
 * export minted one "ResultId" per participant that spanned multiple subjects.
 *
 * The fix keys the persisted facts at the SITTING × question grain (the QM
 * `ResultId` carried as `qm_result_id`), with the participant email as a SEPARATE
 * column. This locks:
 *   1. Every persisted response carries its sitting key; uniqueness is
 *      (item_id, qm_result_id), never (participant_id, item_id).
 *   2. Distinct sitting-records ≫ distinct participants (NOT 15 = 15).
 *   3. Each participant holds exactly one sitting per real subject they sat.
 *   4. The cleaned export's ResultId is the sitting; ParticipantEmail is populated
 *      and distinct from it; distinct ResultIds ≫ distinct emails across subjects.
 *   5. Per-subject distinct participants stay 15/12/12/9/11 (raw roster).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ingestThreeExports, type NamedInput } from "@/lib/ingest/qm";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { CLEANED_DATA_COLUMNS } from "@/lib/data/cleaned-schema";
import { scoreDatasetCsv } from "@/lib/ui/analysis-exports";
import { makeRpcAdmin, type RpcCall } from "./helpers/mock-rpc-admin";
import { makeSupabaseReadClient, type MockDb } from "./helpers/mock-supabase-read";

vi.mock("server-only", () => ({}));

const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const read = (n: string) => readFileSync(path.join(qmDir, `${n}.csv`));
const files = (): NamedInput[] => [
  { name: "Items.csv", data: read("Items") },
  { name: "Assessments.csv", data: read("Assessments") },
  { name: "Topics.csv", data: read("Topics") },
];

const CYCLE = "00000000-0000-0000-0000-0000000000dd";

async function ingestPayload() {
  const { ingestCleanResponses } = await import("@/lib/server/ingest-write");
  const { cleanedResponses, canonical, validationReport } = ingestThreeExports(files());
  const calls: RpcCall[] = [];
  const admin = makeRpcAdmin(calls);
  await ingestCleanResponses(admin as never, CYCLE, cleanedResponses, {
    createdBy: "11111111-1111-1111-1111-111111111111",
    canonical,
    report: validationReport,
  });
  return { payload: calls[0]!.args.p_payload, canonical };
}

async function buildProvider() {
  const { hydrate } = await import("@/lib/data/supabase-hydrate");
  const { payload } = await ingestPayload();
  const db: MockDb = {
    exam_cycles: [{ id: CYCLE, name: "Sitting 700435", region: "EU", status: "validated", created_at: "2026-05-01", updated_at: "2026-05-01", year_id: null }],
    assessments: payload.assessments,
    items: payload.items,
    participants: payload.participants,
    responses: (payload.responses as Record<string, unknown>[]).map((r, i) => ({ ...r, created_at: `2026-05-01T00:00:${String(i % 60).padStart(2, "0")}Z` })),
    item_stats: [], item_reviews: [], grade_schemes: [], grades: [], essay_marks: [],
    incidents: [], alterations: [], distinction_overrides: [], workspace_settings: [],
    element_labels: [], clean_exclusions: [], distinction_state: [], document_settings: [],
    import_batches: [{ cycle_id: CYCLE, created_at: "2026-05-01", file_ref: "qm", items_file: "Items.csv", assessments_file: "Assessments.csv", topics_file: "Topics.csv", file_size_mb: 1 }],
    test_centres: [], exam_years: [], sittings: payload.sittings, topic_rollups: payload.topic_rollups,
  };
  const hydrated = await hydrate(makeSupabaseReadClient(db) as never);
  if (!hydrated) throw new Error("hydrate returned null");
  return new InMemoryDataProvider(hydrated.seed);
}

describe("sitting-grain persistence", () => {
  it("every persisted response carries a sitting key; uniqueness is (qm_result_id, question_id)", async () => {
    const { payload } = await ingestPayload();
    const responses = payload.responses as Record<string, unknown>[];
    expect(responses.length).toBeGreaterThan(0);

    // Every response has its sitting key + question key, and it is NOT the participant id.
    for (const r of responses) {
      expect(r.qm_result_id, "response missing qm_result_id").toBeTruthy();
      expect(r.question_id, "response missing question_id").toBeTruthy();
      expect(r.qm_result_id).not.toBe(r.participant_id);
    }

    // Uniqueness at the natural sitting × question grain (migration 0026) — no
    // collision. This is the authoritative key that prevents whole-sitting collapse.
    const sittingKey = new Set(responses.map((r) => `${r.qm_result_id}|${r.question_id}`));
    expect(sittingKey.size).toBe(responses.length);

    // Distinct sitting-records ≫ distinct participants (NOT 15 = 15).
    const sittings = new Set(responses.map((r) => r.qm_result_id));
    const participants = new Set(responses.map((r) => r.participant_id));
    expect(sittings.size).toBeGreaterThan(participants.size);
    // 59 graded sittings across the cycle vs 18 participants in the fixture.
    expect(participants.size).toBe(18);
    expect(sittings.size).toBe(59);
  });

  it("each participant holds exactly one sitting per real subject they sat", async () => {
    const { payload } = await ingestPayload();
    const responses = payload.responses as Record<string, unknown>[];
    const itemAssessment = new Map(
      (payload.items as Record<string, unknown>[]).map((it) => [it.id as string, it.assessment_id as string]),
    );
    // (participant, assessment) → set of sitting ids. Each must be exactly one.
    const byPartSubject = new Map<string, Set<string>>();
    for (const r of responses) {
      const aId = itemAssessment.get(r.item_id as string)!;
      const key = `${r.participant_id}|${aId}`;
      (byPartSubject.get(key) ?? byPartSubject.set(key, new Set()).get(key)!).add(r.qm_result_id as string);
    }
    for (const [key, sittings] of byPartSubject) {
      expect(sittings.size, `one sitting per participant×subject for ${key}`).toBe(1);
    }
  });
});

describe("cleaned export — sitting ResultId + populated ParticipantEmail", () => {
  let provider: InMemoryDataProvider;
  beforeAll(async () => { provider = await buildProvider(); });

  const col = (name: string) => CLEANED_DATA_COLUMNS.indexOf(name as never);

  it("master dataset: distinct ResultIds ≫ distinct ParticipantEmails, both populated", () => {
    const ds = provider.getCleanedMasterDataset(CYCLE)!;
    const ri = col("ResultId");
    const ei = col("ParticipantEmail");
    const sittings = new Set<string>();
    const emails = new Set<string>();
    for (const r of ds.rows) {
      expect(r[ri], "ResultId populated").toBeTruthy();
      expect(r[ei], "ParticipantEmail populated").toBeTruthy();
      expect(r[ri]).not.toBe(r[ei]); // sitting id is never the participant email
      sittings.add(r[ri]!);
      emails.add(r[ei]!);
    }
    // Not 15 = 15: the sittings far outnumber the participants across subjects.
    expect(sittings.size).toBeGreaterThan(emails.size);
    expect(emails.size).toBe(ds.retained.participants);
  });

  it("per subject, distinct ResultIds == distinct participants (roster 15/12/12/9/11)", () => {
    const cycle = provider.getCycle(CYCLE)!;
    const want: Record<string, number> = {};
    const bySubjectRe: [RegExp, number][] = [
      [/Applicable Math$/, 15],
      [/English/, 12],
      [/Scientific/, 12],
      [/العربيّة/, 9],
      [/Life/, 11],
    ];
    for (const a of cycle.assessments) {
      const model = provider.getCleanedData(CYCLE, a.id);
      if (!model) continue;
      const ri = col("ResultId");
      const ei = col("ParticipantEmail");
      const sittings = new Set(model.rows.map((r) => r[ri]));
      const emails = new Set(model.rows.map((r) => r[ei]));
      // one sitting per participant within a subject
      expect(sittings.size).toBe(emails.size);
      const match = bySubjectRe.find(([re]) => re.test(a.name));
      if (match) want[a.name] = sittings.size, expect(sittings.size, `count for ${a.name}`).toBe(match[1]);
    }
    expect(Object.keys(want).length).toBe(5);
  });

  it("the Raw-data dataset CSV keys ResultId on the sitting (≫ participants)", () => {
    const data = provider.getScoreAnalysisData(CYCLE, true)!;
    const { headers, rows } = scoreDatasetCsv(data);
    const ri = headers.indexOf("ResultId");
    expect(ri).toBe(0);
    const sittings = new Set(rows.map((r) => r[ri]));
    const participantIds = new Set(data.participants.map((p) => p.id));
    // One sitting per participant × subject → sittings far exceed participants.
    expect(sittings.size).toBeGreaterThan(participantIds.size);
    // And no ResultId equals a participant row id (the old collapse).
    for (const s of sittings) expect(participantIds.has(s as string)).toBe(false);
  });
});
