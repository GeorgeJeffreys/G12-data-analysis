/**
 * PIPELINE COUNT ASSERTION — the C2 guardrail for the natural-key rebuild
 * (migration 0026). A fresh ingest of the 700435 CSVs must persist the clean
 * natural-key spine (sittings keyed by qm_result_id; responses by
 * (qm_result_id, question_id)) with the CORRECT per-subject cohort, so a
 * whole-sitting collapse or a subject-merge fails CI instead of surfacing on the
 * live app as "9/7/8/8/4".
 *
 * It drives the REAL persist path (ingestThreeExports → ingestCleanResponses) and
 * asserts, on the captured `ingest_persist` payload:
 *   • per-subject DISTINCT participants (staff/test excluded) = 15 / 11 / 12 / 9 / 10
 *     (Applicable Math / English / Scientific / Arabic / Life), 57 real sittings;
 *   • Dalal Hasan's Math sitting (ResultId 1572504488) is present and attaches its
 *     responses (no empty/all-dots collapse);
 *   • NO ResultId spans >1 subject (the synthetic-id merge signature);
 *   • sitting-records ≫ participants (identity ≠ sitting).
 *
 * The 700435 fixture is de-identified (student01…student18); the two staff/test
 * accounts are student15 (Lavinia, English) / student16 (Muamina, Life), matching
 * data-selection-700435.test.ts. Engine + fixtures untouched.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ingestThreeExports, type NamedInput } from "@/lib/ingest/qm";
import { makeRpcAdmin, type RpcCall } from "./helpers/mock-rpc-admin";

vi.mock("server-only", () => ({}));

const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const read = (n: string) => readFileSync(path.join(qmDir, `${n}.csv`));
const files = (): NamedInput[] => [
  { name: "Items.csv", data: read("Items") },
  { name: "Assessments.csv", data: read("Assessments") },
  { name: "Topics.csv", data: read("Topics") },
];

const CYCLE = "00000000-0000-0000-0000-0000000000c2";
// De-identified staff/test accounts in the 700435 fixture (see the test above).
const STAFF = new Set(["student15@example.edu", "student16@example.edu"]);

type Row = Record<string, unknown>;
const email = (r: Row) => String(r.participant_email ?? "").toLowerCase();
const isStaff = (r: Row) => STAFF.has(email(r));

async function ingest() {
  const { ingestCleanResponses } = await import("@/lib/server/ingest-write");
  const { cleanedResponses, canonical, validationReport } = ingestThreeExports(files());
  const calls: RpcCall[] = [];
  await ingestCleanResponses(makeRpcAdmin(calls) as never, CYCLE, cleanedResponses, {
    createdBy: "11111111-1111-1111-1111-111111111111",
    canonical,
    report: validationReport,
  });
  return calls[0]!.args.p_payload;
}

/** Match a subject by the assessment name the sitting carries. */
const SUBJECTS = {
  math: /Applicable Math$/,
  english: /English/,
  scientific: /Scientific/,
  arabic: /العربيّة/,
  life: /Life/,
} as const;

describe("pipeline count assertion — 700435 natural-key spine", () => {
  let sittings: Row[];
  let responses: Row[];

  beforeAll(async () => {
    const payload = await ingest();
    sittings = payload.sittings as Row[];
    responses = payload.responses as Row[];
  });

  it("persists sittings keyed by qm_result_id, well above the participant count", () => {
    const resultIds = new Set(sittings.map((s) => s.qm_result_id));
    const emails = new Set(sittings.map(email));
    // 59 graded sittings (incl. 2 staff) across 18 participants — sitting ≠ identity.
    expect(resultIds.size).toBe(sittings.length); // one row per sitting (no collision)
    expect(resultIds.size).toBeGreaterThan(emails.size);
    expect(emails.size).toBe(18);
  });

  it("per-subject distinct participants (staff excluded) = 15 / 11 / 12 / 9 / 10", () => {
    const real = sittings.filter((s) => !isStaff(s));
    const distinct = (re: RegExp) =>
      new Set(real.filter((s) => re.test(String(s.subject_name))).map(email)).size;

    expect(distinct(SUBJECTS.math)).toBe(15);
    expect(distinct(SUBJECTS.english)).toBe(11);
    expect(distinct(SUBJECTS.scientific)).toBe(12);
    expect(distinct(SUBJECTS.arabic)).toBe(9);
    expect(distinct(SUBJECTS.life)).toBe(10);

    // 57 real sittings total after the staff/test exclusion.
    expect(real.length).toBe(57);
  });

  it("Dalal Hasan's Math sitting (ResultId 1572504488) is present and attaches responses", () => {
    const dalal = sittings.find((s) => String(s.qm_result_id) === "1572504488");
    expect(dalal, "Dalal Hasan's Math sitting must be present (not dropped on collision)").toBeTruthy();
    expect(String(dalal!.subject_name)).toMatch(SUBJECTS.math);
    // Her sitting attaches its question responses (not an empty/all-dots row).
    const answers = responses.filter((r) => String(r.qm_result_id) === "1572504488");
    expect(answers.length).toBeGreaterThan(0);
  });

  it("NO ResultId spans more than one subject (the synthetic-id merge signature)", () => {
    const subjectsByResult = new Map<string, Set<string>>();
    for (const s of sittings) {
      const rid = String(s.qm_result_id);
      (subjectsByResult.get(rid) ?? subjectsByResult.set(rid, new Set()).get(rid)!).add(String(s.assessment_id));
    }
    const spanning = [...subjectsByResult.entries()].filter(([, set]) => set.size > 1);
    expect(spanning, `ResultIds spanning >1 subject: ${spanning.map(([r]) => r).join(", ")}`).toHaveLength(0);

    // Same at the response grain: each qm_result_id maps to exactly one assessment.
    const respByResult = new Map<string, Set<string>>();
    for (const r of responses) {
      const rid = String(r.qm_result_id);
      (respByResult.get(rid) ?? respByResult.set(rid, new Set()).get(rid)!).add(String(r.assessment_id));
    }
    expect([...respByResult.values()].every((set) => set.size === 1)).toBe(true);
  });

  it("responses are unique at the natural (qm_result_id, question_id) grain", () => {
    const key = new Set(responses.map((r) => `${r.qm_result_id}|${r.question_id}`));
    expect(key.size).toBe(responses.length);
  });
});
