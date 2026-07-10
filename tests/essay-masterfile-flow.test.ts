/**
 * Essay workbook flow end-to-end through the provider (prompt 03): extract the
 * Adjusted /20 → validate against the roster (join on QM email) → apply via the
 * EXISTING uploadEssayMarks at FULL weight → idempotent re-upload → each subject
 * merges. Off-roster email / no-Adjusted are reported and excluded, never dropped.
 *
 * In the seed the roster's join key (studentId) is a P-code, so tests feed that
 * value in the QM email column; the join matches on it exactly as production
 * matches on the email. The Student ID column carries a distinct label.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { extractSheet, type EssaySubjectCode } from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import seedJson from "@/lib/data/seed.generated.json";

const seed = seedJson as unknown as {
  liveCycle: { id: string; participants: { id: string; studentId: string }[]; assessments: { id: string; name: string }[] };
};
const CYCLE = seed.liveCycle.id;
const english = seed.liveCycle.assessments.find((a) => /english/i.test(a.name))!;
const arabic = seed.liveCycle.assessments.find((a) => /arabic/i.test(a.name))!;

const HEADER = ["Student ID", "Student name", "Total score", "Adjusted scores (USE THESE)", "QM email"];
type Row = { email: string; adjusted: number };

function extract(code: EssaySubjectCode, students: Row[]) {
  const matrix = [HEADER, ...students.map((s, i) => [`L-${i}`, "name", "88", String(s.adjusted), s.email])];
  return { students: extractSheet(matrix, code), subjectsSeen: [code], skippedSheets: [] as string[] };
}

function rosterIds(p: InMemoryDataProvider, assessmentId: string): string[] {
  const ctx = p.getEssayContext(CYCLE)!;
  return ctx.subjects.find((s) => s.assessmentId === assessmentId)!.participants.filter((x) => !x.excluded).map((x) => x.studentId);
}

function apply(p: InMemoryDataProvider, code: EssaySubjectCode, students: Row[]) {
  const report = validateEssayMasterfile(extract(code, students), p.getEssayContext(CYCLE)!);
  p.uploadEssayMarks(CYCLE, `${code}.xlsx`, report.valid);
  return report;
}

describe("workbook → provider, join on QM email, full weight", () => {
  it("the Adjusted /20 lands on the subject at full weight (not halved again)", () => {
    const p = new InMemoryDataProvider();
    const id = rosterIds(p, english.id)[0]!;
    const report = apply(p, "ESL", [{ email: id, adjusted: 15.25 }]); // half_up → 15
    expect(report.validCount).toBe(1);

    const pid = p.getEssayContext(CYCLE)!.subjects.find((s) => s.assessmentId === english.id)!.participants[0]!.participantId;
    const cell = p.getComposition(CYCLE)!.students.find((s) => s.participantId === pid)!
      .subjects.find((s) => s.assessmentId === english.id)!;
    expect(cell.essay).toBe(15); // full weight into the reserved 20
  });

  it("re-uploading the same subject is idempotent (no duplicate marks)", () => {
    const p = new InMemoryDataProvider();
    const id = rosterIds(p, english.id)[0]!;
    apply(p, "ESL", [{ email: id, adjusted: 18.5 }]); // → 19
    const first = p.getEssayMarks(CYCLE)!;
    apply(p, "ESL", [{ email: id, adjusted: 18.5 }]);
    const second = p.getEssayMarks(CYCLE)!;
    expect(second.matchedCount).toBe(first.matchedCount);
    expect(second.students.find((s) => s.participantId === id)!.marks[english.id]).toBe(19);
  });

  it("English and Arabic apply separately and merge — English survives an Arabic upload", () => {
    const p = new InMemoryDataProvider();
    const eid = rosterIds(p, english.id)[0]!;
    const aid = rosterIds(p, arabic.id)[0]!;
    apply(p, "ESL", [{ email: eid, adjusted: 20 }]);
    apply(p, "AFL", [{ email: aid, adjusted: 10 }]);
    const model = p.getEssayMarks(CYCLE)!;
    expect(model.students.find((s) => s.participantId === eid)!.marks[english.id]).toBe(20);
    expect(model.students.find((s) => s.participantId === aid)!.marks[arabic.id]).toBe(10);
  });
});

describe("pending disclosure clears per subject once applied", () => {
  function pendingFor(p: InMemoryDataProvider, assessmentId: string): number {
    const ctx = p.getEssayContext(CYCLE)!;
    const model = p.getEssayMarks(CYCLE)!;
    const withMark = new Set(model.students.filter((s) => s.marks[assessmentId] != null).map((s) => s.participantId));
    return ctx.subjects.find((s) => s.assessmentId === assessmentId)!.participants.filter((x) => !x.excluded && !withMark.has(x.participantId)).length;
  }

  it("applying English clears English pending, Arabic stays pending", () => {
    const p = new InMemoryDataProvider();
    const englishRoster = rosterIds(p, english.id);
    const arabicBefore = pendingFor(p, arabic.id);
    apply(p, "ESL", englishRoster.map((email) => ({ email, adjusted: 15 })));
    expect(pendingFor(p, english.id)).toBe(0);
    expect(pendingFor(p, arabic.id)).toBe(arabicBefore);
  });
});

describe("anomalies reported and excluded, never silently dropped", () => {
  it("an off-roster email is rejected and not applied", () => {
    const p = new InMemoryDataProvider();
    const report = apply(p, "ESL", [{ email: "nobody@nowhere.com", adjusted: 12 }]);
    expect(report.validCount).toBe(0);
    expect(report.rejectedCount).toBe(1);
    expect(report.rows[0]!.reason).toMatch(/not in the .* roster/i);
    expect(p.getEssayMarks(CYCLE)!.matchedCount).toBe(0);
  });

  it("a flagged (Clean-excluded) sitting is not applied", () => {
    const p = new InMemoryDataProvider();
    const id = rosterIds(p, english.id)[0]!;
    p.setCleanRemoval(CYCLE, english.id, { rows: [id] }, true);
    const report = apply(p, "ESL", [{ email: id, adjusted: 15 }]);
    expect(report.flaggedCount).toBe(1);
    expect(report.validCount).toBe(0);
  });
});
