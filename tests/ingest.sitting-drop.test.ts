/**
 * Whole-sitting drop at persist — sitting 700435 (task 19, grade-bearing).
 *
 * Task 17 / migration 0021 fixed the sitting-MERGE (subjects folded into one record).
 * A SEPARATE bug remained underneath: whole sittings were dropped at ingest. Its
 * signature — a dropped sitting has ZERO rows in the output (absent from BOTH
 * `responses` and `result_totals`), so the DB roster↔responses guard (which only
 * checks result_totals ⊆ responses) never sees it; two sittings with identical
 * profiles get different fates; the loss is order/representation dependent.
 *
 * Root cause reproduced here: the three QM exports are joined on `ResultId`, but CSV/
 * spreadsheet tooling can render the SAME integer id differently across files (a
 * trailing `.0`, quotes, exponential form). A bare string join then FAILS for the
 * mismatched sittings, so a whole sitting's Items orphan against its Assessments
 * roster row — the sitting is on the roster (15 Math sitters) but persists zero
 * responses (only 12 survive), and vanishes silently. Dalal Hasan (ResultId
 * 1572504488) is the canary; Fatima Aljassem (1032381502), an identical profile whose
 * id happened to render cleanly, survives.
 *
 * The fix (`normalizeResultId`) canonicalises the join key so the skewed sittings
 * attach again; `assertAllGradedSittingsPersisted` fails loudly on any residual drop.
 * This file locks both: (1) the skewed export ingests to the FULL 15 Math sittings
 * with Dalal present and her 41 answers intact, end-to-end through the real
 * ingest → persist payload → hydrate → provider path; (2) the guard throws when a
 * sitting carries MCQ answers on the roster yet reaches zero persisted responses.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ingestThreeExports, assertAllGradedSittingsPersisted, type NamedInput } from "@/lib/ingest/qm";
import type { CanonicalModel } from "@/lib/ingest/qm";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { resolveCohort } from "@/lib/data/resolved-cohort";
import { makeRpcAdmin, type RpcCall } from "./helpers/mock-rpc-admin";
import { makeSupabaseReadClient, type MockDb } from "./helpers/mock-supabase-read";

vi.mock("server-only", () => ({}));

const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const CYCLE = "00000000-0000-0000-0000-0000000000d9";

const DALAL_RESULT_ID = "1572504488"; // de-identified as student17
const DALAL_EMAIL = "student17@example.edu";
const DALAL_TOTAL = 24;

/** Rewrite the `ResultId` cell of the given result ids in a CSV buffer. */
function rewriteResultId(buf: Buffer, ids: Set<string>, xform: (s: string) => string): Buffer {
  const lines = buf.toString("utf8").split(/\r?\n/);
  const header = lines[0]!.replace(/^﻿/, "").split(",");
  const ridIdx = header.indexOf("ResultId");
  const out = [lines[0]!];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) { out.push(line); continue; }
    const cells = line.split(",");
    if (ids.has(cells[ridIdx]!)) cells[ridIdx] = xform(cells[ridIdx]!);
    out.push(cells.join(","));
  }
  return Buffer.from(out.join("\n"), "utf8");
}

/** The qm fixture, with a few Math sittings' ResultId rendered `…​.0` ONLY in Items
 *  (the Assessments roster keeps the plain integer) — the representation skew. */
function skewedFiles(): NamedInput[] {
  const read = (n: string) => readFileSync(path.join(qmDir, `${n}.csv`));
  // Three Math sittings, incl. Dalal — their Items ResultId gets a trailing `.0`.
  const skew = new Set([DALAL_RESULT_ID, "353625126", "837124560"]);
  return [
    { name: "Items.csv", data: rewriteResultId(read("Items"), skew, (s) => `${s}.0`) },
    { name: "Assessments.csv", data: read("Assessments") },
    { name: "Topics.csv", data: read("Topics") },
  ];
}

/** Drive the REAL app path (3-CSV ingest → server persist payload → hydrate → provider). */
async function hydrateFrom(files: NamedInput[]) {
  const { ingestCleanResponses } = await import("@/lib/server/ingest-write");
  const { hydrate } = await import("@/lib/data/supabase-hydrate");

  const { cleanedResponses, canonical, validationReport } = ingestThreeExports(files);
  const calls: RpcCall[] = [];
  await ingestCleanResponses(makeRpcAdmin(calls) as never, CYCLE, cleanedResponses, {
    createdBy: "11111111-1111-1111-1111-111111111111",
    canonical,
    report: validationReport,
  });
  const payload = calls[0]!.args.p_payload;

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
    test_centres: [], exam_years: [], result_totals: payload.result_totals, topic_rollups: payload.topic_rollups,
  };
  const hydrated = await hydrate(makeSupabaseReadClient(db) as never);
  if (!hydrated) throw new Error("hydrate returned null");
  return { provider: new InMemoryDataProvider(hydrated.seed), seed: hydrated.seed, cleanedResponses, canonical, payload };
}

const mathRe = /Applicable Math$/;

describe("whole-sitting drop at persist — ResultId representation skew (700435)", () => {
  it("the fix recovers all 15 Math sittings from a skewed export — no whole-sitting drop", async () => {
    const { cleanedResponses, canonical } = await hydrateFrom(skewedFiles());

    // The Assessments roster always had 15 Math sittings; with the fix, all 15 now
    // persist (before the fix only 12 survived — the three `.0`-skewed ones orphaned).
    const mathRoster = canonical.results.filter((r) => mathRe.test(r.subject));
    expect(mathRoster).toHaveLength(15);
    const persistedMathSittings = new Set(
      cleanedResponses.filter((r) => mathRe.test(r.assessmentName)).map((r) => r.qmResultId),
    );
    expect(persistedMathSittings.size).toBe(15);

    // Every roster ResultId is persisted under its CANONICAL (skew-stripped) key.
    for (const res of mathRoster) expect(persistedMathSittings.has(res.resultId)).toBe(true);
    expect(persistedMathSittings.has(DALAL_RESULT_ID)).toBe(true);
  });

  it("Dalal Hasan (the dropped canary) is present with her 41 answers (total 24)", async () => {
    const { provider, seed } = await hydrateFrom(skewedFiles());
    const mathId = seed.liveCycle.assessments.find((a) => mathRe.test(a.name))!.id;

    const clean = provider.getDataCleaning(CYCLE, mathId)!;
    const dalal = clean.rows.find((r) => r.studentId === DALAL_EMAIL);
    expect(dalal, "Dalal must have a row, not vanish").toBeTruthy();
    const scored = dalal!.cells.filter((c): c is number => c === 0 || c === 1);
    expect(scored).toHaveLength(41);
    expect(scored.reduce((a, b) => a + b, 0)).toBe(DALAL_TOTAL);

    const naive = provider.getNaiveScores(CYCLE, mathId)!;
    const dalalScore = naive.students.find((s) => s.studentId === DALAL_EMAIL);
    expect(dalalScore, "Dalal must be a scored student").toBeTruthy();
    expect(dalalScore!.raw).toBe(DALAL_TOTAL);
  });

  it("the skewed export yields the full detection cohort 15/12/12/9/11 (18 distinct)", async () => {
    const { provider } = await hydrateFrom(skewedFiles());
    const resolved = resolveCohort(provider, CYCLE)!;
    const count = (re: RegExp) => resolved.subjects.find((s) => re.test(s.name))!.detected.size;
    expect(count(/Applicable Math$/)).toBe(15);
    expect(count(/English/)).toBe(12);
    expect(count(/Scientific/)).toBe(12);
    expect(count(/العربيّة/)).toBe(9);
    expect(count(/Life/)).toBe(11);
    expect(resolved.detectedTotal).toBe(18);
  });

  it("persisted responses and result_totals agree at the SITTING grain (no orphan either side)", async () => {
    const { payload } = await hydrateFrom(skewedFiles());
    const respSittings = new Set((payload.responses as { qm_result_id: string }[]).map((r) => r.qm_result_id));
    const rtSittings = new Set((payload.result_totals as { qm_result_id: string }[]).map((r) => r.qm_result_id));
    // Every persisted response sitting has a parent record and vice versa (the DB
    // 0023 guard asserts exactly this; here we prove the payload already satisfies it).
    for (const id of respSittings) expect(rtSittings.has(id), `resp sitting ${id} has a result_total`).toBe(true);
    for (const id of rtSittings) expect(respSittings.has(id), `result_total ${id} has responses`).toBe(true);
  });
});

describe("assertAllGradedSittingsPersisted — the loud-failure net", () => {
  const baseResult = {
    rawSubjectName: "G12++ Applicable Math",
    participantEmail: "someone@example.edu",
    groupName: null, sitting: null, status: "Finished OK", attemptNumber: 1,
    totalScore: 1, maximumScore: 41, percentageScore: null, scoreband: null, topics: [],
  } as const;
  const mcqResponse = { questionId: "q1", answerGiven: "A", answerScore: 1, responseTime: null, questionType: "Multiple Choice", status: null };

  function model(results: CanonicalModel["results"], resitForms: CanonicalModel["resitForms"] = []): CanonicalModel {
    return {
      sitting: null, subjects: [], participants: [], items: results, results,
      integrity: { resultsChecked: results.length, reconciled: results.length, issues: [], ok: true },
      resitForms, excludedSurveys: [],
      stats: { assessmentRows: 0, itemRows: 0, topicRows: 0, gradedResults: results.length, surveyResults: 0 },
    } as unknown as CanonicalModel;
  }

  it("throws, naming the ResultId, when a sitting carries MCQ answers but persisted none", () => {
    const results = [
      { ...baseResult, resultId: "1572504488", subject: "G12++ Applicable Math", responses: [mcqResponse] },
      { ...baseResult, resultId: "1032381502", subject: "G12++ Applicable Math", responses: [mcqResponse] },
    ] as unknown as CanonicalModel["results"];
    // Only 1032381502 reached the graded set — 1572504488 was dropped.
    const graded = [
      { assessmentName: "G12++ Applicable Math", qmResultId: "1032381502", qmQuestionId: "q1", qmParticipantId: "p", participantPseudonym: "P0001", answerScore: 1 },
    ] as never[];
    expect(() => assertAllGradedSittingsPersisted(model(results), graded)).toThrow(/whole-sitting drop/i);
    expect(() => assertAllGradedSittingsPersisted(model(results), graded)).toThrow(/1572504488/);
  });

  it("does NOT throw for a roster sitting with no joined MCQ answers (an abandoned sitting)", () => {
    const results = [
      { ...baseResult, resultId: "1032381502", subject: "G12++ Applicable Math", responses: [mcqResponse] },
      { ...baseResult, resultId: "999", subject: "G12++ Applicable Math", responses: [] }, // no items — abandoned
    ] as unknown as CanonicalModel["results"];
    const graded = [
      { assessmentName: "G12++ Applicable Math", qmResultId: "1032381502", qmQuestionId: "q1", qmParticipantId: "p", participantPseudonym: "P0001", answerScore: 1 },
    ] as never[];
    expect(() => assertAllGradedSittingsPersisted(model(results), graded)).not.toThrow();
  });

  it("does NOT throw for a held-out re-sit form absent from the graded set", () => {
    const results = [
      { ...baseResult, resultId: "1032381502", subject: "G12++ Applicable Math", responses: [mcqResponse] },
      { ...baseResult, resultId: "555", subject: "G12++ Applicable Maths", responses: [mcqResponse] }, // re-sit form
    ] as unknown as CanonicalModel["results"];
    const graded = [
      { assessmentName: "G12++ Applicable Math", qmResultId: "1032381502", qmQuestionId: "q1", qmParticipantId: "p", participantPseudonym: "P0001", answerScore: 1 },
    ] as never[];
    const resit = [{ name: "G12++ Applicable Maths", baseName: "G12++ Applicable Math", participantCount: 1, itemCount: 1 }];
    expect(() => assertAllGradedSittingsPersisted(model(results, resit), graded)).not.toThrow();
  });
});
