/**
 * SCORING-AUDIT RECONCILIATION PROBES (diagnose-only).
 *
 * These tests do NOT change scoring logic. They assert (or, where an invariant
 * is currently broken, DOCUMENT) the reconciliation invariants the scoring
 * engine and the read-models are expected to satisfy, against the seeded live
 * cycle. They localise where numbers diverge from expected for the written
 * root-cause report in docs/scoring-audit.md.
 *
 * Where an invariant is found to HOLD, the test asserts it (and will catch a
 * future regression). Where it is currently BROKEN, the test pins the *current*
 * (wrong) behaviour with an explicit comment so the suite stays green and the
 * divergence is captured as an executable example, not a silent failure.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import seedJson from "@/lib/data/seed.generated.json";
import { computeScores } from "@/lib/engine";
import { repairText } from "@/lib/ingest/repair";
import { normalizeResponses } from "@/lib/ingest/normalize";

const seed = seedJson as unknown as {
  liveCycle: {
    id: string;
    participants: { id: string; label: string }[];
    assessments: {
      id: string;
      name: string;
      items: { id: string; major: string | null; demand: string | null; maxScore: number }[];
      responses: { p: string; i: string; s: number }[];
    }[];
  };
};
const CYCLE = seed.liveCycle.id;
const A = seed.liveCycle.assessments;
const english = A.find((a) => /english/i.test(a.name))!;
const arabic = A.find((a) => /arabic/i.test(a.name))!;
const math = A.find((a) => /applicable math/i.test(a.name))!;

/** Sum of maxScore over the subject's items (the true paper max, MCQ-only). */
function sumItemMax(aid: string): number {
  const a = A.find((x) => x.id === aid)!;
  return a.items.reduce((n, it) => n + (it.maxScore ?? 1), 0);
}
function scoredItemCount(aid: string): number {
  const a = A.find((x) => x.id === aid)!;
  return a.items.filter((it) => (it.maxScore ?? 1) >= 1).length;
}

describe("engine computeScores — per-subject max reconciliation", () => {
  it("subject MCQ max = sum of retained item maxScores (zero-max items add 0)", () => {
    // Run the engine in MCQ-only mode (no essay subjects flagged) so `max` is
    // purely the retained-item max — this isolates the per-question 'cost' sum.
    const a = math;
    const responses = a.responses.map((r) => ({
      participantId: r.p,
      itemId: r.i,
      assessmentId: a.id,
      score: r.s,
    }));
    const items = a.items.map((it) => ({ itemId: it.id, assessmentId: a.id, maxScore: it.maxScore }));
    const scores = computeScores(responses, [], { items });
    const expectedMax = sumItemMax(a.id); // 40 (40×1 + 1×0)
    for (const s of scores) {
      expect(s.max).toBe(expectedMax);
    }
    // Zero-max items still inflate itemsSeen even though they add 0 to max:
    // the cohort answered 41 distinct items but only 40 are 'scored'.
    expect(a.items.length).toBe(41);
    expect(scoredItemCount(a.id)).toBe(40);
    const maxItemsSeen = Math.max(...scores.map((s) => s.itemsSeen));
    // BROKEN INVARIANT (documented): itemsSeen counts zero-max stimulus items.
    // A student who saw every item has itemsSeen 41, not the 40 scored items.
    expect(maxItemsSeen).toBeGreaterThan(scoredItemCount(a.id));
  });
});

describe("essay subjects — max reserves +20 even with NO essay marks uploaded", () => {
  it("English/Arabic subject max = scored MCQ max + 20 before any essay upload", () => {
    const p = new InMemoryDataProvider();
    const comp = p.getComposition(CYCLE)!;
    const anyStudent = comp.students[0]!;
    const engSubj = anyStudent.subjects.find((s) => s.assessmentId === english.id)!;
    const mathSubj = anyStudent.subjects.find((s) => s.assessmentId === math.id)!;

    // No essay marks have been uploaded, so essay component is 0 …
    expect(engSubj.essay).toBe(0);
    // … yet the denominator already reserves the 20-mark essay.
    expect(engSubj.max).toBe(scoredItemCount(english.id) + 20); // 46 + 20 = 66
    // A non-essay subject's max is just its scored-item count.
    expect(mathSubj.max).toBe(scoredItemCount(math.id)); // 40
  });
});

describe("Score screen (getNaiveScores) vs Grades screen (getComposition) — same student, divergent %", () => {
  it("English % differs between the two screens because one omits the +20 essay max", () => {
    const p = new InMemoryDataProvider();
    const naive = p.getNaiveScores(CYCLE, english.id)!;
    const comp = p.getComposition(CYCLE)!;

    // Pick a concrete student present in both.
    const naiveRow = naive.students[0]!;
    const compStudent = comp.students.find((s) => s.participantId === naiveRow.id)!;
    const compEng = compStudent.subjects.find((s) => s.assessmentId === english.id)!;

    // Same retained MCQ raw on the essay-free basis (no exclusions in this seed).
    expect(compEng.mcq).toBe(naiveRow.raw);
    // Score screen denominator = scored MCQ items only (46).
    expect(naive.mcqItems).toBe(scoredItemCount(english.id));
    // Grades screen denominator = 46 + 20. So the SAME student shows two
    // different percentages for the same subject — a reconciliation failure.
    expect(compEng.max).toBe(naive.mcqItems + 20);
    expect(compEng.pct).not.toBe(naiveRow.pct);
    // The Grades % is depressed by the unearned essay denominator.
    expect(compEng.pct).toBeLessThan(naiveRow.pct);
  });
});

describe("overall reconciliation (getComposition)", () => {
  it("overall raw = sum of subject raws and overall max = sum of subject maxes", () => {
    const p = new InMemoryDataProvider();
    const comp = p.getComposition(CYCLE)!;
    for (const s of comp.students) {
      const rawSum = s.subjects.reduce((n, x) => n + x.total, 0);
      const maxSum = s.subjects.reduce((n, x) => n + x.max, 0);
      expect(s.overall.total).toBeCloseTo(rawSum, 4);
      expect(s.overall.max).toBe(maxSum);
      if (s.overall.max > 0) {
        expect(s.overall.pct).toBeCloseTo(Math.round((rawSum / maxSum) * 1000) / 10, 4);
      }
    }
  });

  it("per-subject pct = raw/max within the engine output", () => {
    const p = new InMemoryDataProvider();
    const comp = p.getComposition(CYCLE)!;
    for (const s of comp.students) {
      for (const subj of s.subjects) {
        if (subj.max > 0) {
          expect(subj.pct).toBeCloseTo(Math.round((subj.total / subj.max) * 10000) / 100, 4);
        }
      }
    }
  });
});

describe("ROOT CAUSE A — Arabic essay detection diverges between code paths", () => {
  // The raw Questionmark name for the Arabic subject is Arabic script (mojibake
  // in the export, repaired to Arabic letters), e.g. "G12++ اللغة العربية".
  // It contains NO Latin "arabic"/"english" substring.
  const rawArabicMojibake = "G12++ Ø§Ù„Ù„Ù‘ØºØ© Ø§Ù„Ø¹Ø±Ø¨ÙŠÙ‘Ø©";
  const arabicScriptName = repairText(rawArabicMojibake);

  it("the live Arabic subject name has no Latin 'arabic' substring", () => {
    expect(/[؀-ۿ]/.test(arabicScriptName)).toBe(true); // it IS Arabic script
    expect(/arabic/i.test(arabicScriptName)).toBe(false); // …but no Latin 'arabic'
  });

  it("Latin-only detector (in-memory essaySubjectIds / essayAssessmentForCode) MISSES Arabic", () => {
    // Mirrors lib/data/in-memory-provider.ts:401 and :419 — Latin-only predicate.
    const inMemoryDetect = (name: string) => /arabic|english/i.test(name);
    expect(inMemoryDetect(arabicScriptName)).toBe(false); // Arabic essay NOT detected
    expect(inMemoryDetect("English as a 2nd Language")).toBe(true); // English IS detected
  });

  it("server detector (engine-write isEssaySubject) DOES catch Arabic via the script range", () => {
    // Mirrors lib/server/engine-write.ts:54-56 — adds the Arabic-script fallback.
    const serverDetect = (name: string) =>
      /arabic/i.test(name) || /english/i.test(name) || /[؀-ۿ]/.test(name);
    expect(serverDetect(arabicScriptName)).toBe(true); // server path catches it
    // The two paths therefore DISAGREE on the same live subject name:
    const inMemoryDetect = (name: string) => /arabic|english/i.test(name);
    expect(serverDetect(arabicScriptName)).not.toBe(inMemoryDetect(arabicScriptName));
  });
});

describe("ROOT CAUSE B — embedded max-20 Essay items are dropped by the MCQ filter", () => {
  it("normalizeResponses keeps only Multiple Choice, discarding Essay (max 20) rows", () => {
    const rows = [
      {
        AssessmentName: "G12++ English as 2nd Language",
        QuestionType: "Multiple Choice",
        QuestionId: "mcq-1",
        ResultParticipantName: "stu-1",
        QuestionMaximumScore: 1,
        AnswerScore: 1,
      },
      {
        AssessmentName: "G12++ English as 2nd Language",
        QuestionType: "Essay", // the embedded essay item, max 20 in the export
        QuestionId: "essay-1",
        ResultParticipantName: "stu-1",
        QuestionMaximumScore: 20,
        AnswerScore: 0,
      },
    ];
    const { clean, droppedNonMcqRows } = normalizeResponses(rows as never);
    // The max-20 essay item is gone; only the MCQ survives.
    expect(clean).toHaveLength(1);
    expect(clean[0]!.qmQuestionId).toBe("mcq-1");
    expect(clean.some((r) => r.maxScore === 20)).toBe(false);
    expect(droppedNonMcqRows).toBe(1);
    // => the export's per-question essay 'cost' (20) never reaches the engine;
    //    the +20 essay max is instead re-added synthetically and only earns a
    //    numerator if a SEPARATE essay-marks spreadsheet is uploaded.
  });
});

describe("essay uploaded — denominator already counted it, so % math is now consistent", () => {
  it("after sample essays load, English raw includes essay and max is unchanged", () => {
    const p = new InMemoryDataProvider();
    const before = p.getComposition(CYCLE)!;
    const beforeEng = before.students[0]!.subjects.find((s) => s.assessmentId === english.id)!;
    const beforeMax = beforeEng.max;

    p.loadSampleEssayMarks(CYCLE);
    const after = p.getComposition(CYCLE)!;
    // Find a student who actually received a sample essay mark (first 10 ids).
    const withEssay = after.students.find((s) => {
      const e = s.subjects.find((x) => x.assessmentId === english.id);
      return e && e.essay > 0;
    })!;
    const eng = withEssay.subjects.find((s) => s.assessmentId === english.id)!;
    expect(eng.essay).toBeGreaterThan(0);
    // Max did not change — the 20 marks were already reserved before upload.
    expect(eng.max).toBe(beforeMax);
    expect(eng.total).toBeCloseTo(eng.mcq + eng.essay + eng.alterations, 4);
  });
});
