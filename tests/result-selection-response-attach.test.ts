/**
 * Result-selection & response-attach — sitting 700435 (task 17, grade-bearing).
 *
 * The 15→7 collapse was NOT identity-merge (no key reproduces [7,8,7,8,4]); it was
 * responses failing to attach to their sitter's roster row, so real sitters (e.g.
 * Dalal Hasan, ResultId 1572504488, 41 answers → 24) rendered as empty all-dashes
 * rows and were not counted. This file is the regression lock for the fix:
 *
 *   1. Canonical reproduction — Dalal appears in Applicable Math with her 41
 *      responses (total 24) on the Clean → Applicable Math tab, driven through the
 *      REAL app path (3-CSV ingest → server persist payload → hydrate → provider),
 *      NOT an empty row. Before the resolve-once attribution fix (commit 16) her
 *      responses attached to a re-resolved id absent from the roster; this asserts
 *      they now ride the single roster identity end-to-end.
 *   2. Roster oracle (pre-clean / detection) — per-subject sitters 15/12/12/9/11,
 *      18 distinct across the cycle (tests/fixtures/oracles/oracle_rosters.csv).
 *   3. After the Clean exclusion — 15/11/12/9/10 (Lavinia out of English, Muamina
 *      out of Life).
 *   4. Score oracle — the naive per-student Applicable Math matrix equals
 *      oracle_applicable_math_matrix.csv cell-for-cell (columns in QuestionId
 *      order), matched by ResultId.
 *   5. Cross-view invariant — Upload (combined-split), Clean (data-cleaning) and
 *      Data-flow all read the ONE canonical cohort (lib/data/resolved-cohort.ts),
 *      so their per-subject counts are identical by construction.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ingestThreeExports, type NamedInput } from "@/lib/ingest/qm";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { buildDataFlow } from "@/lib/data/data-flow";
import { resolveCohort, assertCohortResolved } from "@/lib/data/resolved-cohort";
import { makeRpcAdmin, type RpcCall } from "./helpers/mock-rpc-admin";
import { makeSupabaseReadClient, type MockDb } from "./helpers/mock-supabase-read";
import type { CleanResponse } from "@/lib/ingest/types";

vi.mock("server-only", () => ({}));

const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const oracleDir = path.join(here, "fixtures", "oracles");
const read = (n: string) => readFileSync(path.join(qmDir, `${n}.csv`));
const files = (): NamedInput[] => [
  { name: "Items.csv", data: read("Items") },
  { name: "Assessments.csv", data: read("Assessments") },
  { name: "Topics.csv", data: read("Topics") },
];

// Dalal Hasan (de-identified as student17) — the empty-row canary from the brief.
const DALAL_RESULT_ID = "1572504488";
const DALAL_EMAIL = "student17@example.edu";
const DALAL_TOTAL = 24;

// The two staff/test accounts in the de-identified 700435 roster. In the fixture
// they carry placeholder emails (not the real Lavinia/Muamina), so the app's
// email-list auto-exclusion doesn't fire — they're excluded explicitly at Clean,
// exactly as the sitting-700435 regression test does.
const LAVINIA = "student15@example.edu"; // sat English
const MUAMINA = "student16@example.edu"; // sat Life (+ the typo Maths re-sit)

const CYCLE = "00000000-0000-0000-0000-0000000000cc";

/** Drive the REAL app path: 3-CSV ingest → server persist payload → hydrate → provider. */
async function buildHydratedProvider() {
  const { ingestCleanResponses } = await import("@/lib/server/ingest-write");
  const { hydrate } = await import("@/lib/data/supabase-hydrate");

  const { cleanedResponses, canonical, validationReport } = ingestThreeExports(files());
  const calls: RpcCall[] = [];
  const admin = makeRpcAdmin(calls);
  await ingestCleanResponses(admin as never, CYCLE, cleanedResponses, {
    createdBy: "11111111-1111-1111-1111-111111111111",
    canonical,
    report: validationReport,
  });
  const payload = calls[0]!.args.p_payload;

  // Load the persisted payload into the read mock exactly as ingest_persist would.
  const db: MockDb = {
    exam_cycles: [{ id: CYCLE, name: "Sitting 700435", region: "EU", status: "validated", created_at: "2026-05-01", updated_at: "2026-05-01", year_id: null }],
    assessments: payload.assessments,
    items: payload.items,
    participants: payload.participants,
    responses: (payload.responses as Record<string, unknown>[]).map((r, i) => ({ ...r, created_at: `2026-05-01T00:00:${String(i % 60).padStart(2, "0")}Z` })),
    item_stats: [], item_reviews: [], grade_schemes: [], grades: [], essay_marks: [],
    incidents: [], alterations: [], distinction_overrides: [], workspace_settings: [],
    element_labels: [], clean_exclusions: [], distinction_state: [], document_settings: [],
    import_batches: [{ cycle_id: CYCLE, created_at: "2026-05-01", report_json: validationReport, file_ref: "qm", items_file: "Items.csv", assessments_file: "Assessments.csv", topics_file: "Topics.csv", file_size_mb: 1 }],
    test_centres: [], exam_years: [], sittings: payload.sittings, topic_rollups: payload.topic_rollups,
  };
  const hydrated = await hydrate(makeSupabaseReadClient(db) as never);
  if (!hydrated) throw new Error("hydrate returned null");
  const provider = new InMemoryDataProvider(hydrated.seed);
  return { provider, seed: hydrated.seed, cleanedResponses };
}

const subjectRe = {
  math: /Applicable Math$/,
  english: /English/,
  scientific: /Scientific/,
  arabic: /العربيّة/,
  life: /Life/,
} as const;

describe("result-selection & response-attach — sitting 700435", () => {
  let provider: InMemoryDataProvider;
  let seed: Awaited<ReturnType<typeof buildHydratedProvider>>["seed"];
  let cleanedResponses: CleanResponse[];
  const idFor = (re: RegExp) => seed.liveCycle.assessments.find((a) => re.test(a.name))!.id;

  beforeAll(async () => {
    ({ provider, seed, cleanedResponses } = await buildHydratedProvider());
  });

  // ── 1. Canonical reproduction — Dalal is attached, not an empty row ─────────
  it("Dalal Hasan appears in Applicable Math with her 41 responses (total 24), not an empty row", () => {
    const mathId = idFor(subjectRe.math);

    // The Clean → Applicable Math tab reads getDataCleaning (and getRawData).
    const clean = provider.getDataCleaning(CYCLE, mathId)!;
    const dalal = clean.rows.find((r) => r.studentId === DALAL_EMAIL);
    expect(dalal, "Dalal must have a row on the Clean tab").toBeTruthy();
    const scored = dalal!.cells.filter((c): c is number => c === 0 || c === 1);
    // NOT an all-dashes row: every one of her 41 answers is attached.
    expect(scored).toHaveLength(41);
    expect(scored.reduce((a, b) => a + b, 0)).toBe(DALAL_TOTAL);

    // …and she survives to the score matrix with the same total.
    const naive = provider.getNaiveScores(CYCLE, mathId)!;
    const dalalScore = naive.students.find((s) => s.studentId === DALAL_EMAIL);
    expect(dalalScore, "Dalal must be a scored student, not dropped").toBeTruthy();
    expect(dalalScore!.raw).toBe(DALAL_TOTAL);

    // No real sitter renders as an empty row: every Clean row has ≥1 attached cell.
    const emptyRows = clean.rows.filter((r) => r.cells.every((c) => c === null));
    expect(emptyRows.map((r) => r.studentId)).toEqual([]);
  });

  // ── 2. Roster oracle — ingest/detection (pre-clean, 18 total) ───────────────
  it("detection cohort matches the roster oracle: Math 15, English 12, Sci 12, Arabic 9, Life 11 (18 distinct)", () => {
    const resolved = resolveCohort(provider, CYCLE)!;
    const count = (re: RegExp) => resolved.subjects.find((s) => re.test(s.name))!.detected.size;
    expect(count(subjectRe.math)).toBe(15);
    expect(count(subjectRe.english)).toBe(12);
    expect(count(subjectRe.scientific)).toBe(12);
    expect(count(subjectRe.arabic)).toBe(9);
    expect(count(subjectRe.life)).toBe(11);
    expect(resolved.detectedTotal).toBe(18);

    // Cross-check against the committed oracle roster CSV.
    const roster = readFileSync(path.join(oracleDir, "oracle_rosters.csv"), "utf8").trim().split("\n").slice(1);
    const bySubject = new Map<string, Set<string>>();
    for (const line of roster) {
      const [subject, , resultId] = line.split(",");
      (bySubject.get(subject!) ?? bySubject.set(subject!, new Set()).get(subject!)!).add(resultId!);
    }
    expect(bySubject.get("Applicable Math")!.size).toBe(15);
    expect(bySubject.get("English 2nd Language")!.size).toBe(12);
    expect(bySubject.get("Scientific Thinking")!.size).toBe(12);
    expect(bySubject.get("Arabic 1st Language")!.size).toBe(9);
    expect(bySubject.get("Life Success Skills")!.size).toBe(11);
  });

  // ── 3. After Clean exclusion (16 students) — 15/11/12/9/10 ──────────────────
  it("after excluding the staff/test accounts the cleaned cohort is 15/11/12/9/10", () => {
    const p = provider;
    const idOf = (email: string) => seed.liveCycle.participants.find((x) => x.studentId === email)!.id;
    p.excludeParticipantFromCohort(CYCLE, idOf(LAVINIA), true, "G12 Lead (staff)");
    p.excludeParticipantFromCohort(CYCLE, idOf(MUAMINA), true, "Re-sit / test account");
    try {
      const resolved = resolveCohort(p, CYCLE)!;
      const cleaned = (re: RegExp) => resolved.subjects.find((s) => re.test(s.name))!.cleaned.size;
      expect(cleaned(subjectRe.math)).toBe(15);
      expect(cleaned(subjectRe.english)).toBe(11);
      expect(cleaned(subjectRe.scientific)).toBe(12);
      expect(cleaned(subjectRe.arabic)).toBe(9);
      expect(cleaned(subjectRe.life)).toBe(10);
      // The ingest-boundary invariant holds: no cleaned sitter is dropped before the matrix.
      expect(() => assertCohortResolved(resolved)).not.toThrow();
    } finally {
      p.excludeParticipantFromCohort(CYCLE, idOf(LAVINIA), false);
      p.excludeParticipantFromCohort(CYCLE, idOf(MUAMINA), false);
    }
  });

  // ── 4. Score oracle — naive Math matrix equals the oracle, cell-for-cell ─────
  it("the naive Applicable Math matrix reconciles with oracle_applicable_math_matrix.csv cell-for-cell", () => {
    const math = cleanedResponses.filter((r) => subjectRe.math.test(r.assessmentName));
    // Canonical column order = QuestionId ascending (the oracle's Q1..Q41 order).
    const qids = [...new Set(math.map((r) => r.qmQuestionId))].sort((a, b) => Number(a) - Number(b));
    expect(qids).toHaveLength(41);
    const byResult = new Map<string, Map<string, number>>();
    for (const r of math) {
      (byResult.get(r.qmResultId) ?? byResult.set(r.qmResultId, new Map()).get(r.qmResultId)!).set(r.qmQuestionId, r.answerScore);
    }

    const oracle = readFileSync(path.join(oracleDir, "oracle_applicable_math_matrix.csv"), "utf8").trim().split("\n").slice(1).filter(Boolean);
    expect(oracle).toHaveLength(15);
    let matched = 0;
    for (const line of oracle) {
      const cols = line.split(",");
      const resultId = cols[2]!;
      const expected = cols.slice(3, 3 + 41).map(Number);
      const total = Number(cols[44]);
      const row = byResult.get(resultId);
      expect(row, `oracle result ${resultId} present in fixture Math matrix`).toBeTruthy();
      matched += 1;
      const got = qids.map((q) => row!.get(q) ?? 0);
      expect(got, `cells for ${cols[0]} (${resultId})`).toEqual(expected);
      expect(got.reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(matched).toBe(15);
  });

  // ── 5. Cross-view invariant — Upload / Clean / Data-flow read one cohort ────
  it("Upload, Clean and Data-flow report the SAME per-subject counts (one canonical cohort)", () => {
    const resolved = resolveCohort(provider, CYCLE)!;
    const split = provider.getCombinedSplit(CYCLE)!;
    const flow = buildDataFlow(provider, CYCLE)!;

    for (const cohort of resolved.subjects) {
      // Upload (combined-split) = detected (staff included).
      const up = split.subjects.find((s) => s.id === cohort.assessmentId)!;
      expect(up.participants, `Upload count for ${cohort.name}`).toBe(cohort.detected.size);

      // Clean (data-cleaning) cohort = detected − staff − soft-deletes.
      const clean = provider.getDataCleaning(CYCLE, cohort.assessmentId)!;
      const cleanCohort = clean.rows.length - clean.excludedRows.length;
      expect(cleanCohort, `Clean count for ${cohort.name}`).toBe(cohort.cleaned.size);

      // Data-flow strip reads the canonical stages verbatim.
      const df = flow.subjects.find((s) => s.key === cohort.assessmentId)!;
      expect(df.counts[0], `Data-flow ingested for ${cohort.name}`).toBe(cohort.detected.size - cohort.staff.size);
      expect(df.counts[1], `Data-flow cleaned for ${cohort.name}`).toBe(cohort.cleaned.size);
      expect(df.counts[2], `Data-flow matrix for ${cohort.name}`).toBe(cohort.matrix.size);
      expect(df.counts[3], `Data-flow computed for ${cohort.name}`).toBe(cohort.computed.size);
    }
  });

  // ── 6. The ingest-boundary guard fails LOUDLY on a dropped sitter ──────────
  // The de-identified fixture is clean, so it cannot itself reproduce the collapse
  // (its emails are unique across Items and Assessments — the real-data trigger,
  // code-sharing / blank ResultParticipantName rows, is absent). This proves the
  // guard the fix installs would have caught the original all-dots collapse: a
  // sitter present at Clean but missing from the score matrix throws.
  it("assertCohortResolved throws when a cleaned sitter is dropped before the matrix", () => {
    const healthy = {
      cycleId: CYCLE,
      detectedTotal: 2,
      cleanedTotal: 2,
      computedTotal: 2,
      subjects: [
        {
          assessmentId: "a1",
          name: "Applicable Math",
          detected: new Set(["p1", "p2"]),
          staff: new Set<string>(),
          cleaned: new Set(["p1", "p2"]),
          matrix: new Set(["p1", "p2"]),
          computed: new Set(["p1", "p2"]),
        },
      ],
    };
    expect(() => assertCohortResolved(healthy)).not.toThrow();

    // Dalal (p2) is cleaned but her responses never reached a score-matrix row.
    const collapsed = {
      ...healthy,
      subjects: [{ ...healthy.subjects[0]!, matrix: new Set(["p1"]), computed: new Set(["p1"]) }],
    };
    expect(() => assertCohortResolved(collapsed)).toThrow(/dropped before the score matrix/);
  });
});
