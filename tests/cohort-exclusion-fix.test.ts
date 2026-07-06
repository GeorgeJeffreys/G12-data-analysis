/**
 * Cohort exclusion — the fix, on top of P-A's stable email-keyed identity. Two seams:
 *
 *   1. STAFF/TEST STATUS IS DATA — a per-cohort `cohort_exclusions` list (migration
 *      0033), keyed on the participant's STABLE natural key (qm_participant_id), NOT
 *      an email hard-coded in source. Listed accounts drop from EVERY subject +
 *      Candidate Scores, and — because the key is data — the exclusion survives a
 *      re-import. On hydrate a row resolves through the stable key to the current row
 *      UUID and is replayed cohort-wide.
 *
 *   2. MANUAL PER-SUBJECT EXCLUSIONS SURVIVE RE-IMPORT — clean_exclusions row targets
 *      carry the participant's stable natural key (qm_participant_id, migration 0016),
 *      so an exclusion recorded before an ingest re-resolves to the freshly-minted row
 *      UUID on hydrate instead of dangling on the old (randomUUID) id.
 *
 * (The server `recomputeAndWrite` honouring these exclusions is covered in
 * engine-write.cohort-exclusion.test.ts.)
 */
import { describe, it, expect, vi } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { hydrate } from "@/lib/data/supabase-hydrate";
import { makeSupabaseReadClient, type MockDb } from "@/tests/helpers/mock-supabase-read";

// The hydrate module is client-safe, but its sibling write path is server-only;
// neutralise `server-only` so the test bundle imports cleanly.
vi.mock("server-only", () => ({}));

// ── Part 1: cohort exclusion is editable DATA, not a hard-coded email list ────
describe("cohort exclusion is data (part 1)", () => {
  it("drops a cohort-excluded participant from grades + the headline count, reversibly", () => {
    const p = new InMemoryDataProvider();
    const cycleId = p.listCycles()[0]!.id;
    const cyc = p.getCycle(cycleId)!;
    // Pick a participant present in every subject so a cohort exclusion drops them
    // from the whole cohort (not just one subject).
    const present = cyc.assessments.map((a) => new Set(p.getNaiveScores(cycleId, a.id)!.students.map((s) => s.id)));
    const victim = [...present[0]!].find((id) => present.every((set) => set.has(id)))!;
    const before = p.getGrades(cycleId)!;
    expect(before.rows.some((r) => r.id === victim)).toBe(true);

    // No email hard-coded in code — the caller supplies the participant id.
    p.excludeParticipantFromCohort(cycleId, victim, true, "Staff / test account");
    const after = p.getGrades(cycleId)!;
    expect(after.rows.some((r) => r.id === victim)).toBe(false);
    expect(after.rows).toHaveLength(before.rows.length - 1);
    expect(p.getCycle(cycleId)!.participants).toBe(cyc.participants - 1);

    // Editable: restoring brings them back everywhere.
    p.excludeParticipantFromCohort(cycleId, victim, false);
    expect(p.getGrades(cycleId)!.rows.some((r) => r.id === victim)).toBe(true);
    expect(p.getCycle(cycleId)!.participants).toBe(cyc.participants);
  });

  it("hydrate resolves a cohort_exclusions row through the stable key and replays it", async () => {
    // A cohort_exclusions row keyed on the stable qm_participant_id (email) — the
    // stored UUID is irrelevant; only the key bridges to the current participant row.
    const h = await hydrate(makeSupabaseReadClient(makeCohortDb("alpha@school.edu")) as any);
    expect(h).not.toBeNull();
    const cohort = h!.decisions.cohortExclusions;
    expect(cohort.map((c) => c.participantId)).toContain("new-uuid-alpha");
    expect(cohort.map((c) => c.participantId)).not.toContain("beta@school.edu");
  });

  it("ignores a cohort_exclusions row whose key matches no current participant", async () => {
    const h = await hydrate(makeSupabaseReadClient(makeCohortDb("ghost@nowhere.edu")) as any);
    expect(h!.decisions.cohortExclusions).toHaveLength(0);
  });
});

// ── Part 2: manual exclusions survive re-import ─────────────────────────────
const CYCLE = "cycle-reimport";

/** A hydratable DB: one subject, two participants, one clean_exclusions row. The
 *  `target_id` is a STALE uuid (as if minted by a PRIOR ingest); `target_key` is
 *  the participant's stable qm_participant_id (survives re-import). */
function makeDb(cleanExclusion: Record<string, unknown>): MockDb {
  return {
    exam_cycles: [{ id: CYCLE, name: "May", status: "scored", region: "eu-west", year_id: null, sitting: "may", created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-02T00:00:00Z" }],
    test_centres: [], exam_years: [],
    assessments: [{ id: "a1", cycle_id: CYCLE, name: "Math", item_count: 1, status: "scored", created_at: "2026-05-01T00:00:00Z" }],
    items: [{ id: "i1", cycle_id: CYCLE, assessment_id: "a1", qm_question_id: "q1", wording: null, major_element: null, sub_element: null, demand_level: null, item_set: null, max_score: 1, status: "active", created_at: "2026-05-01T00:00:00Z" }],
    participants: [
      { id: "new-uuid-alpha", cycle_id: CYCLE, qm_participant_id: "alpha@school.edu", pseudonym_id: "P0001", full_name: "Alpha", created_at: "2026-05-01T00:00:01Z" },
      { id: "new-uuid-beta", cycle_id: CYCLE, qm_participant_id: "beta@school.edu", pseudonym_id: "P0002", full_name: "Beta", created_at: "2026-05-01T00:00:02Z" },
    ],
    responses: [
      { id: "r1", cycle_id: CYCLE, participant_id: "new-uuid-alpha", item_id: "i1", answer_given: "A", answer_score: 1, response_time: null, result_status: null, created_at: "2026-05-01T00:00:03Z" },
      { id: "r2", cycle_id: CYCLE, participant_id: "new-uuid-beta", item_id: "i1", answer_given: "B", answer_score: 0, response_time: null, result_status: null, created_at: "2026-05-01T00:00:04Z" },
    ],
    clean_exclusions: [{ id: "ce1", cycle_id: CYCLE, assessment_id: "a1", kind: "row", ...cleanExclusion }],
    item_stats: [], item_reviews: [], grade_schemes: [], grades: [], essay_marks: [],
    incidents: [], alterations: [], distinction_overrides: [], workspace_settings: [],
    element_labels: [], distinction_state: [], document_settings: [], import_batches: [],
  };
}

/** Same hydratable DB, but with a COHORT-WIDE exclusion (migration 0033) keyed on a
 *  stable participant key instead of a per-subject clean removal. */
function makeCohortDb(participantKey: string): MockDb {
  const db = makeDb({ target_id: "unused", target_key: null });
  db.clean_exclusions = [];
  db.cohort_exclusions = [
    { id: "co1", cycle_id: CYCLE, participant_key: participantKey, reason: "Staff / test account", decided_by: null, decided_at: "2026-05-01T00:00:06Z" },
  ];
  return db;
}

describe("manual clean exclusions survive re-import via the stable key (part 2)", () => {
  it("re-resolves a stale target_id through target_key to the CURRENT row UUID", async () => {
    // Pre-re-import the row was excluded on its OLD uuid; the current row has a
    // brand-new uuid. Only the stable key can bridge them.
    const h = await hydrate(makeSupabaseReadClient(makeDb({
      target_id: "stale-uuid-from-prior-ingest",
      target_key: "alpha@school.edu",
      decided_by: "u1", decided_at: "2026-05-01T00:00:05Z",
    })) as any);
    expect(h).not.toBeNull();
    const removals = h!.decisions.cleanRemovals.find((c) => c.assessmentId === "a1")!;
    // Resolved to the freshly-minted row, not the dead uuid.
    expect(removals.rows).toContain("new-uuid-alpha");
    expect(removals.rows).not.toContain("stale-uuid-from-prior-ingest");
  });

  it("drops a legacy row whose stored uuid no longer matches any participant", async () => {
    // No stable key (pre-0016 row) + a dangling uuid → cannot match a live
    // participant, so it is discarded rather than silently excluding no-one/anyone.
    const h = await hydrate(makeSupabaseReadClient(makeDb({
      target_id: "dangling-legacy-uuid",
      target_key: null,
      decided_by: "u1", decided_at: "2026-05-01T00:00:05Z",
    })) as any);
    const removals = h!.decisions.cleanRemovals.find((c) => c.assessmentId === "a1");
    expect(removals?.rows ?? []).toHaveLength(0);
  });

  it("still honours a current-import row by its live uuid (no re-import yet)", async () => {
    const h = await hydrate(makeSupabaseReadClient(makeDb({
      target_id: "new-uuid-beta",
      target_key: "beta@school.edu",
      decided_by: "u1", decided_at: "2026-05-01T00:00:05Z",
    })) as any);
    const removals = h!.decisions.cleanRemovals.find((c) => c.assessmentId === "a1")!;
    expect(removals.rows).toContain("new-uuid-beta");
  });
});
