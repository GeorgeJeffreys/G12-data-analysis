/**
 * Prompt-09 — cohort exclusion fix. Three seams the fix adds on top of P-A's
 * stable email-keyed identity:
 *
 *   1. STAFF/TEST EMAIL LIST (primary, robust) — a configured list keyed on the
 *      participant's stable email, applied at the cohort boundary so listed
 *      accounts (Lavinia, Muamina) drop from EVERY subject + Candidate Scores with
 *      no stored decision, so it survives re-import. Excluding by email also drops
 *      Muamina's typo `Applicable Maths` row (same account).
 *
 *   2. MANUAL EXCLUSIONS SURVIVE RE-IMPORT — clean_exclusions row targets now carry
 *      the participant's stable natural key (qm_participant_id, migration 0016), so
 *      an exclusion recorded before an ingest re-resolves to the freshly-minted row
 *      UUID on hydrate instead of dangling on the old (randomUUID) id.
 *
 * (Part 3 — the server `recomputeAndWrite` honouring these exclusions — is exercised
 * by dropping the same participants' responses before the engine runs; its logic
 * mirrors the cohort boundary asserted here and in engine-write.ts.)
 */
import { describe, it, expect, vi } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { isStaffTestEmail, STAFF_TEST_EMAILS } from "@/lib/data/staff-exclusions";
import { hydrate } from "@/lib/data/supabase-hydrate";
import { makeSupabaseReadClient, type MockDb } from "@/tests/helpers/mock-supabase-read";
import seedJson from "@/lib/data/seed.generated.json";
import type { Seed } from "@/lib/data/seed-types";

// The hydrate module is client-safe, but its sibling write path is server-only;
// neutralise `server-only` so the test bundle imports cleanly.
vi.mock("server-only", () => ({}));

const LAVINIA = "lavinia.cavalet@alsamaproject.com";
const MUAMINA = "muamina.mlisho@alsamaproject.com";

// ── Part 1: the email list ──────────────────────────────────────────────────
describe("staff/test email exclusion list (part 1)", () => {
  it("lists Lavinia + Muamina and matches them stably (case/space-insensitive)", () => {
    expect(STAFF_TEST_EMAILS).toContain(LAVINIA);
    expect(STAFF_TEST_EMAILS).toContain(MUAMINA);
    expect(isStaffTestEmail(LAVINIA)).toBe(true);
    expect(isStaffTestEmail(MUAMINA)).toBe(true);
    // The same injective normalisation P-A mints the internal id with — so the
    // export's casing/whitespace never lets the account slip through.
    expect(isStaffTestEmail("  LAVINIA.Cavalet@AlsamaProject.com ")).toBe(true);
  });

  it("does not match real students, blanks or nulls", () => {
    expect(isStaffTestEmail("student01@alsamaproject.com")).toBe(false);
    expect(isStaffTestEmail("")).toBe(false);
    expect(isStaffTestEmail(null)).toBe(false);
    expect(isStaffTestEmail(undefined)).toBe(false);
  });

  it("excludes a listed account at the cohort boundary with NO stored decision", () => {
    // Baseline: a real participant appears in the grades cohort.
    const base = new InMemoryDataProvider();
    const cycleId = base.listCycles()[0]!.id;
    const baseGrades = base.getGrades(cycleId)!;
    const victim = baseGrades.rows[0]!;
    expect(baseGrades.rows.some((r) => r.id === victim.id)).toBe(true);

    // Rebuild the same seed but stamp that participant's stable id (studentId =
    // qm_participant_id = email) as a listed staff account. No exclusion is
    // recorded — the email list alone must drop them everywhere.
    const seed = structuredClone(seedJson) as unknown as Seed;
    const target = seed.liveCycle.participants.find((p) => p.id === victim.id)!;
    target.studentId = LAVINIA;
    const p = new InMemoryDataProvider(seed);

    const grades = p.getGrades(cycleId)!;
    expect(grades.rows.some((r) => r.id === victim.id)).toBe(false);
    expect(grades.rows).toHaveLength(baseGrades.rows.length - 1);
    // headline cohort count drops too
    expect(p.getCycle(cycleId)!.participants).toBe(base.getCycle(cycleId)!.participants - 1);
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
