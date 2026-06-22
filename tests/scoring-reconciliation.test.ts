/**
 * Scoring reconciliation — the FINAL scoring fix.
 *
 * Pins the decided rule end-to-end against the seed + the same engine the app
 * runs (live Supabase is unreachable; numbers are reproduced from the seed):
 *
 *   • One DATA-DRIVEN, script-aware essay detector — recognises the Arabic-script
 *     subject (the old Latin-only `/arabic|english/i` could not).
 *   • Half-weighted essay max DERIVED as (sum of essay item max) / 2 = 20 — never
 *     hard-coded.
 *   • Essay marks half-weighted in the numerator when present.
 *   • Score % == Grades % for the same student/subject (one shared calc).
 *   • Worked example: P0010 English = 36 / 66 = 54.55% (essays unmarked).
 *   • Surveys + max-0 stimulus excluded; essays never enter item-stats; counts
 *     reconcile; engine parity stays 183/183 (item-stats untouched).
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import seedJson from "@/lib/data/seed.generated.json";
import {
  isEssaySubject,
  reservedEssayMax,
  essayItemMaxSum,
  ESSAY_ITEM_MAX,
  ESSAY_ITEM_MAX_SUM,
  ESSAY_MAX_RESERVED,
} from "@/lib/data/essays";
import { classify } from "@/lib/data/grading";
import { isSurveyAssessment } from "@/lib/ingest/normalize";

const seed = seedJson as unknown as {
  liveCycle: {
    id: string;
    participants: { id: string; studentId?: string }[];
    assessments: { id: string; name: string; items: { maxScore: number }[]; responses: { p: string; i: string; s: number }[] }[];
  };
};
const CYCLE = seed.liveCycle.id;
const english = seed.liveCycle.assessments.find((a) => /english/i.test(a.name))!;
const arabic = seed.liveCycle.assessments.find((a) => /arabic/i.test(a.name))!;

// ── (a) the Arabic-script essay-detection case ──────────────────────────────
describe("essay detection — data-driven + script-aware (not a Latin-only regex)", () => {
  it("recognises the Arabic-script subject name, English, but not MCQ-only subjects", () => {
    expect(isEssaySubject("اللّغة العربيّة")).toBe(true); // Arabic-script name — the bug case
    expect(isEssaySubject("Arabic as a 1st Language")).toBe(true);
    expect(isEssaySubject("English as a 2nd Language")).toBe(true);
    expect(isEssaySubject("Applicable Math")).toBe(false);
    expect(isEssaySubject("Scientific Thinking")).toBe(false);
  });

  it("detects an essay subject from its item data (a max beyond the dichotomous 1)", () => {
    // Even with an unrecognised name, a polytomous (essay) item flags the subject.
    expect(isEssaySubject({ name: "Mystery Subject", items: [{ maxScore: 1 }, { maxScore: 20 }] })).toBe(true);
    expect(isEssaySubject({ name: "Mystery Subject", items: [{ maxScore: 1 }, { maxScore: 1 }] })).toBe(false);
    // Arabic script still wins via the fallback when no essay items survive ingest.
    expect(isEssaySubject({ name: "اللّغة العربيّة", items: [{ maxScore: 1 }] })).toBe(true);
  });

  it("both seed essay subjects (English + Arabic) are detected", () => {
    expect(isEssaySubject(english)).toBe(true);
    expect(isEssaySubject(arabic)).toBe(true);
  });
});

// ── (b derivation) essay max = (sum of essay item max) / 2, derived not 20 ───
describe("half-weighted essay max is derived, never hard-coded", () => {
  it("the reserved max equals the full essay item max halved", () => {
    expect(ESSAY_ITEM_MAX_SUM).toBe(2 * ESSAY_ITEM_MAX); // 2 essays × 20 = 40
    expect(ESSAY_MAX_RESERVED).toBe(ESSAY_ITEM_MAX_SUM / 2); // 40 / 2 = 20
    expect(ESSAY_MAX_RESERVED).toBe(20);
  });

  it("derives the reserved max per subject (essay → 20, non-essay → 0)", () => {
    expect(reservedEssayMax(english)).toBe(20);
    expect(reservedEssayMax(arabic)).toBe(20);
    expect(reservedEssayMax({ name: "Applicable Math" })).toBe(0);
    // Derived from items if essay items are present (stays correct if maxes change).
    expect(essayItemMaxSum({ name: "X", items: [{ maxScore: 20 }, { maxScore: 20 }] })).toBe(40);
    expect(reservedEssayMax({ name: "X", items: [{ maxScore: 20 }, { maxScore: 20 }] })).toBe(20);
  });
});

// ── (c) worked example + half-weighting in the numerator ────────────────────
describe("worked example — P0010 English (essays unmarked) = 36 / 66 = 54.55%", () => {
  function p0010In(p: InMemoryDataProvider) {
    const grades = p.getGrades(CYCLE)!;
    const row = grades.rows.find((r) => r.studentId === "P0010")!;
    const comp = p.getComposition(CYCLE)!;
    const st = comp.students.find((s) => s.participantId === row.id)!;
    return { row, cell: st.subjects.find((s) => s.assessmentId === english.id)! };
  }

  it("the Score-screen composition cell is 36 (MCQ) + 0 (essay) over a 66 max → 54.55%", () => {
    const p = new InMemoryDataProvider();
    const { cell } = p0010In(p);
    expect(cell.mcq).toBe(36);
    expect(cell.essay).toBe(0); // essays unmarked → +0 (the intended "missing essay" flag)
    expect(cell.max).toBe(46 + ESSAY_MAX_RESERVED); // 46 MCQ + 20 reserved = 66
    expect(cell.pct).toBeCloseTo(54.55, 2);
  });

  it("essay marks are HALF-WEIGHTED into the numerator when present", () => {
    const p = new InMemoryDataProvider();
    const id = p.getGrades(CYCLE)!.rows.find((r) => r.studentId === "P0010")!.id;
    // Two perfect essays (20 + 20 = 40 raw) must contribute the HALF, i.e. 20.
    p.uploadEssayMarks(CYCLE, "essays.xlsx", [
      { participantId: id, subjectCode: "ESL", totalScore: 20 },
      { participantId: id, subjectCode: "ESL", totalScore: 20 },
    ]);
    const { cell } = p0010In(p);
    expect(cell.essay).toBe(ESSAY_MAX_RESERVED); // 20, not the 40 raw → half-weighted
    expect(cell.max).toBe(66);
    expect(cell.pct).toBeCloseTo(((36 + 20) / 66) * 100, 1); // 56 / 66 = 84.85%
  });

  it("a partial essay pair (12 + 16 = 28 raw) half-weights to 14 in the numerator", () => {
    const p = new InMemoryDataProvider();
    const id = p.getGrades(CYCLE)!.rows.find((r) => r.studentId === "P0010")!.id;
    p.uploadEssayMarks(CYCLE, "essays.xlsx", [
      { participantId: id, subjectCode: "ESL", totalScore: 12 },
      { participantId: id, subjectCode: "ESL", totalScore: 16 },
    ]);
    const { cell } = p0010In(p);
    expect(cell.essay).toBe(14); // (12 + 16) / 2
    expect(cell.pct).toBeCloseTo(((36 + 14) / 66) * 100, 1); // 50 / 66 = 75.76%
  });
});

// ── (b guard) Score % == Grades % for the same student/subject ──────────────
describe("Score and Grades run through ONE shared calc", () => {
  it("the overall % matches between the Score composition and the Grades model for every student", () => {
    const p = new InMemoryDataProvider();
    const comp = p.getComposition(CYCLE)!;
    const grades = p.getGrades(CYCLE)!;
    const gradeById = new Map(grades.rows.map((r) => [r.id, r]));
    expect(comp.students.length).toBe(grades.rows.length);
    for (const st of comp.students) {
      const g = gradeById.get(st.participantId)!;
      expect(Math.round(st.overall.pct * 10) / 10).toBe(Math.round(g.overallPct * 10) / 10);
    }
  });

  it("the per-subject % on the Score screen classifies to the SAME Grades level (P0010 English)", () => {
    const p = new InMemoryDataProvider();
    const grades = p.getGrades(CYCLE)!;
    const row = grades.rows.find((r) => r.studentId === "P0010")!;
    const comp = p.getComposition(CYCLE)!;
    const cell = comp.students.find((s) => s.participantId === row.id)!.subjects.find((s) => s.assessmentId === english.id)!;
    const b = p.getBoundaries(CYCLE, english.id)!;
    // Classifying the Score-screen % with the subject's cuts reproduces the Grades level.
    expect(classify(cell.pct, b.levels, b.cuts)).toBe(row.grades[english.id]!.level);
  });
});

// ── surveys + stimulus excluded; essays never enter item-stats ──────────────
describe("surveys + max-0 stimulus excluded; essays not in item-stats", () => {
  it("no essay (polytomous, max>1) item ever reaches the MCQ item pipeline", () => {
    // Essays are dropped at ingest as non-MCQ; the seed carries only 0/1-max items.
    for (const a of seed.liveCycle.assessments) {
      for (const it of a.items) expect(it.maxScore).toBeLessThanOrEqual(1);
    }
  });

  it("survey assessments are recognised so they are dropped — none leak into the live cycle", () => {
    expect(isSurveyAssessment("Student Experience Survey")).toBe(true);
    expect(seed.liveCycle.assessments.some((a) => isSurveyAssessment(a.name))).toBe(false);
  });

  it("max-0 stimulus items are excluded from the scored MCQ max (English 46, not 60)", () => {
    const scoredMcq = english.items.filter((it) => (it.maxScore ?? 1) >= 1).length;
    const stimulus = english.items.filter((it) => (it.maxScore ?? 1) < 1).length;
    expect(scoredMcq).toBe(46);
    expect(stimulus).toBe(14);
    // total = scored MCQ + max-0 stimulus (surveys already dropped at ingest)
    expect(scoredMcq + stimulus).toBe(english.items.length);
    // denominator = scored MCQ max + half-weighted essay max
    const p = new InMemoryDataProvider();
    const cell = p
      .getComposition(CYCLE)!
      .students.flatMap((s) => s.subjects)
      .find((s) => s.assessmentId === english.id)!;
    expect(cell.max).toBe(scoredMcq + ESSAY_MAX_RESERVED);
  });
});
