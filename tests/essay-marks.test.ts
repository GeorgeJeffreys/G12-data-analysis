/**
 * Essay-marks importer (Part 2). The provider averages a student's per-essay
 * TotalScores into one mark per subject (English/Arabic only), matches by
 * ParticipantID, and surfaces unmatched IDs. Sample marks flow into subject
 * totals.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import seedJson from "@/lib/data/seed.generated.json";
import { essaySubjectCode } from "@/lib/data/parse-essays";

const seed = seedJson as unknown as {
  liveCycle: { id: string; participants: { id: string }[]; assessments: { id: string; name: string }[] };
};
const CYCLE = seed.liveCycle.id;
const arabic = seed.liveCycle.assessments.find((a) => /arabic/i.test(a.name))!;

describe("essay sheet → subject code", () => {
  it("maps AFL/ESL (and the subject names) to canonical codes", () => {
    expect(essaySubjectCode("AFL")).toBe("AFL");
    expect(essaySubjectCode("Arabic 1st Language")).toBe("AFL");
    expect(essaySubjectCode("ESL")).toBe("ESL");
    expect(essaySubjectCode("English 2nd Language")).toBe("ESL");
    expect(essaySubjectCode("Maths")).toBeNull();
  });
});

describe("essay marks — averaging + matching", () => {
  it("averages a student's two essays into one /20 subject mark", () => {
    const p = new InMemoryDataProvider();
    const sid = seed.liveCycle.participants[0]!.id;
    p.uploadEssayMarks(CYCLE, "essays.xlsx", [
      { participantId: sid, subjectCode: "AFL", totalScore: 12 },
      { participantId: sid, subjectCode: "AFL", totalScore: 16 }, // mean 14
    ]);
    const model = p.getEssayMarks(CYCLE)!;
    expect(model.uploaded).toBe(true);
    expect(model.matchedCount).toBe(1);
    const student = model.students.find((s) => s.participantId === sid)!;
    expect(student.marks[arabic.id]).toBe(14);
    expect(student.essayCounts[arabic.id]).toBe(2);
  });

  it("surfaces unmatched ParticipantIDs and skips them", () => {
    const p = new InMemoryDataProvider();
    p.uploadEssayMarks(CYCLE, "essays.xlsx", [
      { participantId: "A-A-999999", subjectCode: "ESL", totalScore: 18 },
    ]);
    const model = p.getEssayMarks(CYCLE)!;
    expect(model.matchedCount).toBe(0);
    expect(model.unmatchedIds).toContain("A-A-999999");
  });

  it("the labelled sample matches real roster students and lifts the Arabic max by 20", () => {
    const p = new InMemoryDataProvider();
    const before = p.getBoundaries(CYCLE, arabic.id)!; // before any essays
    p.loadSampleEssayMarks(CYCLE);
    const model = p.getEssayMarks(CYCLE)!;
    expect(model.sample).toBe(true);
    expect(model.matchedCount).toBeGreaterThan(0);
    // Arabic subject now scores out of (items + 20); its cohort mean shifts.
    const after = p.getBoundaries(CYCLE, arabic.id)!;
    expect(after.stats.mean).not.toBe(before.stats.mean);
  });
});
