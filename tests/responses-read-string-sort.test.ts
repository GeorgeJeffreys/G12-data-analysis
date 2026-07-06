/**
 * String-sort whole-sitting collapse — the READ path (task 22).
 *
 * THE PROVEN BUG. `responses` carries one row per sitting × question and routinely
 * exceeds PostgREST's max-rows cap; `sittings` (one row per sitting) does not. The
 * read `supabase.from("responses").select("*").eq("cycle_id", …)` gave no explicit
 * `ORDER BY`/`.range()`, so PostgREST served rows via the btree on the unique key
 * `(cycle_id, qm_result_id, question_id)` — i.e. ordered by `qm_result_id` AS TEXT —
 * and truncated at the cap. The survivors were therefore the LEXICALLY-FIRST
 * ResultIds, and whole sittings past the cut vanished (Applicable Math 15 → 6). The
 * dropped ids are not smaller NUMBERS — they sort later as STRINGS.
 *
 * This drives the REAL `hydrate()` against a faithful PostgREST stand-in that caps
 * at max-rows and serves un-ordered reads in text-index order (exactly the
 * production behaviour). The ResultIds are chosen so string order ≠ number order:
 * the numerically-SMALLEST ids (`9990000…`, 9 digits) sort LAST as text and are the
 * first the buggy read dropped. The fix (selAllByCycle pages every row in explicit
 * key order) must return ALL 15 sittings into the score matrix — the collapse
 * cannot recur.
 */
import { describe, it, expect } from "vitest";
import { hydrate } from "@/lib/data/supabase-hydrate";
import { makeSupabaseReadClient, type MockDb, type MockClientOptions } from "@/tests/helpers/mock-supabase-read";

const CYCLE = "cycle-strsort";
const AID = "assess-math";

// 15 ResultIds whose STRING order differs from their NUMBER order:
//   text order:   "1000000001".. < "35300000001".. < "999000001"..   (by first char 1<3<9)
//   number order: 999000001 (9e8) < 1000000001 (1e9) < 35300000001 (3.5e10)
// So the numerically-SMALLEST ("999…", 9-digit) sort LAST as text — the first a
// text-ordered, capped read drops. A number-aware key would keep them.
const RESULT_IDS = [
  "1000000001", "1000000002", "1000000003", "1000000004", "1000000005",
  "35300000001", "35300000002", "35300000003", "35300000004", "35300000005",
  "999000001", "999000002", "999000003", "999000004", "999000005",
];
const NUMERIC_SMALLEST = ["999000001", "999000002", "999000003", "999000004", "999000005"]; // string-LAST
const N_ITEMS = 5; // 15 sittings × 5 items = 75 response rows

/** Stage a one-subject cycle with 15 full sittings as a hydratable database. */
function makeDb(): MockDb {
  const items = Array.from({ length: N_ITEMS }, (_, q) => ({
    id: `item-q${q + 1}`, cycle_id: CYCLE, assessment_id: AID, qm_question_id: `Q${q + 1}`,
    wording: `Q${q + 1}`, major_element: "Elem", sub_element: null, demand_level: null,
    item_set: null, max_score: 1, status: "active", created_at: "2026-05-01T00:00:00Z",
  }));
  const participants = RESULT_IDS.map((rid, i) => ({
    id: `part-${i}`, cycle_id: CYCLE, qm_participant_id: `student${i}@example.edu`,
    pseudonym_id: `P${String(i + 1).padStart(4, "0")}`, full_name: null, email: `student${i}@example.edu`,
    dob: null, gender: null, created_at: "2026-05-01T00:00:00Z",
  }));
  const sittings = RESULT_IDS.map((rid, i) => ({
    cycle_id: CYCLE, qm_result_id: rid, participant_email: `student${i}@example.edu`,
    participant_id: `part-${i}`, assessment_id: AID, subject_name: "Applicable Math",
    result_status: null, attempt_number: 1, total_score: N_ITEMS, maximum_score: N_ITEMS,
    percentage_score: 100, scoreband: null, sitting: "MAY2026", reconciled: true,
    created_at: "2026-05-01T00:00:00Z",
  }));
  const responses: Record<string, unknown>[] = [];
  RESULT_IDS.forEach((rid, i) => {
    for (let q = 0; q < N_ITEMS; q++) {
      responses.push({
        id: `resp-${i}-${q}`, cycle_id: CYCLE, qm_result_id: rid, question_id: `Q${q + 1}`,
        participant_email: `student${i}@example.edu`, participant_id: `part-${i}`,
        item_id: `item-q${q + 1}`, assessment_id: AID, answer_given: "A", answer_score: 1,
        response_time: 10, result_status: null, question_type: "Multiple Choice", question_status: null,
        created_at: "2026-05-01T00:00:00Z",
      });
    }
  });
  return {
    exam_cycles: [{ id: CYCLE, name: "G12++ May 2026", status: "scored", region: "eu", year_id: null, sitting: "may", created_by: "u1", created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-02T00:00:00Z" }],
    test_centres: [], exam_years: [],
    assessments: [{ id: AID, cycle_id: CYCLE, name: "G12++ Applicable Math", item_count: N_ITEMS, status: "scored", created_at: "2026-05-01T00:00:00Z" }],
    items, participants, sittings, responses,
    item_stats: [], item_reviews: [], grade_schemes: [], grades: [], essay_marks: [],
    incidents: [], alterations: [], distinction_overrides: [], workspace_settings: [],
    element_labels: [], clean_exclusions: [], distinction_state: [], document_settings: [], import_batches: [],
  };
}

// The PostgREST cap + text-index order that produced the production collapse. 30 < 75
// so an unbounded read keeps only 6 of the 15 sittings.
const POSTGREST: MockClientOptions = {
  maxRows: 30,
  defaultOrder: { responses: ["qm_result_id", "question_id"] },
};

describe("responses read — string-sort whole-sitting collapse (task 22)", () => {
  it("the scenario is a genuine collapse: an UNBOUNDED text-ordered read keeps only 6 of 15 sittings", async () => {
    // Reproduces exactly what the buggy `.select("*").eq(...)` returned.
    const client = makeSupabaseReadClient(makeDb(), POSTGREST);
    const { data } = (await client.from("responses").select("*").eq("cycle_id", CYCLE)) as { data: Record<string, unknown>[] };
    expect(data.length).toBe(30); // truncated at the cap
    const survivors = new Set(data.map((r) => r.qm_result_id as string));
    expect(survivors.size).toBe(6); // 6 whole sittings — the string-first ResultIds
    // The numerically-smallest ("999…") sittings are the ones dropped (string-last).
    for (const rid of NUMERIC_SMALLEST) expect(survivors.has(rid)).toBe(false);
  });

  it("hydrate() pages the read and keeps ALL 15 sittings in the score matrix", async () => {
    const h = await hydrate(makeSupabaseReadClient(makeDb(), POSTGREST) as never);
    expect(h).not.toBeNull();
    const math = h!.seed.liveCycle.assessments.find((a) => /Applicable Math/.test(a.name))!;
    // The score-matrix cohort = distinct participants in the assessment's responses.
    const students = new Set(math.responses.map((r) => r.p));
    expect(students.size).toBe(15);
    // Every sitting survived: the roster maps all 15 ResultIds to a participant.
    const resultIdByParticipant = math.resultIdByParticipant ?? {};
    expect(new Set(Object.values(resultIdByParticipant)).size).toBe(15);
    // The numerically-smallest / string-last sittings — the bug's first casualties —
    // are present with their full 5-item rows.
    const idByPart = new Map(h!.seed.liveCycle.participants.map((p) => [p.id, p.studentId]));
    const seenResultIds = new Set(Object.values(resultIdByParticipant));
    for (const rid of NUMERIC_SMALLEST) expect(seenResultIds.has(rid)).toBe(true);
    // 15 students × 5 items, every cell present.
    expect(math.responses.length).toBe(75);
    expect(idByPart.size).toBe(15);
  });

  it("with no cap the counts are identical — pagination changes nothing when nothing overflows", async () => {
    const h = await hydrate(makeSupabaseReadClient(makeDb()) as never);
    const math = h!.seed.liveCycle.assessments.find((a) => /Applicable Math/.test(a.name))!;
    expect(new Set(math.responses.map((r) => r.p)).size).toBe(15);
  });
});
