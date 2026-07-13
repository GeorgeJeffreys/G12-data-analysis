/**
 * Fixed template flow end-to-end (prompt 03 v2): extract Final /20 → validate on
 * QM email → apply via the EXISTING uploadEssayMarks at FULL weight → idempotent
 * re-upload → per-subject merge. Plus the generate → fill → re-parse round-trip
 * (the app owns the template on both ends). Off-roster / no-Final are excluded.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { extractSheet, parseEssayMasterfile, resolveColumns, type EssaySubjectCode } from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import { buildEssayTemplateWorkbook } from "@/lib/data/essay-template";
import { XLSX } from "@/lib/export/sheet-utils";
import seedJson from "@/lib/data/seed.generated.json";

/** The stored canonical asset the generator clones (blank structure). */
const STORED_ASSET = () => {
  const buf = readFileSync(join(__dirname, "..", "public", "templates", "G12_Essay_Marks_FIXED_TEMPLATE.xlsx"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const seed = seedJson as unknown as {
  liveCycle: { id: string; participants: { id: string; studentId: string }[]; assessments: { id: string; name: string }[] };
};
const CYCLE = seed.liveCycle.id;
const english = seed.liveCycle.assessments.find((a) => /english/i.test(a.name))!;
const arabic = seed.liveCycle.assessments.find((a) => /arabic/i.test(a.name))!;

const HEADER = ["QM email", "Student name", "Alsama Student ID", "Essay ID", "Marker", "Mark (/20)", "Final essay mark (/20)"];
type Row = { email: string; final: number };
function extract(code: EssaySubjectCode, students: Row[]) {
  const rows = [HEADER];
  students.forEach((s) => {
    ["Essay 1", "Essay 2", "Essay 1", "Essay 2"].forEach((eid, k) =>
      rows.push([s.email, "name", "AL", eid, "M1", "9", k === 0 ? String(s.final) : ""]),
    );
  });
  return { students: extractSheet(rows, code), subjectsSeen: [code], skippedSheets: [] as string[] };
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

describe("template → provider, join on QM email, full weight", () => {
  it("the Final /20 lands on the subject at full weight (not halved again)", () => {
    const p = new InMemoryDataProvider();
    const id = rosterIds(p, english.id)[0]!;
    const report = apply(p, "ESL", [{ email: id, final: 15.25 }]); // half_up → 15
    expect(report.validCount).toBe(1);
    const pid = p.getEssayContext(CYCLE)!.subjects.find((s) => s.assessmentId === english.id)!.participants[0]!.participantId;
    const cell = p.getComposition(CYCLE)!.students.find((s) => s.participantId === pid)!
      .subjects.find((s) => s.assessmentId === english.id)!;
    expect(cell.essay).toBe(15);
  });

  it("re-uploading the same subject is idempotent", () => {
    const p = new InMemoryDataProvider();
    const id = rosterIds(p, english.id)[0]!;
    apply(p, "ESL", [{ email: id, final: 18.5 }]); // → 19
    const first = p.getEssayMarks(CYCLE)!;
    apply(p, "ESL", [{ email: id, final: 18.5 }]);
    const second = p.getEssayMarks(CYCLE)!;
    expect(second.matchedCount).toBe(first.matchedCount);
    expect(second.students.find((s) => s.participantId === id)!.marks[english.id]).toBe(19);
  });

  it("English and Arabic merge — English survives an Arabic upload", () => {
    const p = new InMemoryDataProvider();
    const eid = rosterIds(p, english.id)[0]!;
    const aid = rosterIds(p, arabic.id)[0]!;
    apply(p, "ESL", [{ email: eid, final: 20 }]);
    apply(p, "AFL", [{ email: aid, final: 10 }]);
    const model = p.getEssayMarks(CYCLE)!;
    expect(model.students.find((s) => s.participantId === eid)!.marks[english.id]).toBe(20);
    expect(model.students.find((s) => s.participantId === aid)!.marks[arabic.id]).toBe(10);
  });
});

describe("generate → fill → re-parse round-trip", () => {
  it("the cloned template round-trips: filled Finals parse back to the same marks", async () => {
    const p = new InMemoryDataProvider();
    const ctx = p.getEssayContext(CYCLE)!;
    // Clone the stored canonical asset, pre-filling identity from the roster.
    const wb = buildEssayTemplateWorkbook(STORED_ASSET(), ctx);

    // The app owns the sheet names + join column.
    expect(wb.SheetNames).toContain("English Essay master");
    expect(wb.SheetNames).toContain("Arabic Essay master");
    const engSheet = "English Essay master";
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[engSheet]!, { header: 1 });
    const header = aoa[0]!;
    expect(header).toContain("QM email");
    expect(header).toContain("Final essay mark (/20)");

    // The first English student's block starts at row 2; QM email pre-filled from roster.
    const engRoster = ctx.subjects.find((s) => s.assessmentId === english.id)!.participants;
    const firstEmail = engRoster[0]!.studentId;
    expect(String(aoa[1]![0])).toBe(firstEmail);

    // Fill the Final in the CANONICAL column (exact header) for the first student.
    const finalCol = resolveColumns(header).final;
    const finalAddr = XLSX.utils.encode_cell({ r: 1, c: finalCol });
    wb.Sheets[engSheet]![finalAddr] = { t: "n", v: 17.5 };
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const result = await parseEssayMasterfile(new File([buf], "G12_Essay_Marks_FIXED_TEMPLATE.xlsx"));
    expect(result.sheetErrors).toHaveLength(0);
    const parsed = result.students.find((s) => s.subjectCode === "ESL" && s.email === firstEmail.toLowerCase())!;
    expect(parsed.finalRaw).toBe(17.5);
    expect(parsed.subjectEssay).toBe(18); // half_up(17.5)

    const report = validateEssayMasterfile(result, ctx);
    const valid = report.rows.find((r) => r.email === firstEmail.toLowerCase() && r.status === "valid")!;
    expect(valid.subjectEssay).toBe(18);
  });
});

describe("pending disclosure + anomalies", () => {
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
    apply(p, "ESL", englishRoster.map((email) => ({ email, final: 15 })));
    expect(pendingFor(p, english.id)).toBe(0);
    expect(pendingFor(p, arabic.id)).toBe(arabicBefore);
  });

  it("an off-roster email is rejected and not applied", () => {
    const p = new InMemoryDataProvider();
    const report = apply(p, "ESL", [{ email: "nobody@nowhere.com", final: 12 }]);
    expect(report.validCount).toBe(0);
    expect(report.rows[0]!.reason).toMatch(/not in the .* roster/i);
    expect(p.getEssayMarks(CYCLE)!.matchedCount).toBe(0);
  });

  it("a flagged (Clean-excluded) sitting is not applied", () => {
    const p = new InMemoryDataProvider();
    const id = rosterIds(p, english.id)[0]!;
    p.setCleanRemoval(CYCLE, english.id, { rows: [id] }, true);
    const report = apply(p, "ESL", [{ email: id, final: 15 }]);
    expect(report.flaggedCount).toBe(1);
    expect(report.validCount).toBe(0);
  });
});
