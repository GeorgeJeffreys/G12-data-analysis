/**
 * Email join oracle (prompt 03) — every row of the real masterfile must match a
 * roster participant on the `QM Participant ID (email)` column, case-insensitive
 * exact. The Alsama Student ID is a human label only. A blank email and an
 * off-roster email are each REJECTED with a reason — never guessed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMasterfileMatrix, reconcileMasterfile } from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import type { EssayUploadContext } from "@/lib/data/types";

const FIX = join(__dirname, "fixtures", "essays");
const masterCsv = () => readFileSync(join(FIX, "FEB26_English_Essay_master__with_QM_ID.csv"), "utf-8");

function loadCrosswalk(): { studentId: string; email: string }[] {
  const text = readFileSync(join(FIX, "essay-studentid-to-email-crosswalk.csv"), "utf-8");
  return text.trim().split(/\r?\n/).slice(1).map((l) => l.split(",").map((c) => c.trim())).map((c) => ({ studentId: c[0]!, email: c[1]! }));
}

/** A synthetic English roster keyed on the QM email (= the app's studentId field). */
function contextFromEmails(emails: string[], opts: { excluded?: Set<string> } = {}): EssayUploadContext {
  return {
    cycleId: "cycle",
    essayItemMax: 20,
    subjects: [
      {
        assessmentId: "eng",
        code: "ESL",
        name: "English as a 2nd Language",
        participants: emails.map((email, i) => ({
          participantId: `uuid-${i}`,
          studentId: email, // in production the roster's studentId holds the QM email
          name: `Roster Name ${i}`,
          excluded: opts.excluded?.has(email) ?? false,
        })),
      },
    ],
  };
}

const HEADER = ["Student ID", "Essay ID", "Moderated final score", "Final scores:", "QM Participant ID (email)"];
function buildMatrix(students: { studentId: string; email: string; marks: number[] }[]): string[][] {
  const rows: string[][] = [HEADER];
  for (const s of students) {
    s.marks.forEach((m, i) => rows.push([s.studentId, `EE0${i + 1}.png`, "", String(m), s.email]));
  }
  return rows;
}

describe("email join oracle — all 17 match on the QM email column", () => {
  it("matches every one of the 17 students to the roster on email (case-insensitive)", async () => {
    const crosswalk = loadCrosswalk();
    // Roster emails in a DIFFERENT case, to prove the match is case-insensitive.
    const ctx = contextFromEmails(crosswalk.map((c) => c.email.toUpperCase()));
    const result = reconcileMasterfile(await parseMasterfileMatrix(masterCsv()), "ESL");
    const report = validateEssayMasterfile(result, ctx);

    expect(report.validCount).toBe(17);
    expect(report.rejectedCount).toBe(0);
    expect(report.flaggedCount).toBe(0);
    // every valid upload row is keyed on the email; the matched participant is shown
    for (const c of crosswalk) {
      const row = report.rows.find((r) => r.studentId === c.studentId)!;
      expect(row.status).toBe("valid");
      expect(row.email).toBe(c.email.toLowerCase());
      expect(row.matchedEmail).toBe(c.email.toUpperCase()); // the roster's canonical value
      expect(row.matchedName).toBeTruthy();
    }
    expect(report.valid.every((r) => r.participantId.includes("@"))).toBe(true);
  });
});

describe("email join — blank & off-roster emails are rejected, never guessed", () => {
  it("rejects a blank email and an email absent from the roster; matches the good one", () => {
    const ctx = contextFromEmails(["real.student@alsamaproject.com"]);
    const matrix = buildMatrix([
      { studentId: "G-1-000001", email: "real.student@alsamaproject.com", marks: [16, 14] }, // → 15, valid
      { studentId: "B-2-000002", email: "", marks: [12, 12] }, // blank email → reject
      { studentId: "O-3-000003", email: "nobody@nowhere.com", marks: [10, 10] }, // off-roster → reject
    ]);
    const report = validateEssayMasterfile(reconcileMasterfile(matrix, "ESL"), ctx);

    expect(report.validCount).toBe(1);
    expect(report.rejectedCount).toBe(2);
    expect(report.valid[0]!.participantId).toBe("real.student@alsamaproject.com");

    const byId = new Map(report.rows.map((r) => [r.studentId, r]));
    expect(byId.get("B-2-000002")!.status).toBe("rejected");
    expect(byId.get("B-2-000002")!.reason).toMatch(/blank qm participant id/i);
    expect(byId.get("O-3-000003")!.status).toBe("rejected");
    expect(byId.get("O-3-000003")!.reason).toMatch(/not in the .* roster/i);
    // neither rejected row was guessed onto a participant
    expect(byId.get("B-2-000002")!.matchedEmail).toBeNull();
    expect(byId.get("O-3-000003")!.matchedEmail).toBeNull();
  });
});
