/**
 * Prompt-09 part 3 — the SERVER `recomputeAndWrite` honours cohort/participant
 * exclusions, so the materialized `participant_scores` (the Candidate Scores
 * page's source) reflects the CLEANED cohort.
 *
 * Before the fix, `recomputeAndWrite` read participants/responses raw and applied
 * only ITEM exclusions — it had no concept of a participant/cohort exclusion, so a
 * staff/test account (or a Clean-stage row removal) still materialised a score.
 * This test drives the real function through a read+write mock admin and asserts:
 *   - a staff/test EMAIL-list account never reaches participant_scores;
 *   - a Clean-stage row removal (keyed on the stable qm_participant_id) is honoured
 *     and drops that participant from the persisted scores.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const CYCLE = "cyc";
const LAVINIA = "lavinia.cavalet@alsamaproject.com";

type Rows = Record<string, Record<string, unknown>[]>;

/** Minimal Supabase admin stand-in: serves seeded reads and captures writes. */
function makeAdmin(tables: Rows) {
  const writes: Rows = {};
  let runSeq = 0;
  const push = (name: string, rows: unknown) => {
    (writes[name] ??= []).push(...(Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]);
  };

  class ReadQuery implements PromiseLike<{ data: unknown[]; error: null }> {
    constructor(private rows: Record<string, unknown>[]) {}
    select() { return this; }
    eq(col: string, val: unknown) { this.rows = this.rows.filter((r) => r[col] === val); return this; }
    then<T>(onf?: ((v: { data: unknown[]; error: null }) => T | PromiseLike<T>) | null) {
      return Promise.resolve({ data: this.rows, error: null }).then(onf);
    }
  }

  const from = (name: string) => ({
    select: (_c?: string) => new ReadQuery(tables[name] ?? []),
    upsert: (rows: unknown, _opts?: unknown) => { push(name, rows); return Promise.resolve({ error: null, data: null }); },
    insert: (rows: unknown) => {
      push(name, rows);
      const result = { error: null as null, data: null as unknown };
      return Object.assign(Promise.resolve(result), {
        select: (_col: string) => Promise.resolve({ data: [{ id: `run-${++runSeq}` }], error: null }),
      });
    },
    delete: () => Object.assign(Promise.resolve({ error: null }), {
      eq: (_col: string, _val: string) => Promise.resolve({ error: null }),
    }),
  });

  return { admin: { from } as any, writes };
}

/** Seed a two-item Math subject sat by the given participants (all score i1=1,i2=0). */
function baseTables(participants: { id: string; qm: string; email: string | null }[], cleanExclusions: Record<string, unknown>[] = []): Rows {
  return {
    assessments: [{ id: "a1", cycle_id: CYCLE, name: "Math" }],
    items: [
      { id: "i1", cycle_id: CYCLE, assessment_id: "a1", max_score: 1, status: "active", wording: null, major_element: null, sub_element: null, demand_level: null },
      { id: "i2", cycle_id: CYCLE, assessment_id: "a1", max_score: 1, status: "active", wording: null, major_element: null, sub_element: null, demand_level: null },
    ],
    participants: participants.map((p) => ({ id: p.id, cycle_id: CYCLE, qm_participant_id: p.qm, pseudonym_id: p.id, email: p.email })),
    responses: participants.flatMap((p) => [
      { cycle_id: CYCLE, participant_id: p.id, item_id: "i1", answer_score: 1 },
      { cycle_id: CYCLE, participant_id: p.id, item_id: "i2", answer_score: 0 },
    ]),
    essay_marks: [],
    alterations: [],
    clean_exclusions: cleanExclusions,
  };
}

const scoredIds = (writes: Rows) => new Set((writes.participant_scores ?? []).map((r) => r.participant_id as string));

describe("recomputeAndWrite honours cohort/participant exclusions (part 3)", () => {
  it("drops a staff/test EMAIL-list account from participant_scores", async () => {
    const { recomputeAndWrite } = await import("@/lib/server/engine-write");
    const { admin, writes } = makeAdmin(baseTables([
      { id: "u-real1", qm: "real1@s.edu", email: "real1@s.edu" },
      { id: "u-real2", qm: "real2@s.edu", email: "real2@s.edu" },
      { id: "u-staff", qm: LAVINIA, email: LAVINIA },
    ]));

    await recomputeAndWrite(admin, CYCLE);

    const ids = scoredIds(writes);
    expect(ids.has("u-real1")).toBe(true);
    expect(ids.has("u-real2")).toBe(true);
    expect(ids.has("u-staff")).toBe(false); // excluded by the email list
  });

  it("honours a Clean-stage row removal keyed on the stable qm_participant_id", async () => {
    const { recomputeAndWrite } = await import("@/lib/server/engine-write");
    const { admin, writes } = makeAdmin(baseTables(
      [
        { id: "u-real1", qm: "real1@s.edu", email: "real1@s.edu" },
        { id: "u-real2", qm: "real2@s.edu", email: "real2@s.edu" },
      ],
      // Row removal recorded before a re-import: stale target_id, stable target_key.
      [{ id: "ce1", cycle_id: CYCLE, assessment_id: "a1", kind: "row", target_id: "stale-uuid", target_key: "real2@s.edu" }],
    ));

    await recomputeAndWrite(admin, CYCLE);

    const ids = scoredIds(writes);
    expect(ids.has("u-real1")).toBe(true);
    expect(ids.has("u-real2")).toBe(false); // re-resolved via stable key, then dropped
  });

  it("with no exclusions, every participant is scored (no behaviour change)", async () => {
    const { recomputeAndWrite } = await import("@/lib/server/engine-write");
    const { admin, writes } = makeAdmin(baseTables([
      { id: "u-real1", qm: "real1@s.edu", email: "real1@s.edu" },
      { id: "u-real2", qm: "real2@s.edu", email: "real2@s.edu" },
    ]));

    const result = await recomputeAndWrite(admin, CYCLE);

    expect(scoredIds(writes)).toEqual(new Set(["u-real1", "u-real2"]));
    expect(result.scores).toBe(2);
  });
});
