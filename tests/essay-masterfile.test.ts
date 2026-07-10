/**
 * Essay workbook parser (prompt 03). Reads the marking team's moderated
 * `Adjusted scores (USE THESE)` column directly (never recomputed), routes each
 * sheet to its subject by name, joins on the QM email. Reproduces the acceptance
 * oracle for `ESSAY_MARK_ROUNDING='half_up'`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseEssayMasterfile,
  extractSheet,
  sheetSubjectCode,
  inferEssayLanguage,
  roundEssayMark,
  roundHalfUp,
  ESSAY_MARK_ROUNDING,
  ESSAY_ITEM_MAX,
} from "@/lib/data/parse-essay-masterfile";

const FIX = join(__dirname, "fixtures", "essays");
const workbookFile = () =>
  new File([readFileSync(join(FIX, "FEB26_essay_master_workbook.xlsx"))], "FEB26_essay_master_workbook.xlsx");

/** Acceptance oracle: student → email, English /20, Arabic /20 (half_up rounding). */
const ORACLE: Record<string, { email: string; en: number; ar: number; enRaw: number; arRaw: number }> = {
  afraa: { email: "afraa.abdullah.alsama@gmail.com", en: 19, ar: 17, enRaw: 19.0, arRaw: 16.75 },
  abed: { email: "abed.alahmad@alsamaproject.com", en: 15, ar: 15, enRaw: 15.25, arRaw: 14.5 },
  amal: { email: "amal.alkhalaf.alsama@gmail.com", en: 13, ar: 15, enRaw: 12.5, arRaw: 15.0 },
  dalal: { email: "dalal.hasan.alsama@gmail.com", en: 19, ar: 15, enRaw: 19.25, arRaw: 15.25 },
  elaph: { email: "elaph.hawran.alsama@gmail.com", en: 16, ar: 19, enRaw: 16.0, arRaw: 18.5 },
  "fatima.alissa": { email: "fatima.alissa.alsama@gmail.com", en: 15, ar: 14, enRaw: 15.0, arRaw: 14.0 },
  "fatima.aljasem": { email: "fatima.aljasem.alsama@gmail.com", en: 17, ar: 15, enRaw: 17.0, arRaw: 15.0 },
  hussien: { email: "hussien.diab@alsamaproject.com", en: 18, ar: 16, enRaw: 18.25, arRaw: 15.75 },
  louay: { email: "louay.alkadro@alsamaproject.com", en: 13, ar: 14, enRaw: 13.0, arRaw: 13.5 },
  marah: { email: "marah.fadel0@gmail.com", en: 16, ar: 16, enRaw: 15.5, arRaw: 16.25 },
  maram: { email: "maram.alkhoder.alsama@gmail.com", en: 18, ar: 16, enRaw: 18.25, arRaw: 15.75 },
  marwa: { email: "marwa.alomar@alsamaproject.com", en: 17, ar: 16, enRaw: 17.25, arRaw: 16.0 },
  "nour.alissa": { email: "nour.alissa@alsamaproject.com", en: 16, ar: 14, enRaw: 16.0, arRaw: 13.75 },
  "nour.zaqzaq": { email: "nour.zaqzaq@alsamaproject.com", en: 16, ar: 16, enRaw: 16.25, arRaw: 16.0 },
  oula: { email: "oula.abed.alkhalaf.2007@gmail.com", en: 17, ar: 13, enRaw: 16.75, arRaw: 13.0 },
  safa: { email: "safa.alomarii21@gmail.com", en: 17, ar: 18, enRaw: 16.75, arRaw: 17.5 },
  wissal: { email: "wissal.algaber.alsama@gmail.com", en: 19, ar: 15, enRaw: 18.5, arRaw: 15.25 },
};

describe("rounding", () => {
  it("ESSAY_MARK_ROUNDING defaults to half_up; roundEssayMark applies round_half_up", () => {
    expect(ESSAY_MARK_ROUNDING).toBe("half_up");
    expect(ESSAY_ITEM_MAX).toBe(20);
    expect(roundHalfUp(15.25)).toBe(15);
    expect(roundHalfUp(18.5)).toBe(19);
    expect(roundHalfUp(15.5)).toBe(16);
    expect(roundEssayMark(16.75)).toBe(17);
    expect(roundEssayMark(12.5)).toBe(13);
  });
});

describe("sheet / filename routing", () => {
  it("routes sheet names and filenames to subject codes", () => {
    expect(sheetSubjectCode("English Essay master")).toBe("ESL");
    expect(sheetSubjectCode("Arabic Essay master")).toBe("AFL");
    expect(sheetSubjectCode("اللّغة العربيّة")).toBe("AFL");
    expect(sheetSubjectCode("Sheet1")).toBeNull();
    expect(inferEssayLanguage("something English master.csv")).toBe("ESL");
    expect(inferEssayLanguage("random.csv")).toBeNull();
  });
});

describe("workbook → Adjusted extraction + oracle (half_up)", () => {
  it("routes both sheets and reproduces the acceptance oracle for every student", async () => {
    const result = await parseEssayMasterfile(workbookFile());
    expect(result.subjectsSeen.sort()).toEqual(["AFL", "ESL"]);

    const en = new Map(result.students.filter((s) => s.subjectCode === "ESL").map((s) => [s.studentName, s]));
    const ar = new Map(result.students.filter((s) => s.subjectCode === "AFL").map((s) => [s.studentName, s]));
    expect(en.size).toBe(17);
    expect(ar.size).toBe(17);

    for (const [name, o] of Object.entries(ORACLE)) {
      const e = en.get(name)!;
      expect(e, `English ${name}`).toBeTruthy();
      expect(e.adjustedRaw).toBe(o.enRaw); // read directly, not recomputed
      expect(e.subjectEssay, `English ${name} /20`).toBe(o.en);
      expect(e.email).toBe(o.email); // QM email carried, lower-cased

      const a = ar.get(name)!;
      expect(a.adjustedRaw).toBe(o.arRaw);
      expect(a.subjectEssay, `Arabic ${name} /20`).toBe(o.ar);
    }
  });

  it("ignores Dim/Total/Average/Final/Moderated junk columns (only Adjusted is read)", async () => {
    // The fixture fills Total=88, Average=77, Moderated=88, Final=99 on every anchor
    // row; the oracle values come only from Adjusted, so those must be ignored.
    const result = await parseEssayMasterfile(workbookFile());
    const abed = result.students.find((s) => s.subjectCode === "ESL" && s.studentName === "abed")!;
    expect(abed.subjectEssay).toBe(15); // from Adjusted 15.25, not 88/77/99
  });
});

describe("extractSheet — forward-fill + missing Adjusted", () => {
  const HEADER = ["Student ID", "Student name", "Total score", "Adjusted scores (USE THESE)", "QM email"];

  it("forward-fills a blank Student ID onto the anchor row and takes the single Adjusted", () => {
    const matrix = [
      HEADER,
      ["S1", "one", "88", "17.25", "one@x.com"],
      ["", "", "66", "", ""], // detail row → same student
      ["S2", "two", "88", "", "two@x.com"], // no Adjusted → subjectEssay null
    ];
    const out = extractSheet(matrix, "ESL");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ studentLabel: "S1", email: "one@x.com", adjustedRaw: 17.25, subjectEssay: 17 });
    expect(out[1]).toMatchObject({ studentLabel: "S2", email: "two@x.com", adjustedRaw: null, subjectEssay: null });
  });
});
