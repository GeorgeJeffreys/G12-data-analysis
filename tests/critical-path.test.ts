/**
 * End-to-end critical-path integrity (P-A) — the numerator / denominator flow.
 *
 * Enforces the contract documented in `docs/critical-path.md`: a student's
 * per-subject percentage is ALWAYS
 *
 *     earned marks on currently-INCLUDED items (+ adjustments)
 *     ──────────────────────────────────────────────────────── × 100
 *     max marks on currently-INCLUDED items
 *
 * consistently through every stage. Two layers:
 *   A. engine-level unit proofs on `computeScores` (the single place the ratio is
 *      computed) for each rule — exclusion, max-0 stimulus, essay, adjustment;
 *   B. a worked end-to-end example on the real Applicable Math data: exclude an
 *      item + add a technical adjustment, and assert the final percentage AND grade
 *      equal the hand-computed values.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  computeScores,
  round,
  type ResponseRecord,
  type ItemMeta,
} from "@/lib/engine";
import { ingestThreeExports, type NamedInput } from "@/lib/ingest/qm";
import { buildLiveCycleData } from "@/lib/data/build-live-cycle";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { ENGINE_VERSION } from "@/lib/engine";
import { classify, DEFAULT_PERFORMANCE_CUTS } from "@/lib/data/grading";
import type { Seed } from "@/lib/data/seed-types";

// ── A. engine-level proofs of the numerator / denominator rules ──────────────
describe("critical path — numerator / denominator rules (engine)", () => {
  const A = "subj";
  // Three dichotomous items (max 1 each) + one max-0 stimulus item.
  const items: ItemMeta[] = [
    { itemId: "i1", assessmentId: A, maxScore: 1 },
    { itemId: "i2", assessmentId: A, maxScore: 1 },
    { itemId: "i3", assessmentId: A, maxScore: 1 },
    { itemId: "stim", assessmentId: A, maxScore: 0 }, // max-0 shared stimulus
  ];
  const resp = (p: string, i: string, s: number): ResponseRecord => ({ participantId: p, itemId: i, assessmentId: A, score: s });
  // One student answers i1✓ i2✓ i3✗, sees the max-0 stimulus.
  const responses: ResponseRecord[] = [
    resp("P1", "i1", 1), resp("P1", "i2", 1), resp("P1", "i3", 0), resp("P1", "stim", 0),
    // a second student so cohort maxes are exercised
    resp("P2", "i1", 0), resp("P2", "i2", 1), resp("P2", "i3", 1), resp("P2", "stim", 0),
  ];
  const only = (rows: ReturnType<typeof computeScores>, p: string) => rows.find((r) => r.participantId === p)!;

  it("max-0 stimulus items are excluded from the denominator", () => {
    const s = only(computeScores(responses, [], { items }), "P1");
    // Denominator = i1+i2+i3 = 3, NOT 4 (the stimulus contributes 0 to the max).
    expect(s.max).toBe(3);
    expect(s.mcq).toBe(2); // i1 + i2
    expect(s.pct).toBe(round((2 / 3) * 100, 2));
  });

  it("excluding an item removes it from BOTH numerator and denominator", () => {
    const base = only(computeScores(responses, [], { items }), "P1");
    // Exclude i1 (which P1 answered correctly): earned −1 AND max −1.
    const after = only(computeScores(responses, ["i1"], { items }), "P1");
    expect(after.mcq).toBe(base.mcq - 1); // numerator drops the earned mark
    expect(after.max).toBe(base.max - 1); // denominator drops the item max
    expect(after.pct).toBe(round((1 / 2) * 100, 2)); // (2-1)/(3-1)
  });

  it("excluding an item the student got WRONG still drops the denominator", () => {
    const base = only(computeScores(responses, [], { items }), "P1");
    const after = only(computeScores(responses, ["i3"], { items }), "P1");
    expect(after.mcq).toBe(base.mcq); // P1 earned 0 on i3 — numerator unchanged
    expect(after.max).toBe(base.max - 1); // denominator still drops by i3's max
    expect(after.pct).toBe(round((2 / 2) * 100, 2)); // now 2/2 = 100%
  });

  it("essay marks add to the numerator only; the essay max is reserved in the denominator", () => {
    const withEssay = only(
      computeScores(responses, [], {
        items,
        essayAssessmentIds: [A],
        essayMax: 10, // reserved half-weighted essay max
        essayMarks: [{ participantId: "P1", assessmentId: A, mark: 7 }],
      }),
      "P1",
    );
    expect(withEssay.essay).toBe(7); // earned essay mark → numerator
    expect(withEssay.max).toBe(3 + 10); // MCQ max + reserved essay max
    expect(withEssay.raw).toBe(2 + 7); // mcq + essay
    expect(withEssay.pct).toBe(round((9 / 13) * 100, 2));
  });

  it("technical adjustments add to the numerator only; the denominator is unchanged", () => {
    const base = only(computeScores(responses, [], { items }), "P1");
    const adjusted = only(
      computeScores(responses, [], { items, alterations: [{ participantId: "P1", assessmentId: A, marks: 1.5 }] }),
      "P1",
    );
    expect(adjusted.alterations).toBe(1.5); // delta → numerator
    expect(adjusted.max).toBe(base.max); // denominator unchanged
    expect(adjusted.raw).toBe(base.mcq + 1.5);
    expect(adjusted.pct).toBe(round(((2 + 1.5) / 3) * 100, 2));
  });

  it("a cleaned-out participant (no responses) never appears in the output", () => {
    const rows = computeScores(responses, [], { items });
    expect(rows.some((r) => r.participantId === "P1")).toBe(true);
    // Drop P1's rows (a Clean-stage participant removal) → P1 leaves entirely.
    const cleaned = responses.filter((r) => r.participantId !== "P1");
    const rows2 = computeScores(cleaned, [], { items });
    expect(rows2.some((r) => r.participantId === "P1")).toBe(false);
    expect(rows2.some((r) => r.participantId === "P2")).toBe(true);
  });
});

// ── B. worked end-to-end example on the real Applicable Math data ────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const collideDir = path.join(here, "fixtures", "qm-collide");
const read = (n: string) => readFileSync(path.join(qmDir, `${n}.csv`));
const files = (): NamedInput[] => [
  { name: "Items.csv", data: read("Items") },
  { name: "Assessments.csv", data: readFileSync(path.join(collideDir, "Assessments.csv")) },
  { name: "Topics.csv", data: read("Topics") },
];
const CYCLE = "live";

describe("critical path — worked end-to-end example (exclude item + adjust → grade)", () => {
  it("final percentage and grade equal the hand-computed values through the whole path", () => {
    const { cleanedResponses, validationReport } = ingestThreeExports(files());
    const built = buildLiveCycleData(cleanedResponses);
    const seed: Seed = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      engineVersion: ENGINE_VERSION,
      liveCycle: {
        id: CYCLE, name: "worked", region: "EU", startedAt: "x", lastActivity: "x",
        stageIndex: 1, fileName: "qm", fileSizeMB: 1, uploadedAgo: "now",
        validation: validationReport, preview: built.preview, duplicates: 0,
        participants: built.participants, assessments: built.assessments, diagnostics: built.diagnostics,
      },
      priorCycles: [],
    };
    const p = new InMemoryDataProvider(seed);
    const idOf = (email: string) => built.participants.find((x) => x.studentId === email)!.id;
    // Clean stage: exclude the staff + test accounts from the cohort.
    p.excludeParticipantFromCohort(CYCLE, idOf("student15@example.edu"), true, "staff");
    p.excludeParticipantFromCohort(CYCLE, idOf("student16@example.edu"), true, "test");

    const math = built.assessments.find((a) => /Applicable Math$/.test(a.name))!;

    // Pick a real cohort student and a scored item they answered CORRECTLY.
    const excludedStaff = new Set([idOf("student15@example.edu"), idOf("student16@example.edu")]);
    const mathRows = cleanedResponses.filter((r) => r.assessmentName === math.name);
    const scoredItemIds = new Set(math.items.filter((it) => (it.maxScore ?? 1) >= 1).map((it) => it.id));
    const correct = mathRows.find(
      (r) => !excludedStaff.has(r.participantPseudonym) && r.answerScore === 1 && scoredItemIds.has(r.qmQuestionId),
    )!;
    const pid = correct.participantPseudonym;
    const itemId = correct.qmQuestionId;

    const mathCell = () => p.getComposition(CYCLE)!.students.find((s) => s.participantId === pid)!
      .subjects.find((su) => su.assessmentId === math.id)!;

    // ── baseline ──────────────────────────────────────────────────────────────
    const base = mathCell();
    const mcq0 = base.mcq;
    const max0 = base.max; // 40 (one max-0 stimulus already out of the denominator)
    expect(max0).toBe(40);
    expect(base.pct).toBe(round((mcq0 / max0) * 100, 2));

    // ── Question review: exclude one correctly-answered item ────────────────────
    // Numerator −1 (earned) AND denominator −1 (max) move together.
    p.setItemExcluded(CYCLE, math.id, itemId, true, "flagged in review");
    const afterExcl = mathCell();
    expect(afterExcl.mcq).toBe(mcq0 - 1);
    expect(afterExcl.max).toBe(max0 - 1);
    expect(afterExcl.pct).toBe(round(((mcq0 - 1) / (max0 - 1)) * 100, 2));

    // ── Technical adjustment: +2 earned marks (numerator only) ──────────────────
    const target = mcq0 - 1 + 2;
    p.adjustStudentMark(CYCLE, pid, math.id, target, "technical adjustment");
    const afterAdj = mathCell();
    expect(afterAdj.total).toBe(target); // numerator = adjusted earned marks (mcq + adj)
    expect(afterAdj.alterations).toBe(target - (mcq0 - 1)); // the +2 delta rides alterations
    expect(afterAdj.max).toBe(max0 - 1); // denominator unchanged by the adjustment
    const expectedPct = round((target / (max0 - 1)) * 100, 2);
    expect(afterAdj.pct).toBe(expectedPct);

    // ── Grades: the exclusion + adjustment flow into the final award ────────────
    const grades = p.getGrades(CYCLE)!;
    const row = grades.rows.find((r) => r.id === pid)!;
    const expectedGrade = classify(expectedPct, grades.performanceLevels, DEFAULT_PERFORMANCE_CUTS);
    expect(row.grades[math.id]!.level).toBe(expectedGrade);
  });
});
