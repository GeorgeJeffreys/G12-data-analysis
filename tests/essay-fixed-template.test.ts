/**
 * Prompt 03 — the fixed template, anchored on ONE canonical column.
 *
 * The app reads ONLY: the tab name (→ subject), `QM email` (case-insensitive), and
 * `Final essay mark (/20)` (EXACT normalized header, never substring). This suite
 * proves that against the canonical reference `G12_Essay_Marks_FIXED_TEMPLATE.xlsx`
 * and a synthetic fixture whose English sheet mimics the real one (extra `Dim*`,
 * `Total`, two decoy "individual final" columns) while the Arabic sheet is minimal.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseEssayMasterfile,
  extractSheet,
  resolveColumns,
  sheetContractError,
} from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import type { EssayUploadContext, EssaySubjectContext } from "@/lib/data/types";
import { XLSX } from "@/lib/export/sheet-utils";

const FIX = join(__dirname, "fixtures", "essays");
const fixedTemplate = () =>
  new File([readFileSync(join(FIX, "G12_Essay_Marks_FIXED_TEMPLATE.xlsx"))], "G12_Essay_Marks_FIXED_TEMPLATE.xlsx");

/** Acceptance table (prompt 03): email → English raw Final, rounded /20 (half_up). */
const ENGLISH: { handle: string; email: string; raw: number; en: number }[] = [
  { handle: "abed", email: "abed.alahmad@alsamaproject.com", raw: 15.5, en: 16 },
  { handle: "afraa", email: "afraa.abdullah.alsama@gmail.com", raw: 19.5, en: 20 },
  { handle: "amal", email: "amal.alkhalaf.alsama@gmail.com", raw: 12.5, en: 13 },
  { handle: "dalal", email: "dalal.hasan.alsama@gmail.com", raw: 19.5, en: 20 },
  { handle: "elaph", email: "elaph.hawran.alsama@gmail.com", raw: 18, en: 18 },
  { handle: "fatima.alissa", email: "fatima.alissa.alsama@gmail.com", raw: 15.5, en: 16 },
  { handle: "fatima.aljasem", email: "fatima.aljasem.alsama@gmail.com", raw: 17, en: 17 },
  { handle: "hussien", email: "hussien.diab@alsamaproject.com", raw: 18.5, en: 19 },
  { handle: "louay", email: "louay.alkadro@alsamaproject.com", raw: 13, en: 13 },
  { handle: "marah", email: "marah.fadel0@gmail.com", raw: 17.5, en: 18 },
  { handle: "maram", email: "maram.alkhoder.alsama@gmail.com", raw: 18.5, en: 19 },
  { handle: "marwa", email: "marwa.alomar@alsamaproject.com", raw: 17.5, en: 18 },
  { handle: "nour.alissa", email: "nour.alissa@alsamaproject.com", raw: 16.5, en: 17 },
  { handle: "nour.zaqzaq", email: "nour.zaqzaq@alsamaproject.com", raw: 16.5, en: 17 },
  { handle: "oula", email: "oula.abed.alkhalaf.2007@gmail.com", raw: 17, en: 17 },
  { handle: "safa", email: "safa.alomarii21@gmail.com", raw: 17, en: 17 },
  { handle: "wissal", email: "wissal.algaber.alsama@gmail.com", raw: 18.5, en: 19 },
];
const ALL_EMAILS = ENGLISH.map((s) => s.email);

function subject(code: "ESL" | "AFL", name: string, emails: string[]): EssaySubjectContext {
  return {
    assessmentId: code === "ESL" ? "eng" : "ara",
    code,
    name,
    participants: emails.map((email, i) => ({ participantId: `uuid-${code}-${i}`, studentId: email, name: `Roster ${i}`, excluded: false })),
  };
}
const CONTEXT: EssayUploadContext = {
  cycleId: "c",
  essayItemMax: 20,
  subjects: [
    subject("ESL", "English as a Second Language", ALL_EMAILS),
    subject("AFL", "Arabic as a First Language", ALL_EMAILS),
  ],
};

describe("FIXED_TEMPLATE acceptance — English marked, Arabic awaiting marks", () => {
  it("routes both sheets and reproduces all 17 English Finals (raw + half_up /20)", async () => {
    const result = await parseEssayMasterfile(fixedTemplate());
    expect(result.sheetErrors).toHaveLength(0);
    expect(result.subjectsSeen.sort()).toEqual(["AFL", "ESL"]);

    const en = new Map(result.students.filter((s) => s.subjectCode === "ESL").map((s) => [s.email, s]));
    expect(en.size).toBe(17);
    for (const o of ENGLISH) {
      const e = en.get(o.email)!;
      expect(e, `English ${o.email}`).toBeTruthy();
      // The Final is read from the EXACT canonical column, never the /10 decoy.
      expect(e.finalRaw, `raw ${o.email}`).toBe(o.raw);
      expect(e.subjectEssay, `/20 ${o.email}`).toBe(o.en);
    }
  });

  it("Arabic is unmarked — every student's Final is blank (rejected until marked)", async () => {
    const result = await parseEssayMasterfile(fixedTemplate());
    const ar = result.students.filter((s) => s.subjectCode === "AFL");
    expect(ar.length).toBe(17);
    for (const s of ar) {
      expect(s.finals).toHaveLength(0);
      expect(s.subjectEssay).toBeNull();
    }
  });

  it("validation: English 17 valid, Arabic 17 rejected with `no final mark`", async () => {
    const report = validateEssayMasterfile(await parseEssayMasterfile(fixedTemplate()), CONTEXT);
    const english = report.rows.filter((r) => r.subjectCode === "ESL");
    const arabic = report.rows.filter((r) => r.subjectCode === "AFL");
    expect(english.filter((r) => r.status === "valid")).toHaveLength(17);
    expect(arabic.filter((r) => r.status === "rejected")).toHaveLength(17);
    for (const r of arabic) expect(r.reason).toMatch(/no final/i);
    // The applied set is exactly the 17 English finals.
    expect(report.valid).toHaveLength(17);
    const abed = report.valid.find((v) => v.participantId === "abed.alahmad@alsamaproject.com")!;
    expect(abed.subjectCode).toBe("ESL");
    expect(abed.totalScore).toBe(16);
  });
});

// ── Synthetic fixture: English rich (decoys), Arabic minimal ──────────────────
type Cell = string | number;
function sheetFromAoa(aoa: Cell[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(aoa);
}
function workbookFile(sheets: { name: string; aoa: Cell[][] }[], fileName = "synthetic.xlsx"): File {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, sheetFromAoa(s.aoa), s.name);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], fileName);
}

/** English header mimicking the real sheet — two decoy "final" columns present. */
const RICH_HEADER: Cell[] = [
  "QM email", "Student name", "Alsama Student ID", "Essay ID", "Marker", "Mark (/20)",
  "Dim1", "Dim2", "Dim3", "Total score", "Average",
  "Indvidual final scores (/20)", "Individual final scores (/10)", "Final essay mark (/20)",
];
/** A 4-row block; the DECOY columns are deliberately WRONG so a mis-pick is caught. */
function richBlock(email: string, final: number): Cell[][] {
  return ["Essay 1", "Essay 1", "Essay 2", "Essay 2"].map((eid, k) => [
    email, "Name", "AL-1", eid, k % 2 ? "M2" : "M1", 9,
    3, 3, 3, 18, 4.5,
    99 /* decoy /20 */, final / 2 /* decoy /10 */, k === 0 ? final : "",
  ]);
}
/** Minimal Arabic sheet — only the three anchors, one row per student. */
const MIN_HEADER: Cell[] = ["QM email", "Student name", "Final essay mark (/20)"];

describe("synthetic — exact-header selection ignores the decoy `final` columns", () => {
  it("picks `Final essay mark (/20)` (col 13), not the /20 or /10 decoys", () => {
    const aoa = [RICH_HEADER, ...richBlock("x@y.com", 15.5)];
    const cols = resolveColumns(aoa[0]!);
    expect(cols.final).toBe(13); // the canonical column, NOT 11 (decoy /20) or 12 (decoy /10)
    expect(cols.email).toBe(0);
    const out = extractSheet(aoa, "ESL");
    expect(out).toHaveLength(1);
    expect(out[0]!.finalRaw).toBe(15.5); // 15.5, not 99 and not 7.75
    expect(out[0]!.subjectEssay).toBe(16);
  });

  it("routes a two-sheet workbook (rich English + minimal Arabic) by tab name", async () => {
    const file = workbookFile([
      { name: "English Essay master", aoa: [RICH_HEADER, ...richBlock("a@x.com", 17.5)] },
      { name: "Arabic Essay master", aoa: [MIN_HEADER, ["a@x.com", "Name", 13]] },
    ]);
    const result = await parseEssayMasterfile(file);
    expect(result.sheetErrors ?? []).toHaveLength(0);
    expect(result.subjectsSeen.sort()).toEqual(["AFL", "ESL"]);
    const en = result.students.find((s) => s.subjectCode === "ESL")!;
    const ar = result.students.find((s) => s.subjectCode === "AFL")!;
    expect(en.subjectEssay).toBe(18); // half_up(17.5)
    expect(ar.subjectEssay).toBe(13);
  });
});

describe("contract enforcement — reject a sheet missing the canonical column", () => {
  it("sheetContractError names the missing Final column", () => {
    const noFinal = [
      ["QM email", "Student name", "Indvidual final scores (/20)", "Individual final scores (/10)"],
      ["a@x.com", "Name", 18, 9],
    ];
    const err = sheetContractError(noFinal, "ESL");
    expect(err).toMatch(/final essay mark \(\/20\)/i);
  });

  it("parseEssayMasterfile rejects the whole sheet (no partial read) with a reason", async () => {
    const file = workbookFile([
      {
        name: "English Essay master",
        aoa: [
          ["QM email", "Student name", "Individual final scores (/10)"],
          ["a@x.com", "Name", 9],
        ],
      },
    ]);
    const result = await parseEssayMasterfile(file);
    expect(result.students).toHaveLength(0); // never partially read a broken contract
    expect(result.sheetErrors).toHaveLength(1);
    expect(result.sheetErrors![0]!.subjectCode).toBe("ESL");
    expect(result.sheetErrors![0]!.reason).toMatch(/final essay mark \(\/20\)/i);
  });

  it("rejects a blank final, an off-roster email, and a double-final with reasons", () => {
    const HEADER = ["QM email", "Student name", "Final essay mark (/20)"];
    const ctx: EssayUploadContext = {
      cycleId: "c",
      essayItemMax: 20,
      subjects: [subject("ESL", "English as a Second Language", ["real@x.com"])],
    };
    const matrix: Cell[][] = [
      HEADER,
      ["real@x.com", "Real", 16],
      ["blank@x.com", "Blank", ""], // no final
      ["off@nowhere.com", "Off", 12], // off-roster
      ["dup@x.com", "Dup", 15],
      ["dup@x.com", "Dup", 18], // two finals for one student
    ];
    const report = validateEssayMasterfile({ students: extractSheet(matrix, "ESL"), subjectsSeen: ["ESL"], skippedSheets: [] }, ctx);
    const by = new Map(report.rows.map((r) => [r.email, r]));
    expect(by.get("real@x.com")!.status).toBe("valid");
    expect(by.get("blank@x.com")!.reason).toMatch(/no final/i);
    expect(by.get("off@nowhere.com")!.reason).toMatch(/not in the .* roster/i);
    expect(by.get("dup@x.com")!.reason).toMatch(/multiple final/i);
    expect(report.valid).toHaveLength(1);
  });
});

describe("case-insensitive QM email header + join", () => {
  it("accepts `QM Email` / `QM email` and matches the roster case-insensitively", async () => {
    const file = workbookFile([
      { name: "English Essay master", aoa: [["QM Email", "Student name", "Final essay mark (/20)"], ["A@X.COM", "N", 16]] },
    ]);
    const result = await parseEssayMasterfile(file);
    expect(resolveColumns([["QM Email"]][0]!).email).toBe(0);
    const report = validateEssayMasterfile(result, {
      cycleId: "c",
      essayItemMax: 20,
      subjects: [subject("ESL", "English as a Second Language", ["a@x.com"])],
    });
    expect(report.validCount).toBe(1);
    expect(report.valid[0]!.totalScore).toBe(16);
  });
});
