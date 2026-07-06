/**
 * READ-PATH count assertion (task 21) — every UI participant count must read from
 * the `sittings` roster (migration 0026), not the stale pre-0026 source.
 *
 * The C2 write path is correct (sittings holds 15/12/12/9/11, 18 distinct); this
 * guards the READ layer so it can never silently diverge from the DB again. It
 * drives the REAL pipeline (ingest 3-CSV → buildLiveCycleData → InMemoryDataProvider)
 * over the de-identified 700435 fixture and asserts the STAGE-AWARE targets:
 *
 *   Ingested (staff INCLUDED)  — Upload detected-subjects + Data-flow "Ingested":
 *       Applicable Math 15 · English 12 · Scientific 12 · Arabic 9 · Life 11  (18 total)
 *   Cleaned (staff EXCLUDED)   — Clean / Score / Grades + Data-flow "Cleaned"/"Computed":
 *       Applicable Math 15 · English 11 · Scientific 12 · Arabic 9 · Life 10  (16 total)
 *
 * The staff/test accounts (student15 = Lavinia, English; student16 = Muamina, Life)
 * are present at ingest and removed at Clean — a legitimate 18→16 reduction, and the
 * ONLY drop between stages.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ingestThreeExports, type NamedInput } from "@/lib/ingest/qm";
import { buildLiveCycleData } from "@/lib/data/build-live-cycle";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { resolveCohort } from "@/lib/data/resolved-cohort";
import { buildDataFlow } from "@/lib/data/data-flow";
import { ENGINE_VERSION } from "@/lib/engine";
import type { Seed } from "@/lib/data/seed-types";

const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const read = (name: string) => readFileSync(path.join(qmDir, `${name}.csv`));
const files = (): NamedInput[] => [
  { name: "Items.csv", data: read("Items") },
  { name: "Assessments.csv", data: read("Assessments") },
  { name: "Topics.csv", data: read("Topics") },
];

const LAVINIA = "student15@example.edu"; // staff — English only
const MUAMINA = "student16@example.edu"; // test — Life Skills (+ re-sit)
const CYCLE = "live";

const SUBJECT = {
  math: /Applicable Math$/,
  english: /English/,
  scientific: /Scientific/,
  arabic: /العربيّة/,
  life: /Life/,
} as const;

/** Build a provider from the REAL ingest, with the two staff/test accounts excluded
 *  at Clean via the same cohort-exclusion the app uses. */
function buildProvider() {
  const { cleanedResponses, validationReport } = ingestThreeExports(files());
  const built = buildLiveCycleData(cleanedResponses);
  const seed: Seed = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    engineVersion: ENGINE_VERSION,
    liveCycle: {
      id: CYCLE,
      name: "Sitting 700435",
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
      sittings: built.sittings, // the authoritative ingest roster
    },
    priorCycles: [],
  };
  const p = new InMemoryDataProvider(seed);
  const idOf = (email: string) => built.participants.find((x) => x.studentId === email)!.id;
  // Staff/test excluded at Clean (the same cohort exclusion Clean/Score/Grades read).
  p.excludeParticipantFromCohort(CYCLE, idOf(LAVINIA), true, "G12 Lead (staff account)");
  p.excludeParticipantFromCohort(CYCLE, idOf(MUAMINA), true, "Re-sit / test account");
  const assessmentId = (re: RegExp) => built.assessments.find((a) => re.test(a.name))!.id;
  return { p, assessmentId };
}

describe("read-path counts read from the sittings roster (700435)", () => {
  let p: InMemoryDataProvider;
  let assessmentId: (re: RegExp) => string;

  beforeAll(() => {
    ({ p, assessmentId } = buildProvider());
  });

  it("getSittingRoster: per-subject distinct participants (staff incl) = 15/12/12/9/11, total 18", () => {
    const roster = p.getSittingRoster(CYCLE)!;
    const size = (re: RegExp) => roster.byAssessment.get(assessmentId(re))!.size;
    expect(size(SUBJECT.math)).toBe(15);
    expect(size(SUBJECT.english)).toBe(12);
    expect(size(SUBJECT.scientific)).toBe(12);
    expect(size(SUBJECT.arabic)).toBe(9);
    expect(size(SUBJECT.life)).toBe(11);
    expect(roster.totalParticipants).toBe(18);
  });

  it("Upload detected-subjects (getCombinedSplit) reads the ingest roster: 15/12/12/9/11, total 18", () => {
    const split = p.getCombinedSplit(CYCLE)!;
    const part = (re: RegExp) => split.subjects.find((s) => re.test(s.name))!.participants;
    expect(part(SUBJECT.math)).toBe(15);
    expect(part(SUBJECT.english)).toBe(12);
    expect(part(SUBJECT.scientific)).toBe(12);
    expect(part(SUBJECT.arabic)).toBe(9);
    expect(part(SUBJECT.life)).toBe(11);
    expect(split.totalParticipants).toBe(18);
  });

  it("resolved cohort: ingest stage staff-INCLUDED (15/12/12/9/11, 18); cleaned staff-EXCLUDED (15/11/12/9/10, 16)", () => {
    const r = resolveCohort(p, CYCLE)!;
    const subj = (re: RegExp) => r.subjects.find((s) => re.test(s.name))!;
    // Ingested (detected) — staff included.
    expect(subj(SUBJECT.math).detected.size).toBe(15);
    expect(subj(SUBJECT.english).detected.size).toBe(12);
    expect(subj(SUBJECT.scientific).detected.size).toBe(12);
    expect(subj(SUBJECT.arabic).detected.size).toBe(9);
    expect(subj(SUBJECT.life).detected.size).toBe(11);
    expect(r.detectedTotal).toBe(18);
    // Cleaned — staff excluded (English 12→11, Life 11→10).
    expect(subj(SUBJECT.math).cleaned.size).toBe(15);
    expect(subj(SUBJECT.english).cleaned.size).toBe(11);
    expect(subj(SUBJECT.scientific).cleaned.size).toBe(12);
    expect(subj(SUBJECT.arabic).cleaned.size).toBe(9);
    expect(subj(SUBJECT.life).cleaned.size).toBe(10);
    expect(r.cleanedTotal).toBe(16);
  });

  it("Data flow: 18 ingested → 16 after Clean, the staff drop is the ONLY reduction (healthy)", () => {
    const m = buildDataFlow(p, CYCLE)!;
    // Distinct totals across the cycle (not the 59 sum of per-subject counts).
    expect(m.totals).toEqual([18, 16, 16, 16]);
    expect(m.ingested).toBe(18);
    expect(m.cleaned).toBe(16);
    expect(m.computed).toBe(16);
    expect(m.removedByCleaning).toBe(2); // the two staff/test accounts (expected)
    expect(m.lost).toBe(0); // no unexpected loss after Clean
    expect(m.state).toBe("healthy");
    expect(m.worstStage).toBeNull();

    // Per-subject: staff included at Ingested, excluded at Cleaned; matrix/computed hold.
    const row = (re: RegExp) => m.subjects.find((s) => re.test(s.name))!;
    expect(row(SUBJECT.english).counts).toEqual([12, 11, 11, 11]);
    expect(row(SUBJECT.life).counts).toEqual([11, 10, 10, 10]);
    expect(row(SUBJECT.math).counts).toEqual([15, 15, 15, 15]);
    // No subject drops between Cleaned → matrix → computed (no collapse).
    for (const s of m.subjects) {
      expect(s.counts[2]).toBe(s.counts[1]);
      expect(s.counts[3]).toBe(s.counts[2]);
    }
  });

  it("cleaned cohort (Score/Grades) reads 16 and per-subject 15/11/12/9/10", () => {
    expect(p.getCycle(CYCLE)!.participants).toBe(16);
    const scored = (re: RegExp) => p.getNaiveScores(CYCLE, assessmentId(re))!.students.length;
    expect(scored(SUBJECT.math)).toBe(15);
    expect(scored(SUBJECT.english)).toBe(11);
    expect(scored(SUBJECT.scientific)).toBe(12);
    expect(scored(SUBJECT.arabic)).toBe(9);
    expect(scored(SUBJECT.life)).toBe(10);
  });
});
