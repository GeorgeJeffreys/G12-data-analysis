/**
 * LIVE hydrate-path per-(participant × subject) bucketing — the FIRST regression
 * test to exercise the naive-overall + grades exports through the real Supabase
 * hydrate path (P1-followup to #22).
 *
 * Why this path: #22 fixed the in-memory `buildLiveCycleData` assembly and proved
 * it with engine tests, but the deployed app reads through `hydrate()` → seed →
 * InMemoryDataProvider, which the in-memory tests never touch. This test ingests
 * the real 3-CSV May-2026 fixture exactly as the app would, persists it the way
 * `ingest_persist` stores it, hydrates a Seed from those rows, and reconciles the
 * resulting naive-overall + grades exports against the gold matrix.
 *
 * Findings it pins:
 *   1. SCORE COLLAPSE IS NOT REPRODUCED ON FRESH DATA — every one of the 16 real
 *      students reconciles EXACTLY to the gold per-(participant,subject) matrix
 *      through the hydrate path (the deployed export's collapse was stale pre-#22
 *      data — Step 0).
 *   2. COHORT-EXCLUSION CARRY-THROUGH — once the two non-cohort participants
 *      (P0010 "lavinia" English-only, P0011 "muamina" re-sit-only/zero — the two
 *      with no cohort ResultGroupName) are excluded, BOTH the naive-overall and
 *      grades exports must OMIT them. Before the fix the naive-overall export still
 *      listed them as all-zero rows ("P0010/P0011 still present").
 *   3. INVARIANTS — the unique-key + #in==#out guards from #22 now also fire in the
 *      hydrate assembly and the export generation, so a future collapse fails loud.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestThreeExports } from "@/lib/ingest/qm";
import { makeSupabaseReadClient, type MockDb } from "@/tests/helpers/mock-supabase-read";
import { hydrate } from "@/lib/data/supabase-hydrate";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { overallScoreCsv } from "@/lib/ui/analysis-exports";
import type { AssembleScoreAnalysisArgs } from "@/lib/export/types";

// The write path is a server module (`import "server-only"`), which throws when
// imported outside a server bundle — neutralise it for the test environment.
vi.mock("server-only", () => ({}));

const CYCLE = "cycle-700435";

/**
 * Gold per-(participant, subject) raw-MCQ matrix for sitting 700435, keyed by the
 * (unique) Overall sum. Subject order: Math, Sci, Eng, Ara, Life. null = not sat.
 * 16 real students; lavinia/muamina (P0010/P0011) absent.
 */
const GOLD: Record<number, (number | null)[]> = {
  95: [null, 22, 31, 23, 19], // Abdalkhaleq Ahmad
  63: [17, 23, null, null, 23], // Afraa Al-abdullah
  106: [19, 18, 32, 18, 19], // Amal Alkhalaf
  24: [24, null, null, null, null], // Dalal Hasan
  86: [10, 16, 23, 17, 20], // Fatima Alissa
  16: [16, null, null, null, null], // Fatima Aljassem (Math-only)
  53: [16, 18, null, 19, null], // Hussein Alzeyab
  85: [14, 13, 21, 17, 20], // Louay Alkadro
  80: [19, 13, 32, null, 16], // Marah Fadel
  100: [14, 19, 29, 17, 21], // Maram Alkhoder
  87: [14, 17, 35, 21, null], // Marwa Al Omar
  108: [16, 17, 33, 20, 22], // Nour Al Issa
  42: [19, null, 23, null, null], // Nour Alhoda Zaqzaq
  72: [16, 13, 22, 21, null], // Oula Al Khalaf
  67: [17, null, 29, null, 21], // Safa Alomar
  60: [17, 23, null, null, 20], // Wesal Aljabr
};

/** Map an assessment display name to its gold-matrix column slot. */
function subjectSlot(name: string): number {
  if (/applicable math\b/i.test(name) && !/maths/i.test(name)) return 0; // base Math, not the held-out re-sit
  if (/scientific/i.test(name)) return 1;
  if (/english/i.test(name)) return 2;
  if (/arabic/i.test(name) || /[؀-ۿ]/.test(name)) return 3;
  if (/life/i.test(name)) return 4;
  return -1;
}

/** Ingest the 3-CSV fixture and stage it as a hydratable Supabase database. */
async function hydrateFixture() {
  const { ingestCleanResponses } = await import("@/lib/server/ingest-write");
  const { makeRpcAdmin } = await import("@/tests/helpers/mock-rpc-admin");
  const qmDir = path.join(process.cwd(), "tests", "fixtures", "qm");
  const read = (n: string) => readFileSync(path.join(qmDir, `${n}.csv`));
  const files = [
    { name: "Items.csv", data: read("Items") },
    { name: "Assessments.csv", data: read("Assessments") },
    { name: "Topics.csv", data: read("Topics") },
  ];
  const { cleanedResponses: clean, canonical } = ingestThreeExports(files);

  // Build exactly the row payload ingest_persist would store.
  const calls: any[] = [];
  await ingestCleanResponses(makeRpcAdmin(calls) as any, CYCLE, clean, { createdBy: "u1", canonical });
  const p = calls[0].args.p_payload;

  // The two non-cohort participants (no ResultGroupName) — the staff/irregular +
  // re-sit-only rows the analyst excludes (= lavinia/muamina = P0010/P0011).
  const nonCohortEmails = new Set(
    canonical.participants.filter((cp) => cp.groupNames.length === 0).map((cp) => cp.email),
  );

  const stamp = (rows: any[]) =>
    rows.map((r, i) => ({ created_at: new Date(1700000000000 + i * 1000).toISOString(), ...r }));
  const db: MockDb = {
    exam_cycles: [
      { id: CYCLE, name: "G12++ May 2026", status: "scored", region: "eu-west", year_id: null, sitting: "may", created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-02T00:00:00Z" },
    ],
    test_centres: [],
    exam_years: [],
    assessments: p.assessments.map((a: any) => ({ status: "scored", created_at: "2026-05-01T00:00:00Z", ...a })),
    items: p.items.map((it: any) => ({ status: "active", created_at: "2026-05-01T00:00:00Z", ...it })),
    participants: stamp(p.participants),
    responses: stamp(p.responses).map((r: any, i: number) => ({ id: `resp-${i}`, ...r })),
    item_stats: [], item_reviews: [], grade_schemes: [], grades: [], essay_marks: [],
    incidents: [], alterations: [], distinction_overrides: [], workspace_settings: [],
    element_labels: [], clean_exclusions: [], distinction_state: [], document_settings: [], import_batches: [],
  };

  const h = await hydrate(makeSupabaseReadClient(db) as any);
  expect(h).not.toBeNull();
  // participant uuids of the two to exclude (matched by studentId = qm id).
  const excludeIds = h!.seed.liveCycle.participants
    .filter((sp) => nonCohortEmails.has(sp.studentId ?? ""))
    .map((sp) => sp.id);
  return { hydrated: h!, excludeIds, clean };
}

/** Reduce the naive-overall CSV rows to a gold-shaped matrix keyed by overall. */
function appMatrix(data: AssembleScoreAnalysisArgs) {
  const { headers, rows } = overallScoreCsv(data);
  const slots = headers.slice(2, -1).map((h) => subjectSlot(h));
  return rows.map((row) => {
    const overall = row[row.length - 1] as number;
    const cells: (number | null)[] = [null, null, null, null, null];
    headers.slice(2, -1).forEach((_h, i) => {
      const slot = slots[i]!;
      if (slot >= 0) cells[slot] = row[2 + i] as number;
    });
    return { id: row[0] as string, label: row[1] as string, overall, cells };
  });
}

const norm = (x: number | null) => (x == null || x === 0 ? 0 : x);

describe("hydrate-path naive-overall + grades bucketing (sitting 700435)", () => {
  it("Step 0: fresh hydrate reconciles all 16 real students EXACTLY — no score collapse", async () => {
    const { hydrated } = await hydrateFixture();
    const provider = new InMemoryDataProvider(hydrated.seed);
    const data = provider.getScoreAnalysisData(CYCLE, true)!;
    const matrix = appMatrix(data);

    // Every gold row is reproduced exactly (matched by its unique Overall sum).
    let reconciled = 0;
    for (const gold of Object.entries(GOLD)) {
      const [overallStr, cells] = gold;
      const overall = Number(overallStr);
      const app = matrix.find((m) => m.overall === overall);
      expect(app, `gold overall ${overall} present in export`).toBeTruthy();
      expect(cells.map(norm)).toEqual(app!.cells.map(norm));
      reconciled++;
    }
    expect(reconciled).toBe(16);
  });

  it("cohort exclusion carries through: naive-overall omits P0010/P0011 (16 rows, gold-exact)", async () => {
    const { hydrated, excludeIds } = await hydrateFixture();
    expect(excludeIds).toHaveLength(2);
    const provider = new InMemoryDataProvider(hydrated.seed);
    for (const id of excludeIds) provider.excludeParticipantFromCohort(CYCLE, id, true, "non-cohort (staff/test/re-sit)");

    const data = provider.getScoreAnalysisData(CYCLE, true)!;
    const matrix = appMatrix(data);

    // exactly the 16 real students, none of them an excluded one
    expect(matrix).toHaveLength(16);
    for (const id of excludeIds) expect(matrix.some((m) => m.id === id)).toBe(false);

    // and the matrix is byte-for-byte the gold matrix
    const goldOveralls = new Set(Object.keys(GOLD).map(Number));
    for (const m of matrix) {
      expect(goldOveralls.has(m.overall), `${m.label} overall=${m.overall} is a gold row`).toBe(true);
      expect(GOLD[m.overall]!.map(norm)).toEqual(m.cells.map(norm));
    }
  });

  it("cohort exclusion carries through: grades export omits P0010/P0011 (16 rows)", async () => {
    const { hydrated, excludeIds } = await hydrateFixture();
    const provider = new InMemoryDataProvider(hydrated.seed);
    for (const id of excludeIds) provider.excludeParticipantFromCohort(CYCLE, id, true, "non-cohort (staff/test/re-sit)");

    const grades = provider.getGrades(CYCLE)!;
    expect(grades.rows).toHaveLength(16);
    for (const id of excludeIds) expect(grades.rows.some((r) => r.id === id)).toBe(false);
  });

  it("the held-out 'Applicable Maths' re-sit never inflates the base Math column", async () => {
    const { hydrated } = await hydrateFixture();
    // No assessment in the hydrated seed is the re-sit form.
    expect(hydrated.seed.liveCycle.assessments.some((a) => /applicable maths\b/i.test(a.name))).toBe(false);
    const provider = new InMemoryDataProvider(hydrated.seed);
    const data = provider.getScoreAnalysisData(CYCLE, true)!;
    const matrix = appMatrix(data);
    // Dalal (Math-only, 24) is the highest Math cell — the re-sit's 23/43 is absent.
    const maths = matrix.map((m) => m.cells[0] ?? 0);
    expect(Math.max(...maths)).toBe(24);
  });

  it("INVARIANT: the export generation fails loudly on a collapsed participant key", () => {
    // Two participants sharing one id (the post-collapse signature) must throw,
    // not silently merge their per-subject cells.
    const data: AssembleScoreAnalysisArgs = {
      assessments: [{ id: "A", name: "Math" }],
      participants: [
        { id: "dup", label: "Student A" },
        { id: "dup", label: "Student B" },
      ],
      responses: [{ participantId: "dup", itemId: "i1", assessmentId: "A", score: 1 }],
      items: [{ itemId: "i1", assessmentId: "A", majorElement: null, subElement: null, demandLevel: null, maxScore: 1 }],
      excludedItemIds: [],
      scoreRunNote: "",
    };
    expect(() => overallScoreCsv(data)).toThrowError(/duplicate participant id/i);
  });

  it("INVARIANT: hydrate fails loudly when two participants collapse onto one studentId", async () => {
    // The real-world trigger: a blank/duplicated ResultParticipantName makes DB
    // dedup fold two students into one qm_participant_id → studentId. Build that
    // collapsed shape directly and assert hydrate refuses it.
    const db: MockDb = {
      exam_cycles: [{ id: CYCLE, name: "X", status: "scored", region: "eu-west", year_id: null, sitting: "may", created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-02T00:00:00Z" }],
      test_centres: [], exam_years: [],
      assessments: [{ id: "a1", cycle_id: CYCLE, name: "Math", item_count: 1, status: "scored", created_at: "2026-05-01T00:00:00Z" }],
      items: [{ id: "i1", cycle_id: CYCLE, assessment_id: "a1", qm_question_id: "q1", wording: null, major_element: null, sub_element: null, demand_level: null, item_set: null, max_score: 1, status: "active", created_at: "2026-05-01T00:00:00Z" }],
      participants: [
        { id: "u1", cycle_id: CYCLE, qm_participant_id: "same@id", pseudonym_id: "P0001", full_name: "Alpha", created_at: "2026-05-01T00:00:01Z" },
        { id: "u2", cycle_id: CYCLE, qm_participant_id: "same@id", pseudonym_id: "P0002", full_name: "Beta", created_at: "2026-05-01T00:00:02Z" },
      ],
      responses: [
        { id: "r1", cycle_id: CYCLE, participant_id: "u1", item_id: "i1", answer_given: "A", answer_score: 1, response_time: null, result_status: null, created_at: "2026-05-01T00:00:03Z" },
      ],
      item_stats: [], item_reviews: [], grade_schemes: [], grades: [], essay_marks: [],
      incidents: [], alterations: [], distinction_overrides: [], workspace_settings: [],
      element_labels: [], clean_exclusions: [], distinction_state: [], document_settings: [], import_batches: [],
    };
    await expect(hydrate(makeSupabaseReadClient(db) as any)).rejects.toThrowError(/maps to more than one participant row/i);
  });

  it("INVARIANT: the export generation fails loudly on an orphan response", () => {
    const data: AssembleScoreAnalysisArgs = {
      assessments: [{ id: "A", name: "Math" }],
      participants: [{ id: "p1", label: "Student A" }],
      // a response whose participant vanished from the roster — a collapse symptom
      responses: [{ participantId: "ghost", itemId: "i1", assessmentId: "A", score: 1 }],
      items: [{ itemId: "i1", assessmentId: "A", majorElement: null, subElement: null, demandLevel: null, maxScore: 1 }],
      excludedItemIds: [],
      scoreRunNote: "",
    };
    expect(() => overallScoreCsv(data)).toThrowError(/participant collapse/i);
  });
});
