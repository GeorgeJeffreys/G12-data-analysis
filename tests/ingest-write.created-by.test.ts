/**
 * Server-side ingest write path — audit column (`import_batches.created_by`).
 *
 * The persist runs through the secret-key admin client, which has no session, so
 * the DB's `auth.uid()` default for `created_by` is always null and would violate
 * the NOT NULL constraint. These tests prove the write path now sets `created_by`
 * explicitly from the authenticated user, and refuses to insert (clear error)
 * when no user is resolved — rather than ever sending null.
 */
import { describe, it, expect, vi } from "vitest";
import type { CleanResponse } from "@/lib/ingest/types";

// The write path is a server module (`import "server-only"`), which throws when
// loaded outside a server component. Stub it so we can exercise the pure logic.
vi.mock("server-only", () => ({}));

const { ingestCleanResponses } = await import("@/lib/server/ingest-write");

/** A captured insert: which table, and the rows sent. */
interface Captured {
  name: string;
  rows: Record<string, unknown>[];
}

/**
 * Minimal stand-in for the Supabase admin client that records every insert and
 * hands back synthetic ids (so the assessment/item/participant lookups resolve).
 * Mirrors the loose `.insert().select()` / `.delete().eq()` surface the write
 * path uses.
 */
function makeAdmin(captured: Captured[]) {
  let counter = 0;
  return {
    from(name: string) {
      return {
        insert(rows: unknown) {
          const arr = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
          captured.push({ name, rows: arr });
          const data = arr.map((r) => ({
            id: `${name}-${++counter}`,
            qm_question_id: r.qm_question_id,
            assessment_id: r.assessment_id,
            qm_participant_id: r.qm_participant_id,
          }));
          const result = { data, error: null };
          const thenable = Promise.resolve(result) as Promise<typeof result> & {
            select: (c?: string) => Promise<typeof result>;
          };
          thenable.select = () => Promise.resolve(result);
          return thenable;
        },
        delete() {
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };
}

function sampleRecs(): CleanResponse[] {
  const mk = (q: string, p: string): CleanResponse => ({
    assessmentName: "Applicable Mathematics",
    qmQuestionId: q,
    qmParticipantId: p,
    participantPseudonym: `pseudo-${p}`,
    wording: null,
    majorElement: null,
    subElement: null,
    demandLevel: null,
    questionType: "MCQ",
    maxScore: 1,
    answerGiven: "A",
    answerScore: 1,
    responseTime: null,
    resultStatus: null,
  });
  return [mk("Q1", "P1"), mk("Q2", "P1"), mk("Q1", "P2")];
}

describe("ingestCleanResponses — created_by audit column", () => {
  it("sets import_batches.created_by from the authenticated user (never null)", async () => {
    const captured: Captured[] = [];
    const admin = makeAdmin(captured);

    await ingestCleanResponses(admin as never, "cycle-1", sampleRecs(), {
      fileRef: "export.xlsx",
      createdBy: "user-123",
    });

    const batch = captured.find((c) => c.name === "import_batches");
    expect(batch).toBeDefined();
    expect(batch!.rows).toHaveLength(1);
    expect(batch!.rows[0]!.created_by).toBe("user-123");
    expect(batch!.rows[0]!.created_by).not.toBeNull();
  });

  it("throws a clear 'must be signed in' error and inserts nothing when no user is present", async () => {
    const captured: Captured[] = [];
    const admin = makeAdmin(captured);

    await expect(
      ingestCleanResponses(admin as never, "cycle-1", sampleRecs(), {
        // No authenticated user resolved — must not fall through to a null insert.
        createdBy: "",
        fileRef: "export.xlsx",
      }),
    ).rejects.toThrow(/signed in/i);

    // Guard against a partial write: nothing should have been inserted.
    expect(captured).toHaveLength(0);
  });
});
