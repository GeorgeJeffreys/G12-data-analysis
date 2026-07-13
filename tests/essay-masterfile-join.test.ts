/**
 * Email join for the fixed template (prompt 03 v2). Every student matches a roster
 * participant on `QM email`, case-insensitive exact. Blank email, off-roster email,
 * no-Final and multiple-Final are each REJECTED with a reason — never guessed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEssayMasterfile, extractSheet } from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import type { EssayUploadContext, EssaySubjectContext } from "@/lib/data/types";

const FIX = join(__dirname, "fixtures", "essays");
const filledTemplate = () =>
  new File([readFileSync(join(FIX, "G12_Essay_Marks_TEMPLATE_v2_filled.xlsx"))], "G12_Essay_Marks_TEMPLATE_v2_filled.xlsx");

function subject(code: "ESL" | "AFL", name: string, emails: string[]): EssaySubjectContext {
  return {
    assessmentId: code === "ESL" ? "eng" : "ara",
    code,
    name,
    participants: emails.map((email, i) => ({ participantId: `uuid-${code}-${i}`, studentId: email, name: `Roster ${i}`, excluded: false })),
  };
}

const ALL_EMAILS = [
  "afraa.abdullah.alsama@gmail.com", "abed.alahmad@alsamaproject.com", "amal.alkhalaf.alsama@gmail.com",
  "dalal.hasan.alsama@gmail.com", "elaph.hawran.alsama@gmail.com", "fatima.alissa.alsama@gmail.com",
  "fatima.aljasem.alsama@gmail.com", "hussien.diab@alsamaproject.com", "louay.alkadro@alsamaproject.com",
  "marah.fadel0@gmail.com", "maram.alkhoder.alsama@gmail.com", "marwa.alomar@alsamaproject.com",
  "nour.alissa@alsamaproject.com", "nour.zaqzaq@alsamaproject.com", "oula.abed.alkhalaf.2007@gmail.com",
  "safa.alomarii21@gmail.com", "wissal.algaber.alsama@gmail.com",
];

describe("filled template — all 34 rows match on QM email (case-insensitive)", () => {
  it("both subjects fully match the roster", async () => {
    const ctx: EssayUploadContext = {
      cycleId: "c",
      essayItemMax: 20,
      subjects: [
        subject("ESL", "English as a Second Language", ALL_EMAILS.map((e) => e.toUpperCase())),
        subject("AFL", "Arabic as a First Language", ALL_EMAILS.map((e) => e.toUpperCase())),
      ],
    };
    const report = validateEssayMasterfile(await parseEssayMasterfile(filledTemplate()), ctx);
    expect(report.validCount).toBe(34);
    expect(report.rejectedCount).toBe(0);
    const abedEn = report.rows.find((r) => r.subjectCode === "ESL" && r.email === "abed.alahmad@alsamaproject.com")!;
    expect(abedEn.status).toBe("valid");
    expect(abedEn.matchedEmail).toBe("ABED.ALAHMAD@ALSAMAPROJECT.COM");
    expect(abedEn.subjectEssay).toBe(15);
  });
});

describe("filled template — blank / off-roster / no-Final / multiple-Final rejected", () => {
  const HEADER = ["QM email", "Student name", "Alsama Student ID", "Essay ID", "Marker", "Mark (/20)", "Final essay mark (/20)"];
  const block = (email: string, finals: (number | string)[]) =>
    ["Essay 1", "Essay 2", "Essay 1", "Essay 2"].map((eid, k) => [email, "n", "AL", eid, "M1", "9", String(finals[k] ?? "")]);

  it("rejects each with a clear reason and matches the good one", () => {
    const ctx: EssayUploadContext = {
      cycleId: "c",
      essayItemMax: 20,
      subjects: [subject("ESL", "English as a Second Language", ["real.student@alsamaproject.com"])],
    };
    const matrix = [
      HEADER,
      ...block("real.student@alsamaproject.com", [16.0, "", "", ""]), // valid → 16
      ...block("", [12.0, "", "", ""]), // blank email → reject
      ...block("off@nowhere.com", [10.0, "", "", ""]), // off-roster → reject
      ...block("multi@alsamaproject.com", [15, "", 18, ""]), // multiple finals → reject (before roster)
    ];
    const report = validateEssayMasterfile({ students: extractSheet(matrix, "ESL"), subjectsSeen: ["ESL"], skippedSheets: [] }, ctx);

    const by = new Map(report.rows.map((r) => [r.email, r]));
    expect(by.get("real.student@alsamaproject.com")!.status).toBe("valid");
    expect(report.valid).toHaveLength(1);
    expect(report.valid[0]!.totalScore).toBe(16);
    expect(by.get("")!.status).toBe("rejected");
    expect(by.get("")!.reason).toMatch(/blank qm email/i);
    expect(by.get("off@nowhere.com")!.reason).toMatch(/not in the .* roster/i);
    // multiple finals is rejected BEFORE the roster check
    expect(by.get("multi@alsamaproject.com")!.reason).toMatch(/multiple final/i);
    expect(by.get("off@nowhere.com")!.matchedEmail).toBeNull();
  });

  it("a student with no Final is rejected (no final mark)", () => {
    const ctx: EssayUploadContext = {
      cycleId: "c",
      essayItemMax: 20,
      subjects: [subject("ESL", "English as a Second Language", ["real.student@alsamaproject.com"])],
    };
    const matrix = [HEADER, ...block("real.student@alsamaproject.com", ["", "", "", ""])];
    const report = validateEssayMasterfile({ students: extractSheet(matrix, "ESL"), subjectsSeen: ["ESL"], skippedSheets: [] }, ctx);
    expect(report.validCount).toBe(0);
    expect(report.rows[0]!.reason).toMatch(/no final/i);
  });
});
