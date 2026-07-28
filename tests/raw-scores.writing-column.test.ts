/**
 * Raw Scores — the display-only "Writing /20" essay column.
 *
 * Essay subjects (English/Arabic) surface the offline essay mark as its own element
 * column (letter from element_labels, else "C" / "Writing"), out of the reserved /20,
 * carrying the per-participant mark that is ALREADY folded into `raw`. This is a
 * presentation change only: it must add no scoring, leave `raw`/`pct`/`max`
 * untouched, and never appear on non-essay subjects.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { isEssaySubject } from "@/lib/data/essays";
import seedJson from "@/lib/data/seed.generated.json";

const seed = seedJson as unknown as {
  liveCycle: { id: string; assessments: { id: string; name: string }[] };
};
const CYCLE = seed.liveCycle.id;
const english = seed.liveCycle.assessments.find((a) => /english/i.test(a.name))!;
const nonEssay = seed.liveCycle.assessments.find((a) => !isEssaySubject(a.name))!;

const ESSAY_MARK = 16;

/** The lone essay ("Writing") column: the element carrying an `essayMax`. */
function essayCol(model: { elements: { essayMax?: number }[] }) {
  return model.elements.filter((e) => e.essayMax != null);
}

describe("Raw Scores — Writing /20 essay column (display-only)", () => {
  it("exposes the essay mark as a 'Writing /20' column for an essay subject", () => {
    const p = new InMemoryDataProvider();
    const ctx = p.getEssayContext(CYCLE)!;
    const eng = ctx.subjects.find((s) => s.assessmentId === english.id)!;
    const target = eng.participants[0]!;
    p.uploadEssayMarks(CYCLE, "english.xlsx", [
      { participantId: target.studentId, subjectCode: "ESL", totalScore: ESSAY_MARK },
    ]);

    const model = p.getNaiveScores(CYCLE, english.id)!;
    const cols = essayCol(model);
    expect(cols).toHaveLength(1);
    const col = cols[0]!;
    expect(col.essayMax).toBe(20); // reserved /20 shown in the header
    // Label from element_labels (English C = "Writing and expression"); letter C.
    expect(col.shortId).toBe("C");
    expect(col.label?.toLowerCase()).toContain("writing");

    // The participant's cell equals the /20 mark already summed into raw.
    const row = model.students.find((s) => s.id === target.participantId)!;
    expect(row.perElement[col.major]).toBe(ESSAY_MARK);
  });

  it("a participant with no essay mark has no essay cell (renders 0 via ?? 0)", () => {
    const p = new InMemoryDataProvider();
    const ctx = p.getEssayContext(CYCLE)!;
    const eng = ctx.subjects.find((s) => s.assessmentId === english.id)!;
    const marked = eng.participants[0]!;
    const unmarked = eng.participants[1]!;
    p.uploadEssayMarks(CYCLE, "english.xlsx", [
      { participantId: marked.studentId, subjectCode: "ESL", totalScore: ESSAY_MARK },
    ]);

    const model = p.getNaiveScores(CYCLE, english.id)!;
    const col = essayCol(model)[0]!;
    const row = model.students.find((s) => s.id === unmarked.participantId)!;
    expect(row.perElement[col.major]).toBeUndefined(); // → table shows 0 like a missing MCQ element
  });

  it("non-essay subjects have NO essay column", () => {
    const p = new InMemoryDataProvider();
    const model = p.getNaiveScores(CYCLE, nonEssay.id)!;
    expect(model.hasEssay).toBe(false);
    expect(essayCol(model)).toHaveLength(0);
  });

  it("the column is display-only: the cell mirrors the mark already in raw; max/denominator unchanged", () => {
    // Baseline: essay column is present (essay subject) but the participant has no mark.
    const p0 = new InMemoryDataProvider();
    const ctx0 = p0.getEssayContext(CYCLE)!;
    const eng0 = ctx0.subjects.find((s) => s.assessmentId === english.id)!;
    const target = eng0.participants[0]!;
    const before = p0.getNaiveScores(CYCLE, english.id)!;
    const rowBefore = before.students.find((s) => s.id === target.participantId)!;

    // With the mark applied.
    const p1 = new InMemoryDataProvider();
    p1.uploadEssayMarks(CYCLE, "english.xlsx", [
      { participantId: target.studentId, subjectCode: "ESL", totalScore: ESSAY_MARK },
    ]);
    const after = p1.getNaiveScores(CYCLE, english.id)!;
    const rowAfter = after.students.find((s) => s.id === target.participantId)!;
    const col = essayCol(after)[0]!;

    // The displayed cell equals exactly the amount folded into raw — no more, no less.
    expect(rowAfter.perElement[col.major]).toBe(ESSAY_MARK);
    expect(rowAfter.raw - rowBefore.raw).toBe(ESSAY_MARK);
    // Denominator (subject max /68) is the reserved-essay max either way — unchanged.
    expect(rowAfter.max).toBe(rowBefore.max);
    expect(after.subjectMax).toBe(before.subjectMax);
  });
});
