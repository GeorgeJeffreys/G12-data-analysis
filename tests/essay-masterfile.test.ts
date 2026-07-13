/**
 * Fixed essay template parser (prompt 03 v2). Reads ONLY the tab name (→ subject),
 * `QM email`, and `Final essay mark`; groups by email; takes the single non-blank
 * Final; rounds per `ESSAY_MARK_ROUNDING`. Reproduces the acceptance values for
 * `'half_up'`, and rejects blank-Final / multiple-Final structurally.
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
const filledTemplate = () =>
  new File([readFileSync(join(FIX, "G12_Essay_Marks_TEMPLATE_v2_filled.xlsx"))], "G12_Essay_Marks_TEMPLATE_v2_filled.xlsx");

/** Acceptance values: email → English /20, Arabic /20 (half_up), raw Final. */
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

describe("rounding + routing", () => {
  it("ESSAY_MARK_ROUNDING defaults to half_up", () => {
    expect(ESSAY_MARK_ROUNDING).toBe("half_up");
    expect(ESSAY_ITEM_MAX).toBe(20);
    expect(roundHalfUp(15.25)).toBe(15);
    expect(roundHalfUp(18.5)).toBe(19);
    expect(roundEssayMark(16.75)).toBe(17);
    expect(roundEssayMark(12.5)).toBe(13);
  });
  it("routes sheet names / filenames to subject codes", () => {
    expect(sheetSubjectCode("English Essay master")).toBe("ESL");
    expect(sheetSubjectCode("Arabic Essay master")).toBe("AFL");
    expect(sheetSubjectCode("Sheet1")).toBeNull();
    expect(inferEssayLanguage("anything English.csv")).toBe("ESL");
    expect(inferEssayLanguage("random.csv")).toBeNull();
  });
});

describe("template → email/Final extraction + acceptance (half_up)", () => {
  it("routes both sheets and reproduces the acceptance values for every student", async () => {
    const result = await parseEssayMasterfile(filledTemplate());
    expect(result.subjectsSeen.sort()).toEqual(["AFL", "ESL"]);

    const en = new Map(result.students.filter((s) => s.subjectCode === "ESL").map((s) => [s.email, s]));
    const ar = new Map(result.students.filter((s) => s.subjectCode === "AFL").map((s) => [s.email, s]));
    expect(en.size).toBe(17);
    expect(ar.size).toBe(17);

    for (const o of Object.values(ORACLE)) {
      const e = en.get(o.email)!;
      expect(e, `English ${o.email}`).toBeTruthy();
      expect(e.finalRaw).toBe(o.enRaw); // read directly from Final, one per student
      expect(e.subjectEssay, `English ${o.email} /20`).toBe(o.en);

      const a = ar.get(o.email)!;
      expect(a.finalRaw).toBe(o.arRaw);
      expect(a.subjectEssay, `Arabic ${o.email} /20`).toBe(o.ar);
    }
  });
});

describe("extractSheet — group by email, single Final, ignore working columns", () => {
  const HEADER = ["QM email", "Student name", "Alsama Student ID", "Essay ID", "Marker", "Mark (/20)", "Final essay mark (/20)"];
  const block = (emailCell: string, name: string, finals: (number | string)[]) =>
    ["Essay 1", "Essay 2", "Essay 1", "Essay 2"].map((eid, k) => [emailCell, name, "AL-1", eid, k % 2 ? "M2" : "M1", "9", String(finals[k] ?? "")]);

  it("takes the single Final on the first row and ignores Mark/Essay/Marker", () => {
    const matrix = [HEADER, ...block("one@x.com", "One", [17.25, "", "", ""])];
    const out = extractSheet(matrix, "ESL");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ email: "one@x.com", finalRaw: 17.25, subjectEssay: 17 });
    expect(out[0]!.finals).toEqual([17.25]);
  });

  it("flags no-Final and multiple-Final as finalRaw null (validation rejects them)", () => {
    const matrix = [
      HEADER,
      ...block("none@x.com", "None", ["", "", "", ""]), // 0 finals
      ...block("multi@x.com", "Multi", [15, "", 18, ""]), // 2 finals
    ];
    const byEmail = new Map(extractSheet(matrix, "ESL").map((s) => [s.email, s]));
    expect(byEmail.get("none@x.com")!.finals).toHaveLength(0);
    expect(byEmail.get("none@x.com")!.subjectEssay).toBeNull();
    expect(byEmail.get("multi@x.com")!.finals).toEqual([15, 18]);
    expect(byEmail.get("multi@x.com")!.subjectEssay).toBeNull();
  });
});
