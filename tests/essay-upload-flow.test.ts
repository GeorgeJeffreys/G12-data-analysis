/**
 * Essay-marks upload flow (prompt 03) — the template + pre-write validation +
 * review-before-apply layer that surrounds the EXISTING `uploadEssayMarks` path.
 *
 * Guards:
 *  - getEssayContext exposes the essay subjects + roster keyed on the id the
 *    matcher consumes, with Clean-tab exclusion flags;
 *  - the template round-trips back through the EXISTING parseEssayMarks;
 *  - validation rejects unknown ids / out-of-range marks / non-essay subjects
 *    row-by-row and flags excluded sittings, writing nothing;
 *  - applying only the valid rows flows through uploadEssayMarks idempotently
 *    (keyed on (participantId, assessmentId) — re-apply overwrites, no dup);
 *  - the essays_pending disclosure surfaces on the sample export.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import seedJson from "@/lib/data/seed.generated.json";
import { validateEssayRows } from "@/lib/data/validate-essays";
import { buildEssayTemplateWorkbook } from "@/lib/data/essay-template";
import { parseEssayMarks, essaySubjectCode } from "@/lib/data/parse-essays";
import { parseExport, ingestAndClean } from "@/lib/ingest";
import { sampleExportPath } from "./fixtures";
import { XLSX } from "@/lib/export/sheet-utils";

const seed = seedJson as unknown as {
  liveCycle: { id: string; participants: { id: string }[]; assessments: { id: string; name: string }[] };
};
const CYCLE = seed.liveCycle.id;
const arabic = seed.liveCycle.assessments.find((a) => /arabic/i.test(a.name))!;

describe("getEssayContext", () => {
  it("exposes the two essay subjects with rosters keyed on the matcher's id", () => {
    const p = new InMemoryDataProvider();
    const ctx = p.getEssayContext(CYCLE)!;
    expect(ctx).not.toBeNull();
    expect(ctx.essayItemMax).toBe(20);
    expect(ctx.subjects.map((s) => s.code).sort()).toEqual(["AFL", "ESL"]);
    const afl = ctx.subjects.find((s) => s.assessmentId === arabic.id)!;
    expect(afl.participants.length).toBeGreaterThan(0);
    // roster id must be a real participant the matcher accepts
    expect(seed.liveCycle.participants.some((x) => x.id === afl.participants[0]!.participantId)).toBe(true);
  });

  it("returns null for an unknown cycle", () => {
    const p = new InMemoryDataProvider();
    expect(p.getEssayContext("no-such-cycle")).toBeNull();
  });
});

describe("essay template", () => {
  it("builds AFL/ESL sheets that round-trip through the existing parser", async () => {
    const p = new InMemoryDataProvider();
    const ctx = p.getEssayContext(CYCLE)!;
    const wb = buildEssayTemplateWorkbook(ctx);
    // sheets named by subject code so parseEssayMarks maps them
    expect(wb.SheetNames.map((n) => essaySubjectCode(n)).sort()).toEqual(["AFL", "ESL"]);

    // header shape
    const first = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1 })[0]!;
    expect(first).toContain("ParticipantID");
    expect(first).toContain("TotalScore");
    expect(first).toContain("MaxMark");

    // Fill a TotalScore into one row, serialise, and re-parse via parseEssayMarks.
    const aflName = wb.SheetNames.find((n) => essaySubjectCode(n) === "AFL")!;
    const ws = wb.Sheets[aflName]!;
    XLSX.utils.sheet_add_aoa(ws, [[15]], { origin: "D2" }); // TotalScore col (4th), row 2
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], "filled_template.xlsx");
    const rows = await parseEssayMarks(file);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.subjectCode === "AFL" && r.totalScore === 15)).toBe(true);
  });
});

describe("validateEssayRows", () => {
  it("accepts a valid row, rejects unknown id / out-of-range / non-essay subject", () => {
    const p = new InMemoryDataProvider();
    const ctx = p.getEssayContext(CYCLE)!;
    const good = ctx.subjects[0]!.participants[0]!;
    const report = validateEssayRows(
      [
        { participantId: good.participantId, subjectCode: ctx.subjects[0]!.code, totalScore: 12 },
        { participantId: "A-A-999999", subjectCode: ctx.subjects[0]!.code, totalScore: 10 },
        { participantId: good.participantId, subjectCode: ctx.subjects[0]!.code, totalScore: 99 },
        // parse-essays only emits AFL/ESL, but validate must still reject a bogus code
        { participantId: good.participantId, subjectCode: "XXX" as "AFL", totalScore: 10 },
      ],
      ctx,
    );
    expect(report.validCount).toBe(1);
    expect(report.rejectedCount).toBe(3);
    expect(report.valid).toHaveLength(1);
    expect(report.valid[0]!.participantId).toBe(good.participantId);
  });

  it("flags an excluded sitting instead of applying it", () => {
    const p = new InMemoryDataProvider();
    const ctx0 = p.getEssayContext(CYCLE)!;
    const subject = ctx0.subjects[0]!;
    const victim = subject.participants[0]!;
    // Exclude the sitting on the Clean tab, then re-read context.
    p.setCleanRemoval(CYCLE, subject.assessmentId, { rows: [victim.participantId] }, true);
    const ctx = p.getEssayContext(CYCLE)!;
    const entry = ctx.subjects[0]!.participants.find((x) => x.participantId === victim.participantId)!;
    expect(entry.excluded).toBe(true);
    const report = validateEssayRows([{ participantId: victim.participantId, subjectCode: subject.code, totalScore: 10 }], ctx);
    expect(report.flaggedCount).toBe(1);
    expect(report.validCount).toBe(0);
  });
});

describe("apply is idempotent through the existing path", () => {
  it("re-applying the same valid rows overwrites, never duplicates", () => {
    const p = new InMemoryDataProvider();
    const ctx = p.getEssayContext(CYCLE)!;
    const good = ctx.subjects.find((s) => s.assessmentId === arabic.id)!.participants[0]!;
    const rows = [{ participantId: good.participantId, subjectCode: "AFL" as const, totalScore: 14 }];
    p.uploadEssayMarks(CYCLE, "a.xlsx", validateEssayRows(rows, ctx).valid);
    const first = p.getEssayMarks(CYCLE)!;
    p.uploadEssayMarks(CYCLE, "a.xlsx", validateEssayRows(rows, ctx).valid);
    const second = p.getEssayMarks(CYCLE)!;
    expect(second.matchedCount).toBe(first.matchedCount);
    const s = second.students.find((st) => st.participantId === good.participantId)!;
    expect(s.marks[arabic.id]).toBe(14);
  });
});

describe("grades flow at half weight (Task 3 spot-check)", () => {
  it("an uploaded mark enters composition at half weight; the reserved max is unchanged", () => {
    const p = new InMemoryDataProvider();
    const ctx = p.getEssayContext(CYCLE)!;
    const pid = ctx.subjects.find((s) => s.assessmentId === arabic.id)!.participants[0]!.participantId;
    const subjectOf = (prov: InMemoryDataProvider) =>
      prov.getComposition(CYCLE)!.students.find((s) => s.participantId === pid)!
        .subjects.find((s) => s.assessmentId === arabic.id)!;

    const before = subjectOf(p);
    expect(before.essay).toBe(0);

    // Two essays of 20 → averaged mark 20 → contributes 20 out of the reserved
    // half-weighted max (40 raw essay marks / 2 = 20). The reserved max is already
    // in the denominator, so `max` does not move — only the numerator gains.
    p.uploadEssayMarks(CYCLE, "spot.xlsx", validateEssayRows(
      [{ participantId: pid, subjectCode: "AFL", totalScore: 20 }, { participantId: pid, subjectCode: "AFL", totalScore: 20 }],
      ctx,
    ).valid);
    const after = subjectOf(p);
    expect(after.essay).toBe(20);
    expect(after.mcq).toBe(before.mcq);
    expect(after.max).toBe(before.max);
    expect(after.total).toBe(before.total + 20);

    // Half-weight proof: an averaged mark of 10 contributes 10 (not 20).
    const p2 = new InMemoryDataProvider();
    p2.uploadEssayMarks(CYCLE, "half.xlsx", validateEssayRows(
      [{ participantId: pid, subjectCode: "AFL", totalScore: 10 }, { participantId: pid, subjectCode: "AFL", totalScore: 10 }],
      p2.getEssayContext(CYCLE)!,
    ).valid);
    expect(subjectOf(p2).essay).toBe(10);
  });
});

describe("essays_pending disclosure", () => {
  it("surfaces N essay items pending marks on the sample export", () => {
    const { rows } = parseExport(readFileSync(sampleExportPath()));
    const { validationReport } = ingestAndClean(rows);
    const check = validationReport.checks.find((c) => c.id === "essays_pending")!;
    expect(check).toBeTruthy();
    expect(check.status).toBe("warn");
    expect(check.count).toBeGreaterThan(0);
    // still non-blocking — the report as a whole passes
    expect(validationReport.passed).toBe(true);
  });
});
