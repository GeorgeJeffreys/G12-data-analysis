/**
 * Email join for the essay workbook (prompt 03). Every student matches a roster
 * participant on the QM email column, case-insensitive exact. Blank email, an
 * off-roster email, and a student with no Adjusted value are each REJECTED with a
 * reason — never guessed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEssayMasterfile, extractSheet } from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import type { EssayUploadContext, EssaySubjectContext } from "@/lib/data/types";

const FIX = join(__dirname, "fixtures", "essays");
const workbookFile = () =>
  new File([readFileSync(join(FIX, "FEB26_essay_master_workbook.xlsx"))], "FEB26_essay_master_workbook.xlsx");

/** A synthetic roster keyed on the QM email (= the app's studentId field in prod). */
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

describe("workbook email join — all 34 rows match (case-insensitive)", () => {
  it("both subjects fully match the roster on the QM email", async () => {
    // Roster emails in a DIFFERENT case, to prove the join is case-insensitive.
    const ctx: EssayUploadContext = {
      cycleId: "c",
      essayItemMax: 20,
      subjects: [
        subject("ESL", "English as a 2nd Language", ALL_EMAILS.map((e) => e.toUpperCase())),
        subject("AFL", "اللّغة العربيّة", ALL_EMAILS.map((e) => e.toUpperCase())),
      ],
    };
    const report = validateEssayMasterfile(await parseEssayMasterfile(workbookFile()), ctx);
    expect(report.validCount).toBe(34);
    expect(report.rejectedCount).toBe(0);
    expect(report.valid.every((r) => r.participantId.includes("@"))).toBe(true);
    // matched participant surfaced for sign-off
    const abedEn = report.rows.find((r) => r.subjectCode === "ESL" && r.email === "abed.alahmad@alsamaproject.com")!;
    expect(abedEn.status).toBe("valid");
    expect(abedEn.matchedEmail).toBe("ABED.ALAHMAD@ALSAMAPROJECT.COM");
    expect(abedEn.subjectEssay).toBe(15);
  });
});

describe("workbook — blank / off-roster / no-Adjusted are rejected", () => {
  const HEADER = ["Student ID", "Student name", "Adjusted scores (USE THESE)", "QM email"];

  it("rejects each with a clear reason and matches the good one", () => {
    const ctx: EssayUploadContext = {
      cycleId: "c",
      essayItemMax: 20,
      subjects: [subject("ESL", "English as a 2nd Language", ["real.student@alsamaproject.com"])],
    };
    const matrix = [
      HEADER,
      ["G1", "good", "16.0", "real.student@alsamaproject.com"], // → 16, valid
      ["B2", "blank", "12.0", ""], // blank email → reject
      ["O3", "off", "10.0", "nobody@nowhere.com"], // off-roster → reject
      ["N4", "noadj", "", "real.student@alsamaproject.com"], // no Adjusted → reject
    ];
    const report = validateEssayMasterfile({ students: extractSheet(matrix, "ESL"), subjectsSeen: ["ESL"], skippedSheets: [] }, ctx);

    expect(report.validCount).toBe(1);
    expect(report.valid[0]!.participantId).toBe("real.student@alsamaproject.com");
    expect(report.valid[0]!.totalScore).toBe(16);

    const by = new Map(report.rows.map((r) => [r.studentLabel, r]));
    expect(by.get("B2")!.status).toBe("rejected");
    expect(by.get("B2")!.reason).toMatch(/blank qm email/i);
    expect(by.get("O3")!.status).toBe("rejected");
    expect(by.get("O3")!.reason).toMatch(/not in the .* roster/i);
    expect(by.get("N4")!.status).toBe("rejected");
    expect(by.get("N4")!.reason).toMatch(/adjusted/i);
    // nothing guessed onto a participant
    expect(by.get("O3")!.matchedEmail).toBeNull();
  });
});
