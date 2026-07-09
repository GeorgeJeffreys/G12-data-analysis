/**
 * Masterfile flow end-to-end through the provider (prompt 03): reconcile → validate
 * against the roster (join on Student ID) → apply via the EXISTING uploadEssayMarks
 * at HALF weight → idempotent re-upload → each language uploaded separately merges.
 * Anomalies (unknown Student ID, ≠2 essays) are reported and excluded, never dropped.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { reconcileMasterfile, type EssaySubjectCode } from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import seedJson from "@/lib/data/seed.generated.json";

const seed = seedJson as unknown as {
  liveCycle: { id: string; participants: { id: string; studentId: string }[]; assessments: { id: string; name: string }[] };
};
const CYCLE = seed.liveCycle.id;
const english = seed.liveCycle.assessments.find((a) => /english/i.test(a.name))!;
const arabic = seed.liveCycle.assessments.find((a) => /arabic/i.test(a.name))!;

const HEADER = [
  "Marker A", "Student name", "Student ID", "Essay ID", "Marker",
  "Dim1", "Dim2", "Dim3", "Dim4", "Dim5", "Total score", "Average", "Flag",
  "Moderated final score", "Final scores:", "note",
];

/** Build a masterfile row matrix: two marker rows per essay, approved on Final. */
function buildMatrix(students: { studentId: string; essays: number[] }[]): string[][] {
  const rows: string[][] = [HEADER];
  for (const s of students) {
    s.essays.forEach((mark, i) => {
      const eid = `EE0${i + 1}.png`;
      // marker 1 carries the Final score; Average/Total are bogus (must be ignored)
      rows.push(["M1", "name", s.studentId, eid, "One", "3", "4", "3", "4", "3", "88", "77", "", "", String(mark), "ok"]);
      rows.push(["M2", "name", s.studentId, eid, "Two", "4", "3", "4", "3", "4", "66", "", "", "", "", ""]);
    });
  }
  return rows;
}

/** Roster Student IDs for an essay subject, from the read-only upload context. */
function rosterIds(p: InMemoryDataProvider, assessmentId: string): string[] {
  const ctx = p.getEssayContext(CYCLE)!;
  return ctx.subjects.find((s) => s.assessmentId === assessmentId)!.participants
    .filter((x) => !x.excluded)
    .map((x) => x.studentId);
}

function applyMasterfile(p: InMemoryDataProvider, code: EssaySubjectCode, students: { studentId: string; essays: number[] }[]) {
  const result = reconcileMasterfile(buildMatrix(students), code);
  const report = validateEssayMasterfile(result, p.getEssayContext(CYCLE)!);
  p.uploadEssayMarks(CYCLE, `${code}.csv`, report.valid);
  return report;
}

describe("masterfile → provider, join on Student ID", () => {
  it("reconciled /20 lands on the subject at half weight (halved exactly once)", () => {
    const p = new InMemoryDataProvider();
    const id = rosterIds(p, english.id)[0]!;
    // essays 17 + 14 → round_half_up(8.5 + 7) = round_half_up(15.5) = 16
    const report = applyMasterfile(p, "ESL", [{ studentId: id, essays: [17, 14] }]);
    expect(report.validCount).toBe(1);

    const cell = p.getComposition(CYCLE)!.students.find((s) => s.participantId === id)!
      .subjects.find((s) => s.assessmentId === english.id)!;
    // reserved half-weighted max = 20; the reconciled /20 enters the numerator as-is.
    expect(cell.essay).toBe(16);

    const model = p.getEssayMarks(CYCLE)!;
    const st = model.students.find((s) => s.participantId === id)!;
    expect(st.marks[english.id]).toBe(16);
    expect(st.essayCounts[english.id]).toBe(2); // true essay count preserved for disclosure
  });

  it("re-uploading the same language is idempotent (no duplicate marks)", () => {
    const p = new InMemoryDataProvider();
    const id = rosterIds(p, english.id)[0]!;
    applyMasterfile(p, "ESL", [{ studentId: id, essays: [18, 16] }]); // → round(9+8)=17
    const first = p.getEssayMarks(CYCLE)!;
    applyMasterfile(p, "ESL", [{ studentId: id, essays: [18, 16] }]);
    const second = p.getEssayMarks(CYCLE)!;
    expect(second.matchedCount).toBe(first.matchedCount);
    expect(second.students.find((s) => s.participantId === id)!.marks[english.id]).toBe(17);
  });

  it("each language uploads separately and merges — English is kept when Arabic is added", () => {
    const p = new InMemoryDataProvider();
    const eid = rosterIds(p, english.id)[0]!;
    const aid = rosterIds(p, arabic.id)[0]!;
    applyMasterfile(p, "ESL", [{ studentId: eid, essays: [20, 20] }]); // English → 20
    applyMasterfile(p, "AFL", [{ studentId: aid, essays: [10, 10] }]); // Arabic → 10
    const model = p.getEssayMarks(CYCLE)!;
    // English mark survived the later Arabic upload
    expect(model.students.find((s) => s.participantId === eid)!.marks[english.id]).toBe(20);
    expect(model.students.find((s) => s.participantId === aid)!.marks[arabic.id]).toBe(10);
  });
});

describe("pending disclosure clears per language once applied (Task 6)", () => {
  // Mirror the card's per-subject pending computation: roster (non-excluded)
  // participants that do not yet have a mark for that subject.
  function pendingFor(p: InMemoryDataProvider, assessmentId: string): number {
    const ctx = p.getEssayContext(CYCLE)!;
    const model = p.getEssayMarks(CYCLE)!;
    const withMark = new Set(model.students.filter((s) => s.marks[assessmentId] != null).map((s) => s.participantId));
    const roster = ctx.subjects.find((s) => s.assessmentId === assessmentId)!.participants.filter((x) => !x.excluded);
    return roster.filter((x) => !withMark.has(x.participantId)).length;
  }

  it("applying English clears English pending while Arabic stays pending", () => {
    const p = new InMemoryDataProvider();
    const englishRoster = rosterIds(p, english.id);
    const arabicPendingBefore = pendingFor(p, arabic.id);
    expect(pendingFor(p, english.id)).toBe(englishRoster.length);

    // Apply every English student, leaving Arabic untouched.
    applyMasterfile(p, "ESL", englishRoster.map((studentId) => ({ studentId, essays: [15, 15] })));
    expect(pendingFor(p, english.id)).toBe(0);
    expect(pendingFor(p, arabic.id)).toBe(arabicPendingBefore); // unchanged
  });
});

describe("masterfile anomalies — reported and excluded, never silently dropped", () => {
  it("an unknown Student ID is rejected and not applied", () => {
    const p = new InMemoryDataProvider();
    const report = applyMasterfile(p, "ESL", [{ studentId: "A-A-999999", essays: [12, 12] }]);
    expect(report.validCount).toBe(0);
    expect(report.rejectedCount).toBe(1);
    expect(report.rows[0]!.reason).toMatch(/not in the .* roster/i);
    expect(p.getEssayMarks(CYCLE)!.matchedCount).toBe(0);
  });

  it("a student with only 1 essay is reported (≠2 essays) and excluded", () => {
    const p = new InMemoryDataProvider();
    const id = rosterIds(p, english.id)[0]!;
    const report = applyMasterfile(p, "ESL", [{ studentId: id, essays: [15] }]);
    expect(report.validCount).toBe(0);
    const anomaly = report.rows.find((r) => r.studentId === id)!;
    expect(anomaly.status).toBe("rejected");
    expect(anomaly.reason).toMatch(/found 1/i);
  });

  it("a flagged (Clean-excluded) sitting is not applied", () => {
    const p = new InMemoryDataProvider();
    const id = rosterIds(p, english.id)[0]!;
    p.setCleanRemoval(CYCLE, english.id, { rows: [id] }, true);
    const report = applyMasterfile(p, "ESL", [{ studentId: id, essays: [15, 15] }]);
    expect(report.flaggedCount).toBe(1);
    expect(report.validCount).toBe(0);
  });
});
