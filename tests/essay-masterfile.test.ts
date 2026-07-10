/**
 * Reconciling essay-masterfile parser (prompt 03) — the REAL double-marking file
 * (CSV, one per language), reconciled per the SIGNED-OFF policy. The parser MUST
 * reproduce the independently hand-computed oracle table EXACTLY under
 * `ESSAY_ROUND_STAGE='sum'`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseMasterfileMatrix,
  reconcileMasterfile,
  inferEssayLanguage,
  roundHalfUp,
  masterfileToUploadRows,
  ESSAY_ROUND_STAGE,
  ESSAY_ITEM_MAX,
} from "@/lib/data/parse-essay-masterfile";

const FIX = join(__dirname, "fixtures", "essays");
const masterCsv = () => readFileSync(join(FIX, "FEB26_English_Essay_master__with_QM_ID.csv"), "utf-8");
const anomalyCsv = () => readFileSync(join(FIX, "feb26-english-essay-master-anomalies.csv"), "utf-8");

/** Student ID → QM email crosswalk, loaded from the fixture. */
function loadCrosswalk(): Map<string, string> {
  const text = readFileSync(join(FIX, "essay-studentid-to-email-crosswalk.csv"), "utf-8");
  return new Map(
    text.trim().split(/\r?\n/).slice(1).map((l) => l.split(",").map((c) => c.trim())).map((c) => [c[0]!, c[1]!]),
  );
}

/** The signed-off oracle (ROUND_SUM) + the rejected ROUND_EACH, from the fixture. */
function loadOracle(): { studentId: string; e1: number; e2: number; roundSum: number; roundEach: number }[] {
  const text = readFileSync(join(FIX, "essay-reconciled-english.csv"), "utf-8");
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","))
    .map((c) => ({ studentId: c[0]!, e1: Number(c[2]), e2: Number(c[3]), roundSum: Number(c[4]), roundEach: Number(c[5]) }));
}

describe("round_half_up", () => {
  it("rounds up on a 0.5", () => {
    expect(roundHalfUp(15.5)).toBe(16);
    expect(roundHalfUp(12.5)).toBe(13);
    expect(roundHalfUp(18.0)).toBe(18);
    expect(roundHalfUp(16.49)).toBe(16);
  });
});

describe("inferEssayLanguage", () => {
  it("maps the real filenames to a subject code by the language word", () => {
    expect(inferEssayLanguage("[INTERNAL] FEB26 marking masterfile [AFL ESL] (English Essay master).csv")).toBe("ESL");
    expect(inferEssayLanguage("[INTERNAL] FEB26 marking masterfile [AFL ESL] (Arabic Essay master).csv")).toBe("AFL");
    expect(inferEssayLanguage("اللغة العربية.csv")).toBe("AFL");
    expect(inferEssayLanguage("random.csv")).toBeNull();
  });
});

describe("reconcile masterfile — signed-off oracle (ROUND_SUM)", () => {
  it("the policy constant is 'sum'", () => {
    expect(ESSAY_ROUND_STAGE).toBe("sum");
    expect(ESSAY_ITEM_MAX).toBe(20);
  });

  it("reproduces all 17 hand-computed ROUND_SUM values exactly", async () => {
    const matrix = await parseMasterfileMatrix(masterCsv());
    const result = reconcileMasterfile(matrix, "ESL");
    expect(result.anomalies).toHaveLength(0);
    expect(result.reconciled).toHaveLength(17);

    const byId = new Map(result.reconciled.map((s) => [s.studentId, s]));
    for (const o of loadOracle()) {
      const got = byId.get(o.studentId);
      expect(got, `missing ${o.studentId}`).toBeTruthy();
      // approved per-essay marks read from Moderated-else-Final, ignoring Average/Total
      expect(got!.essays).toEqual([o.e1, o.e2]);
      // the authoritative signed-off value
      expect(got!.subjectEssay, `ROUND_SUM ${o.studentId}`).toBe(o.roundSum);
      expect(got!.subjectEssaySum).toBe(o.roundSum);
      // the rejected alternative is computed but not used
      expect(got!.subjectEssayEach).toBe(o.roundEach);
    }
  });

  it("the three students where rounding matters use the SUM value, not EACH", async () => {
    const matrix = await parseMasterfileMatrix(masterCsv());
    const byId = new Map(reconcileMasterfile(matrix, "ESL").reconciled.map((s) => [s.studentId, s]));
    // E-H-100108 → 18 (not 19), L-K-051006 → 13 (not 14), S-O-300503 → 17 (not 18)
    expect(byId.get("E-H-100108")!.subjectEssay).toBe(18);
    expect(byId.get("L-K-051006")!.subjectEssay).toBe(13);
    expect(byId.get("S-O-300503")!.subjectEssay).toBe(17);
    // and their EACH values differ, proving the fixture exercises the divergence
    expect(byId.get("E-H-100108")!.subjectEssayEach).toBe(19);
    expect(byId.get("L-K-051006")!.subjectEssayEach).toBe(14);
    expect(byId.get("S-O-300503")!.subjectEssayEach).toBe(18);
  });

  it("Moderated final score overrides Final scores when present", async () => {
    // In the fixture, A-A-260506/EE01 has Moderated=17 with a deliberately wrong
    // Final=99; the parser must take the Moderated value.
    const matrix = await parseMasterfileMatrix(masterCsv());
    const s = reconcileMasterfile(matrix, "ESL").reconciled.find((x) => x.studentId === "A-A-260506")!;
    expect(s.essays[0]).toBe(17); // Moderated won, not 99
  });

  it("reads the QM email column (matched by name, appended at the end) as the join key", async () => {
    const matrix = await parseMasterfileMatrix(masterCsv());
    const byId = new Map(reconcileMasterfile(matrix, "ESL").reconciled.map((s) => [s.studentId, s]));
    const crosswalk = loadCrosswalk();
    // every student carries the crosswalk email, lower-cased, on the reconciled row
    for (const [studentId, email] of crosswalk) {
      expect(byId.get(studentId)!.email).toBe(email.toLowerCase());
    }
  });

  it("emits ONE reconciled upload row per student keyed on the QM email, with the /20 and essay count", async () => {
    const matrix = await parseMasterfileMatrix(masterCsv());
    const rows = masterfileToUploadRows(reconcileMasterfile(matrix, "ESL"));
    expect(rows).toHaveLength(17);
    // keyed on the QM email — NOT the Alsama Student ID
    const r = rows.find((x) => x.participantId === "abed.alahmad@alsamaproject.com")!;
    expect(r).toBeTruthy();
    expect(r.subjectCode).toBe("ESL");
    expect(r.totalScore).toBe(16); // the reconciled /20, ready for the engine
    expect(r.essayCount).toBe(2);
    // the Student ID is never used as the key
    expect(rows.some((x) => x.participantId === "A-A-260506")).toBe(false);
  });
});

describe("reconcile masterfile — anomalies are flagged, never dropped", () => {
  it("surfaces a 1-essay student and an essay with no approved mark; keeps the good one", async () => {
    const matrix = await parseMasterfileMatrix(anomalyCsv());
    const result = reconcileMasterfile(matrix, "ESL");
    // good.student reconciles (16, 14) → 8 + 7 = 15
    expect(result.reconciled.map((s) => s.studentId)).toEqual(["X-3-000003"]);
    expect(result.reconciled[0]!.subjectEssay).toBe(15);

    const reasons = new Map(result.anomalies.map((a) => [a.studentId, a.reason]));
    expect(reasons.get("X-1-000001")).toMatch(/found 1/i);
    expect(reasons.get("X-2-000002")).toMatch(/no approved mark/i);
  });
});
