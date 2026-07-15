/**
 * Prompt 07 — per-sheet subject routing, proven end-to-end.
 *
 * Diagnosis (verdict A, display-only): the parser already resolves the subject PER
 * SHEET inside the sheet loop (`parse-essay-masterfile.ts` — `sheetSubjectCode(name)`
 * then `extractSheet(matrix, code)`), each parsed entry carries its own `subjectCode`,
 * validation stamps it onto every `EssayUploadRow`, and the provider resolves
 * `essayAssessmentForCode(row.subjectCode)` per row — so `(participantId, assessmentId)`
 * is already correct per sheet. The bug was the review's SINGLE header hiding it.
 *
 * These tests lock the routing where it matters — the actual write. Both sheets are
 * marked with DELIBERATELY DIFFERENT values for the SAME students, driven through the
 * real `uploadEssayMarks`, and each subject's mark is asserted to land on its own
 * assessment with no cross-contamination — the assertion that was impossible while
 * Arabic was blank.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { parseEssayMasterfile } from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import type { EssayUploadContext, EssaySubjectContext } from "@/lib/data/types";
import { XLSX } from "@/lib/export/sheet-utils";
import seedJson from "@/lib/data/seed.generated.json";

const seed = seedJson as unknown as {
  liveCycle: { id: string; assessments: { id: string; name: string }[] };
};
const CYCLE = seed.liveCycle.id;
const english = seed.liveCycle.assessments.find((a) => /english/i.test(a.name))!;
const arabic = seed.liveCycle.assessments.find((a) => /arabic/i.test(a.name))!;

const MIN_HEADER = ["QM email", "Student name", "Final essay mark (/20)"];
type Cell = string | number;

/** Build a real multi-sheet .xlsx File from arrays-of-arrays, sheet by sheet. */
function workbookFile(sheets: { name: string; aoa: Cell[][] }[], fileName = "routing.xlsx"): File {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], fileName);
}

/** A one-row-per-student sheet: header + `[email, name, final]` rows. */
function subjectSheet(name: string, rows: { email: string; final: number }[]): { name: string; aoa: Cell[][] } {
  return { name, aoa: [MIN_HEADER, ...rows.map((r) => [r.email, "name", r.final] as Cell[])] };
}

/** studentId (QM email) → internal participant id, for reading marks back by student. */
function pidByStudentId(p: InMemoryDataProvider): Map<string, string> {
  const ctx = p.getEssayContext(CYCLE)!;
  const m = new Map<string, string>();
  for (const s of ctx.subjects) for (const part of s.participants) m.set(part.studentId, part.participantId);
  return m;
}

/** Roster studentIds (emails) present in BOTH the English and Arabic rosters. */
function sharedStudentIds(p: InMemoryDataProvider): string[] {
  const ctx = p.getEssayContext(CYCLE)!;
  const en = new Set(ctx.subjects.find((s) => s.assessmentId === english.id)!.participants.filter((x) => !x.excluded).map((x) => x.studentId));
  return ctx.subjects.find((s) => s.assessmentId === arabic.id)!.participants
    .filter((x) => !x.excluded && en.has(x.studentId))
    .map((x) => x.studentId);
}

/** Parse a workbook File, validate against the cycle, apply the valid rows. */
async function ingest(p: InMemoryDataProvider, file: File) {
  const report = validateEssayMasterfile(await parseEssayMasterfile(file), p.getEssayContext(CYCLE)!);
  p.uploadEssayMarks(CYCLE, file.name, report.valid);
  return report;
}

/** The stored mark for one student on one assessment, or null when unset. */
function markFor(p: InMemoryDataProvider, internalId: string, assessmentId: string): number | null {
  const st = p.getEssayMarks(CYCLE)!.students.find((s) => s.participantId === internalId);
  return st?.marks[assessmentId] ?? null;
}

describe("cross-subject contamination — both sheets marked with different values", () => {
  it("English marks land on English, Arabic marks land on Arabic — same students, no bleed", async () => {
    const p = new InMemoryDataProvider();
    const [abed, safa] = sharedStudentIds(p);
    expect(abed && safa, "seed roster must share ≥2 students across English & Arabic").toBeTruthy();
    const pid = pidByStudentId(p);

    // Deliberately different English vs Arabic values for the SAME students.
    const report = await ingest(
      p,
      workbookFile([
        subjectSheet("English Essay master", [{ email: abed!, final: 16 }, { email: safa!, final: 17 }]),
        subjectSheet("Arabic Essay master", [{ email: abed!, final: 9 }, { email: safa!, final: 11 }]),
      ]),
    );
    expect(report.validCount).toBe(4);

    // abed: English 16 (not 9), Arabic 9 (not 16). safa: English 17, Arabic 11.
    expect(markFor(p, pid.get(abed!)!, english.id)).toBe(16);
    expect(markFor(p, pid.get(abed!)!, arabic.id)).toBe(9);
    expect(markFor(p, pid.get(safa!)!, english.id)).toBe(17);
    expect(markFor(p, pid.get(safa!)!, arabic.id)).toBe(11);
  });

  it("neither subject's value overwrites the other (both distinct marks coexist)", async () => {
    const p = new InMemoryDataProvider();
    const [abed] = sharedStudentIds(p);
    const pid = pidByStudentId(p);
    await ingest(
      p,
      workbookFile([
        subjectSheet("English Essay master", [{ email: abed!, final: 16 }]),
        subjectSheet("Arabic Essay master", [{ email: abed!, final: 9 }]),
      ]),
    );
    const en = markFor(p, pid.get(abed!)!, english.id);
    const ar = markFor(p, pid.get(abed!)!, arabic.id);
    expect(en).toBe(16);
    expect(ar).toBe(9);
    expect(en).not.toBe(ar); // the two subjects are stored independently
  });

  it("sheet order is irrelevant — reversing the sheets yields identical marks", async () => {
    const [abed, safa] = sharedStudentIds(new InMemoryDataProvider());
    const forward = new InMemoryDataProvider();
    const reversed = new InMemoryDataProvider();
    const en = subjectSheet("English Essay master", [{ email: abed!, final: 16 }, { email: safa!, final: 17 }]);
    const ar = subjectSheet("Arabic Essay master", [{ email: abed!, final: 9 }, { email: safa!, final: 11 }]);

    await ingest(forward, workbookFile([en, ar], "forward.xlsx"));
    await ingest(reversed, workbookFile([ar, en], "reversed.xlsx")); // Arabic sheet FIRST

    const pf = pidByStudentId(forward);
    const pr = pidByStudentId(reversed);
    for (const id of [abed!, safa!]) {
      expect(markFor(forward, pf.get(id)!, english.id)).toBe(markFor(reversed, pr.get(id)!, english.id));
      expect(markFor(forward, pf.get(id)!, arabic.id)).toBe(markFor(reversed, pr.get(id)!, arabic.id));
    }
    // And concretely: Arabic-first did NOT make Arabic values win the English cells.
    expect(markFor(reversed, pr.get(abed!)!, english.id)).toBe(16);
    expect(markFor(reversed, pr.get(abed!)!, arabic.id)).toBe(9);
  });
});

describe("unmapped sheet — skipped, never defaulted", () => {
  it("a sheet whose name maps to no subject is reported as skipped and contributes nothing", async () => {
    const p = new InMemoryDataProvider();
    const [abed] = sharedStudentIds(p);
    const pid = pidByStudentId(p);
    const report = await ingest(
      p,
      workbookFile([
        subjectSheet("English Essay master", [{ email: abed!, final: 16 }]),
        // No "english"/"arabic" in the name and no Arabic script → routes to nothing.
        subjectSheet("Scratch notes", [{ email: abed!, final: 3 }]),
      ]),
    );
    expect(report.skippedSheets).toContain("Scratch notes");
    // The Scratch value (3) did NOT get defaulted onto English or Arabic.
    expect(report.validCount).toBe(1);
    expect(markFor(p, pid.get(abed!)!, english.id)).toBe(16);
    expect(markFor(p, pid.get(abed!)!, arabic.id)).toBeNull();
    // No subject group was created for the unmapped sheet.
    expect(report.subjects.some((g) => g.code !== "ESL" && g.code !== "AFL")).toBe(false);
  });
});

// ── Real file behaviour: English fully marked, Arabic awaiting marks ───────────
const FIX = join(__dirname, "fixtures", "essays");
const fixedTemplate = () =>
  new File([readFileSync(join(FIX, "G12_Essay_Marks_FIXED_TEMPLATE.xlsx"))], "G12_Essay_Marks_FIXED_TEMPLATE.xlsx");

/** Rounded /20 subject marks expected from the canonical reference file (half_up). */
const ENGLISH_MARKS: Record<string, number> = {
  "abed.alahmad@alsamaproject.com": 16,
  "afraa.abdullah.alsama@gmail.com": 20,
  "amal.alkhalaf.alsama@gmail.com": 13,
  "dalal.hasan.alsama@gmail.com": 20,
  "elaph.hawran.alsama@gmail.com": 18,
  "fatima.alissa.alsama@gmail.com": 16,
  "fatima.aljasem.alsama@gmail.com": 17,
  "hussien.diab@alsamaproject.com": 19,
  "louay.alkadro@alsamaproject.com": 13,
  "marah.fadel0@gmail.com": 18,
  "maram.alkhoder.alsama@gmail.com": 19,
  "marwa.alomar@alsamaproject.com": 18,
  "nour.alissa@alsamaproject.com": 17,
  "nour.zaqzaq@alsamaproject.com": 17,
  "oula.abed.alkhalaf.2007@gmail.com": 17,
  "safa.alomarii21@gmail.com": 17,
  "wissal.algaber.alsama@gmail.com": 19,
};
const ALL_EMAILS = Object.keys(ENGLISH_MARKS);

function rosterSubject(code: "ESL" | "AFL", name: string): EssaySubjectContext {
  return {
    assessmentId: code === "ESL" ? "eng" : "ara",
    code,
    name,
    participants: ALL_EMAILS.map((email, i) => ({ participantId: `uuid-${code}-${i}`, studentId: email, name: `Roster ${i}`, excluded: false })),
  };
}
const REAL_CONTEXT: EssayUploadContext = {
  cycleId: "c",
  essayItemMax: 20,
  subjects: [rosterSubject("ESL", "English as a Second Language"), rosterSubject("AFL", "Arabic as a First Language")],
};

describe("real fixed template — English 17 valid, Arabic reported as not-yet-marked", () => {
  it("routes per sheet: every English Final lands on the English group with its /20", async () => {
    const report = validateEssayMasterfile(await parseEssayMasterfile(fixedTemplate()), REAL_CONTEXT);
    const en = report.subjects.find((g) => g.code === "ESL")!;
    expect(en.validCount).toBe(17);
    expect(en.notYetMarked).toBe(false);
    const byEmail = new Map(report.valid.filter((v) => v.subjectCode === "ESL").map((v) => [v.participantId, v.totalScore]));
    expect(byEmail.size).toBe(17);
    for (const [email, mark] of Object.entries(ENGLISH_MARKS)) {
      expect(byEmail.get(email), `English ${email}`).toBe(mark);
    }
    // No English mark bled to Arabic: the applied set has zero AFL rows.
    expect(report.valid.some((v) => v.subjectCode === "AFL")).toBe(false);
  });

  it("Arabic is a single 'not yet marked (0 of 17)' pending group, not 17 red rejects", async () => {
    const report = validateEssayMasterfile(await parseEssayMasterfile(fixedTemplate()), REAL_CONTEXT);
    const ar = report.subjects.find((g) => g.code === "AFL")!;
    expect(ar.validCount).toBe(0);
    expect(ar.total).toBe(17);
    expect(ar.unmarkedCount).toBe(17);
    expect(ar.notYetMarked).toBe(true);
    // The pending rows are collapsed — none are listed individually as problems.
    expect(ar.rows).toHaveLength(0);
  });
});
