/**
 * Integrity guards against the whole-sitting collapse (task 22).
 *
 * The decisive defences that make a collapsed `responses` impossible to ship,
 * from either side of the write:
 *   1. CLIENT (ingest-write): `assertResponsesCoverSittings` rejects a payload whose
 *      responses hold fewer distinct sittings than the roster, per subject.
 *   2. SERVER (migration 0030): the same per-subject assertion inside the persist
 *      transaction (text-locked here — the SQL is applied by hand in Supabase).
 *   3. READ (hydrate): a responses read that drops whole sittings is refused rather
 *      than rendered as a silently-collapsed score matrix.
 * Plus the acceptance gate: 3 fresh ingests of the 700435 fixture each keep every
 * sitting (Math 15, no drop).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));

const here = path.dirname(fileURLToPath(import.meta.url));

// ── 1. Client-side integrity guard ──────────────────────────────────────────
describe("assertResponsesCoverSittings — client integrity guard", () => {
  it("rejects a collapsed responses payload (fewer distinct sittings than the roster)", async () => {
    const { assertResponsesCoverSittings } = await import("@/lib/server/ingest-write");
    // Subject A has 3 sittings but responses kept only 2 — the collapse signature.
    const sittings = [
      { assessment_id: "A", qm_result_id: "1000000001" },
      { assessment_id: "A", qm_result_id: "35300000001" },
      { assessment_id: "A", qm_result_id: "999000001" }, // string-last: the dropped one
    ];
    const responses = [
      { assessment_id: "A", qm_result_id: "1000000001", question_id: "Q1" },
      { assessment_id: "A", qm_result_id: "35300000001", question_id: "Q1" },
    ];
    expect(() => assertResponsesCoverSittings(responses, sittings)).toThrow(/whole-sitting collapse|responses 2 vs sittings 3/i);
  });

  it("accepts a complete payload (every sitting carried into responses)", async () => {
    const { assertResponsesCoverSittings } = await import("@/lib/server/ingest-write");
    const sittings = [
      { assessment_id: "A", qm_result_id: "1000000001" },
      { assessment_id: "A", qm_result_id: "999000001" },
    ];
    const responses = [
      { assessment_id: "A", qm_result_id: "1000000001", question_id: "Q1" },
      { assessment_id: "A", qm_result_id: "999000001", question_id: "Q1" },
    ];
    expect(() => assertResponsesCoverSittings(responses, sittings)).not.toThrow();
  });

  it("skips subjects that carry no MCQ responses (a held-out re-sit form is not a collapse)", async () => {
    const { assertResponsesCoverSittings } = await import("@/lib/server/ingest-write");
    const sittings = [
      { assessment_id: "MATH", qm_result_id: "1000000001" },
      { assessment_id: "RESIT", qm_result_id: "2000000001" }, // no responses at all
    ];
    const responses = [{ assessment_id: "MATH", qm_result_id: "1000000001", question_id: "Q1" }];
    expect(() => assertResponsesCoverSittings(responses, sittings)).not.toThrow();
  });
});

// ── 2. Server-side guard (migration 0030 text lock) ─────────────────────────
describe("migration 0030 — per-subject responses↔sittings integrity", () => {
  const SQL = readFileSync(resolve(here, "../supabase/migrations/0030_responses_subject_sitting_integrity.sql"), "utf8");
  const ROLLBACK = readFileSync(resolve(here, "../supabase/migrations/0030_responses_subject_sitting_integrity.rollback.sql"), "utf8");

  it("(a) ingest_persist carries a PER-SUBJECT distinct-sitting count assertion that raises", () => {
    const fn = SQL.slice(SQL.search(/function public\.ingest_persist/i), SQL.search(/function public\.schema_health/i));
    // Grouped-by-assessment count comparison of distinct qm_result_id.
    expect(fn).toMatch(/count\(distinct qm_result_id\)[\s\S]*group by assessment_id/i);
    expect(fn).toMatch(/raise exception[\s\S]*per-subject whole-sitting collapse/i);
    // Retains the 0029 guards (whole-sitting + roster↔responses) and the plain insert.
    expect(fn).toMatch(/whole-sitting drop/i);
    expect(fn).not.toMatch(/insert into responses[\s\S]*?on conflict/i);
    const sittingsAt = fn.search(/insert into sittings/i);
    const responsesAt = fn.search(/insert into responses/i);
    expect(responsesAt).toBeGreaterThan(sittingsAt); // FK order: parent first
  });

  it("(b) schema_health probes the LIVE body for the per-subject guard and reports '0030'", () => {
    expect(SQL).toMatch(/'migration',\s*'0030'/);
    expect(SQL).toMatch(/pg_get_functiondef\(p\.oid\) ilike '%per-subject whole-sitting collapse%'/i);
    expect(SQL).toMatch(/ingest_persist:per-subject sitting-count guard/i);
    // Retains the 0029 whole-sitting probe + the 0026/0028 grain probes.
    expect(SQL).toMatch(/ingest_persist:whole-sitting guard/i);
    expect(SQL).toMatch(/responses_cycle_id_qm_result_id_question_id_key/);
    expect(SQL).toMatch(/topic_rollups_cycle_id_qm_result_id_qm_topic_id_key/);
  });

  it("(c) is functions only — no data drop / row mutation", () => {
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).not.toMatch(/delete from/i);
    expect(SQL).not.toMatch(/update\s+(participant_scores|item_stats|grades|responses|sittings)\b/i);
  });

  it("(d) rollback restores the 0029 ingest_persist + schema_health (reports '0029', drops the per-subject guard)", () => {
    expect(ROLLBACK).toMatch(/create or replace function public\.ingest_persist/i);
    expect(ROLLBACK).toMatch(/create or replace function public\.schema_health/i);
    expect(ROLLBACK).toMatch(/'migration',\s*'0029'/);
    expect(ROLLBACK).not.toMatch(/per-subject whole-sitting collapse/i);
  });
});

// ── 3. Read-side guard: a collapsed responses read is refused, not rendered ──
describe("hydrate read guard — refuses a collapsed score matrix", () => {
  it("throws (naming the subject) when responses is missing whole sittings a subject's roster holds", async () => {
    const { hydrate } = await import("@/lib/data/supabase-hydrate");
    const { makeSupabaseReadClient } = await import("@/tests/helpers/mock-supabase-read");
    const CYCLE = "c-gap";
    const AID = "a-math";
    const ids = ["1000000001", "1000000002", "999000001"]; // 3 sittings
    const db: Record<string, Record<string, unknown>[]> = {
      exam_cycles: [{ id: CYCLE, name: "May", status: "scored", region: "eu", year_id: null, sitting: "may", created_by: "u1", created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-02T00:00:00Z" }],
      test_centres: [], exam_years: [],
      assessments: [{ id: AID, cycle_id: CYCLE, name: "G12++ Applicable Math", item_count: 1, status: "scored", created_at: "2026-05-01T00:00:00Z" }],
      items: [{ id: "i1", cycle_id: CYCLE, assessment_id: AID, qm_question_id: "Q1", wording: "Q1", major_element: "E", sub_element: null, demand_level: null, item_set: null, max_score: 1, status: "active", created_at: "2026-05-01T00:00:00Z" }],
      participants: ids.map((_, i) => ({ id: `p${i}`, cycle_id: CYCLE, qm_participant_id: `s${i}@e.edu`, pseudonym_id: `P${i}`, full_name: null, email: `s${i}@e.edu`, dob: null, gender: null, created_at: "2026-05-01T00:00:00Z" })),
      sittings: ids.map((rid, i) => ({ cycle_id: CYCLE, qm_result_id: rid, participant_email: `s${i}@e.edu`, participant_id: `p${i}`, assessment_id: AID, subject_name: "Math", result_status: null, attempt_number: 1, total_score: 1, maximum_score: 1, percentage_score: 100, scoreband: null, sitting: "MAY2026", reconciled: true, created_at: "2026-05-01T00:00:00Z" })),
      // Responses for only 2 of the 3 sittings — the third whole sitting is missing.
      responses: ids.slice(0, 2).map((rid, i) => ({ id: `r${i}`, cycle_id: CYCLE, qm_result_id: rid, question_id: "Q1", participant_email: `s${i}@e.edu`, participant_id: `p${i}`, item_id: "i1", assessment_id: AID, answer_given: "A", answer_score: 1, response_time: 1, result_status: null, question_type: "Multiple Choice", question_status: null, created_at: "2026-05-01T00:00:00Z" })),
      item_stats: [], item_reviews: [], grade_schemes: [], grades: [], essay_marks: [], incidents: [], alterations: [], distinction_overrides: [], workspace_settings: [], element_labels: [], clean_exclusions: [], distinction_state: [], document_settings: [], import_batches: [],
    };
    await expect(hydrate(makeSupabaseReadClient(db) as never)).rejects.toThrow(/Applicable Math[\s\S]*whole sittings were dropped|dropped on read/i);
  });
});

// ── 4. Acceptance: 3 fresh ingests of 700435 keep every sitting (Math 15) ────
describe("700435 ingest — responses distinct sittings == sittings, per subject (3 fresh cycles)", () => {
  async function ingestCounts() {
    const { ingestThreeExports } = await import("@/lib/ingest/qm");
    const { ingestCleanResponses } = await import("@/lib/server/ingest-write");
    const { makeRpcAdmin } = await import("@/tests/helpers/mock-rpc-admin");
    const qmDir = path.join(here, "fixtures", "qm");
    const rd = (n: string) => readFileSync(path.join(qmDir, `${n}.csv`));
    const files = [
      { name: "Items.csv", data: rd("Items") },
      { name: "Assessments.csv", data: rd("Assessments") },
      { name: "Topics.csv", data: rd("Topics") },
    ];
    const { cleanedResponses, canonical } = ingestThreeExports(files);
    const calls: { name: string; args: { p_payload: { responses: Record<string, unknown>[]; sittings: Record<string, unknown>[]; assessments: Record<string, unknown>[] } } }[] = [];
    // The write itself runs assertResponsesCoverSittings — a collapse would THROW here.
    await ingestCleanResponses(makeRpcAdmin(calls as never) as never, "cycle-x", cleanedResponses, { createdBy: "u1", canonical });
    const p = calls[0]!.args.p_payload;
    const nameById = new Map(p.assessments.map((a) => [a.id as string, a.name as string]));
    const distinct = (rows: Record<string, unknown>[]) => {
      const m = new Map<string, Set<string>>();
      for (const r of rows) (m.get(r.assessment_id as string) ?? m.set(r.assessment_id as string, new Set()).get(r.assessment_id as string)!).add(r.qm_result_id as string);
      return m;
    };
    const sit = distinct(p.sittings);
    const resp = distinct(p.responses);
    const out: Record<string, { sittings: number; responses: number }> = {};
    for (const [aid, s] of sit) out[nameById.get(aid) ?? aid] = { sittings: s.size, responses: resp.get(aid)?.size ?? 0 };
    return out;
  }

  it("Math = 15 (responses == sittings) on 3 independent fresh ingests, no whole-sitting drop", async () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const counts = await ingestCounts();
      const math = Object.entries(counts).find(([n]) => /Applicable Math$/.test(n))![1];
      expect(math.sittings).toBe(15);
      expect(math.responses).toBe(15);
      // Every subject with responses reconciles 1:1.
      for (const [, c] of Object.entries(counts)) {
        if (c.responses > 0) expect(c.responses).toBe(c.sittings);
      }
    }
  });
});
