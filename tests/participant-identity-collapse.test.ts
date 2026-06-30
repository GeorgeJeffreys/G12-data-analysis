/**
 * Participant IDENTITY collapse at ingest — the ~8-per-subject bug (P1-followup-2).
 *
 * The de-identified 700435 fixture (`tests/fixtures/qm/*.csv`) gives every
 * participant a UNIQUE `ResultParticipantName` (a synthetic email), which sanitises
 * away the real cohort's identity shapes — so it cannot reproduce the collapse.
 * This suite drives a COLLIDING-identity variant (`tests/fixtures/qm-collide/*.csv`)
 * that mirrors the real roster: `ResultParticipantName` is a NON-unique
 * initial-based login code (3 students share "A-A", 2 share "F-A", 2 share "M-A",
 * two "Nour" first names, many "Al-" surnames, RTL Arabic names), while a
 * guaranteed-unique `ParticipantID` and unique `ResultId`s identify each student.
 *
 * It proves three things:
 *   1. The collision shape WOULD collapse a name/initial-keyed ingest below the
 *      true sitter count (the bug), and the detection-boundary invariant catches it.
 *   2. The fixed ingest keys identity on the guaranteed-unique ParticipantID, so the
 *      Upload/detection participant counts hit the oracle exactly and the per-student
 *      score matrix reconciles (no merge / overwrite).
 *   3. Cohort exclusion of the staff + test accounts propagates to the per-subject
 *      counts without dropping any real sitter below the true count.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ingestThreeExports,
  type NamedInput,
} from "@/lib/ingest/qm";
import { assertParticipantIdentityIntact } from "@/lib/ingest";
import { parseCsv } from "@/lib/ingest/qm/csv";
import { buildLiveCycleData } from "@/lib/data/build-live-cycle";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { ENGINE_VERSION } from "@/lib/engine";
import type { CleanResponse } from "@/lib/ingest/types";
import type { Seed } from "@/lib/data/seed-types";

const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const collideDir = path.join(here, "fixtures", "qm-collide");
// Only the Assessments export carries participant identity, so the colliding
// variant overrides just that file; Items + Topics (byte-identical, ~1.5 MB) are
// reused from the de-identified 700435 fixture and join on the same ResultIds.
const read = (name: string) => readFileSync(path.join(qmDir, `${name}.csv`));
const files = (): NamedInput[] => [
  { name: "Items.csv", data: read("Items") },
  { name: "Assessments.csv", data: readFileSync(path.join(collideDir, "Assessments.csv")) },
  { name: "Topics.csv", data: read("Topics") },
];

// The two non-real accounts (staff + test) in the colliding roster, by ParticipantID.
const LAVINIA = "L-C-800101"; // G12 Lead (staff) — English only
const MUAMINA = "M-M-800202"; // re-sit / test — Math re-sit form + Life Skills

const CYCLE = "live";

function buildProvider(excludeStaffTest: boolean) {
  const { cleanedResponses, validationReport, canonical } = ingestThreeExports(files());
  const built = buildLiveCycleData(cleanedResponses);
  const seed: Seed = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    engineVersion: ENGINE_VERSION,
    liveCycle: {
      id: CYCLE,
      name: "Sitting 700435 (colliding identities)",
      region: "EU",
      startedAt: "x",
      lastActivity: "x",
      stageIndex: 1,
      fileName: "qm",
      fileSizeMB: 1,
      uploadedAgo: "now",
      validation: validationReport,
      preview: built.preview,
      duplicates: 0,
      participants: built.participants,
      assessments: built.assessments,
      diagnostics: built.diagnostics,
    },
    priorCycles: [],
  };
  const p = new InMemoryDataProvider(seed);
  const idOf = (pid: string) => built.participants.find((x) => x.studentId === pid)!.id;
  if (excludeStaffTest) {
    p.excludeParticipantFromCohort(CYCLE, idOf(LAVINIA), true, "G12 Lead (staff account)");
    p.excludeParticipantFromCohort(CYCLE, idOf(MUAMINA), true, "Re-sit / test account");
  }
  const assessmentByName = (re: RegExp) => built.assessments.find((a) => re.test(a.name))!.id;
  return { p, built, idOf, canonical, cleanedResponses, validationReport, assessmentByName };
}

describe("participant identity collapse — colliding-identity fixture", () => {
  // ── the collision shape is real (and not in the unique fields) ─────────────
  it("the fixture genuinely collides on ResultParticipantName but not on the unique id", () => {
    const rows = parseCsv(readFileSync(path.join(collideDir, "Assessments.csv"))).rows.filter(
      (r) => !/survey/i.test(r["AssessmentName"] ?? ""),
    );
    const names = new Set(rows.map((r) => r["ResultParticipantName"]));
    const ids = new Set(rows.map((r) => r["ParticipantID"]));
    const resultIds = new Set(rows.map((r) => r["ResultId"]));
    // 18 students, but only 14 distinct initial-codes — a name/initial key collapses.
    expect(ids.size).toBe(18);
    expect(names.size).toBeLessThan(ids.size);
    // The result→participant mapping is fully unique (one ResultId per sitting).
    expect(resultIds.size).toBeGreaterThan(ids.size);
  });

  // ── 1. the detection-boundary invariant catches a collapse ─────────────────
  it("assertParticipantIdentityIntact throws when distinct sitters fold into fewer participants", () => {
    const collapsed: CleanResponse[] = [
      // two DISTINCT results (sitters) folded onto one pseudonym in one subject.
      { assessmentName: "Math", qmQuestionId: "q1", qmResultId: "R1", qmParticipantId: "A-A", participantPseudonym: "P0001", wording: null, majorElement: null, subElement: null, demandLevel: null, itemSet: null, questionType: "Multiple Choice", maxScore: 1, answerGiven: "a", answerScore: 1, responseTime: null, resultStatus: "Finished OK" },
      { assessmentName: "Math", qmQuestionId: "q1", qmResultId: "R2", qmParticipantId: "A-A", participantPseudonym: "P0001", wording: null, majorElement: null, subElement: null, demandLevel: null, itemSet: null, questionType: "Multiple Choice", maxScore: 1, answerGiven: "b", answerScore: 0, responseTime: null, resultStatus: "Finished OK" },
    ];
    expect(() => assertParticipantIdentityIntact(collapsed)).toThrow(/identity collapse/i);
  });

  it("the fixed ingest of the colliding fixture passes the invariant (no collapse)", () => {
    const { cleanedResponses } = buildProvider(false);
    expect(() => assertParticipantIdentityIntact(cleanedResponses)).not.toThrow();
  });

  // ── 2. identity keys on the guaranteed-unique ParticipantID ────────────────
  it("keys participant identity on the unique ParticipantID, not ResultParticipantName", () => {
    const { built } = buildProvider(false);
    // Every student survives as a distinct identity, and the identity IS the
    // ParticipantID (e.g. "A-A-260111"), never the colliding "A-A" login code.
    expect(built.participants).toHaveLength(18);
    expect(new Set(built.participants.map((p) => p.studentId)).size).toBe(18);
    for (const p of built.participants) {
      expect(p.studentId).toMatch(/^[A-Z]-[A-Z]-\d{6}$/);
    }
  });

  // ── Upload/detection oracle — BEFORE cohort exclusion (18 participants) ─────
  it("Upload/detection participant counts hit the oracle (15/12/12/9/11)", () => {
    const { p } = buildProvider(false);
    const split = p.getCombinedSplit(CYCLE)!;
    expect(split.totalParticipants).toBe(18);
    const count = (re: RegExp) => split.subjects.find((s) => re.test(s.name))!.participants;
    expect(count(/Applicable Math$/)).toBe(15);
    expect(count(/English/)).toBe(12);
    expect(count(/Scientific/)).toBe(12);
    expect(count(/العربيّة/)).toBe(9);
    expect(count(/Life/)).toBe(11);
    // No subject falls below its true sitter count (the collapse signature).
    for (const s of split.subjects) expect(s.participants).toBeGreaterThan(0);
  });

  // ── per-subject counts AFTER staff/test exclusion (16 students) ────────────
  it("after excluding the staff + test accounts the counts are 15/11/12/9/10", () => {
    const { p, built } = buildProvider(true);
    expect(p.getCycle(CYCLE)!.participants).toBe(16);
    const count = (re: RegExp) => {
      const id = built.assessments.find((a) => re.test(a.name))!.id;
      return p.getNaiveScores(CYCLE, id)!.students.length;
    };
    expect(count(/Applicable Math$/)).toBe(15);
    expect(count(/English/)).toBe(11);
    expect(count(/Scientific/)).toBe(12);
    expect(count(/العربيّة/)).toBe(9);
    expect(count(/Life/)).toBe(10);
  });

  // ── 3. the per-student score matrix reconciles (no merge / overwrite) ──────
  it("all 15 Applicable Math students survive with the exact oracle raw scores", () => {
    const { p, assessmentByName } = buildProvider(true);
    const mathId = assessmentByName(/Applicable Math$/);
    const comp = p.getComposition(CYCLE)!;
    const math = comp.students
      .map((s) => s.subjects.find((su) => su.assessmentId === mathId))
      .filter((su): su is NonNullable<typeof su> => !!su);
    expect(math).toHaveLength(15);
    // Identical distribution to the de-identified 700435 oracle — proving the
    // colliding identities are correctly separated, not merged/overwritten.
    const mcqSorted = math.map((s) => s.mcq).sort((a, b) => b - a);
    expect(mcqSorted).toEqual([24, 19, 19, 19, 17, 17, 17, 16, 16, 16, 16, 14, 14, 14, 10]);
    for (const s of math) expect(s.max).toBe(40);
  });

  it("the staff + test accounts are absent from Score, Grades and Raw scores", () => {
    const { p, idOf, assessmentByName } = buildProvider(true);
    const lavinia = idOf(LAVINIA);
    const muamina = idOf(MUAMINA);
    const grades = p.getGrades(CYCLE)!;
    expect(grades.rows.some((r) => r.id === lavinia)).toBe(false);
    expect(grades.rows.some((r) => r.id === muamina)).toBe(false);
    const english = p.getNaiveScores(CYCLE, assessmentByName(/English/))!;
    expect(english.students.some((s) => s.id === lavinia)).toBe(false);
    const life = p.getNaiveScores(CYCLE, assessmentByName(/Life/))!;
    expect(life.students.some((s) => s.id === muamina)).toBe(false);
  });
});
