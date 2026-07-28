/**
 * Regression: essay marks must fold into Raw Scores after hydrate for a user whose
 * membership carries a DYNAMIC role id (a DB `role_id` UUID), not a default-grid
 * tier — the exact production case (post-0040/0042 memberships) that silently
 * dropped essays.
 *
 * Root cause: the Supabase replay path loaded persisted essays through the
 * interactive `uploadEssayMarks`, which early-returns unless
 * `can(user, "incidents.upload", resolvedActions)`. During replay the resolved grid
 * is still the seeded default (keyed by tier ids), so a user whose `roleId` is a DB
 * UUID matches no entry → the guard denies → essays never enter `essayMarksByCycle`
 * → Raw Scores computes MCQ-only.
 *
 * Fix: replay loads DB truth through the UNGATED `hydrateEssayMarks`, mirroring
 * `hydrateExamIncidents`. This test locks that in by exercising both paths with a
 * UUID-`roleId` user: the gated path drops the essay (the bug), the hydrate path
 * folds it into the raw score (the fix).
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import seedJson from "@/lib/data/seed.generated.json";
import type { CurrentUser } from "@/lib/data/types";
import type { EssayUploadRow } from "@/lib/data/provider";

const seed = seedJson as unknown as {
  liveCycle: { id: string; assessments: { id: string; name: string }[] };
};
const CYCLE = seed.liveCycle.id;
const english = seed.liveCycle.assessments.find((a) => /english/i.test(a.name))!;

/** A real session user, post-0040: role resolves via a DB `role_id` UUID that is
 *  NOT one of the seeded tier ids the default action grid is keyed by. */
const DYNAMIC_ROLE_USER: CurrentUser = {
  id: "user-lavinia",
  name: "Lavinia",
  initials: "L",
  role: "lead_admin", // legacy enum best-effort — `roleId` wins in can()
  roleId: "3f9c1b2e-0000-4a00-8000-abcdef012345", // a DB roles.id UUID, not a tier
  roleName: "Admin",
};

const ESSAY_MARK = 16;

/** One reconciled English essay mark (/20) for the first English participant. */
function englishEssayRows(p: InMemoryDataProvider): { rows: EssayUploadRow[]; pid: string } {
  const ctx = p.getEssayContext(CYCLE)!;
  const eng = ctx.subjects.find((s) => s.assessmentId === english.id)!;
  const first = eng.participants[0]!;
  return {
    rows: [{ participantId: first.studentId, subjectCode: "ESL", totalScore: ESSAY_MARK }],
    pid: first.participantId,
  };
}

/** The first English participant's raw score from the Raw Scores read model. */
function rawFor(p: InMemoryDataProvider, pid: string): number {
  const model = p.getNaiveScores(CYCLE, english.id)!;
  return model.students.find((s) => s.id === pid)!.raw;
}

describe("essay hydration for a DB-role_id (dynamic-role) user", () => {
  it("the GATED uploadEssayMarks drops the essay for a UUID-roleId user (reproduces the bug)", () => {
    const p = new InMemoryDataProvider(undefined, DYNAMIC_ROLE_USER);
    const { rows, pid } = englishEssayRows(p);
    const baseline = rawFor(p, pid); // MCQ-only, no essay loaded yet

    p.uploadEssayMarks(CYCLE, "essay_marks.xlsx", rows); // guard denies → no-op

    expect(p.getEssayMarks(CYCLE)!.subjects.find((s) => s.code === "ESL")!.count).toBe(0);
    expect(rawFor(p, pid)).toBe(baseline); // essay NOT folded in → still MCQ-only
  });

  it("the UNGATED hydrateEssayMarks folds the essay into the raw score (the fix)", () => {
    const p = new InMemoryDataProvider(undefined, DYNAMIC_ROLE_USER);
    const { rows, pid } = englishEssayRows(p);
    const baseline = rawFor(p, pid); // MCQ-only

    p.hydrateEssayMarks(CYCLE, "essay_marks.xlsx", rows);

    // Essay is loaded and folded: raw = MCQ + the /20 essay mark (full weight into
    // the reserved 20), exactly what the Raw Scores view must show.
    expect(p.getEssayMarks(CYCLE)!.subjects.find((s) => s.code === "ESL")!.count).toBeGreaterThan(0);
    expect(rawFor(p, pid)).toBe(baseline + ESSAY_MARK);

    // And the composition cell carries the essay mark verbatim.
    const cell = p.getComposition(CYCLE)!.students.find((s) => s.participantId === pid)!
      .subjects.find((s) => s.assessmentId === english.id)!;
    expect(cell.essay).toBe(ESSAY_MARK);
  });

  it("hydrateEssayMarks produces the SAME state a permitted uploadEssayMarks would", () => {
    // Admin (default-grid tier) CAN upload → gives the reference state.
    const viaUpload = new InMemoryDataProvider(); // default user = lead_admin tier
    const { rows: r1, pid } = englishEssayRows(viaUpload);
    viaUpload.uploadEssayMarks(CYCLE, "essay_marks.xlsx", r1);

    // UUID-roleId user via the hydrate path → must match.
    const viaHydrate = new InMemoryDataProvider(undefined, DYNAMIC_ROLE_USER);
    const { rows: r2 } = englishEssayRows(viaHydrate);
    viaHydrate.hydrateEssayMarks(CYCLE, "essay_marks.xlsx", r2);

    expect(rawFor(viaHydrate, pid)).toBe(rawFor(viaUpload, pid));
    expect(viaHydrate.essayMarksForPersistence(CYCLE)).toEqual(viaUpload.essayMarksForPersistence(CYCLE));
  });
});
