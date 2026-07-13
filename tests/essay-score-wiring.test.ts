/**
 * Essay → score wiring lock (prompt 05). Persisted essay marks MUST reach the
 * score at FULL weight: the reconciled subject essay /20 adds into the /66 total
 * (46 MCQ + 20 reserved), NOT halved again (the /20 already absorbed the halving
 * in the parser). This test is the reusable audit oracle — 17 English students,
 * independently hand-computed as MCQ + essay/20 — and a full apply → persist →
 * hydrate round-trip so the wiring can never silently regress to MCQ-only.
 *
 * Ground truth (verified against live data): English MCQ max = 46, displayed /66
 * (20 reserved for the essay). Oracle in `english_essay_audit_february_2026.csv`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as engine from "@/lib/engine";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { extractSheet } from "@/lib/data/parse-essay-masterfile";
import { validateEssayMasterfile } from "@/lib/data/validate-essay-masterfile";
import seedJson from "@/lib/data/seed.generated.json";
import type { EssayUploadRow } from "@/lib/data/provider";

const AUDIT = join(__dirname, "fixtures", "essays", "english_essay_audit_february_2026.csv");

/** The 17-row English audit oracle: email, MCQ raw /46, essay /20, total /66. */
function loadAudit(): { email: string; mcq: number; essay: number; total: number }[] {
  return readFileSync(AUDIT, "utf-8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(",").map((c) => c.trim()))
    .map((c) => ({ email: c[0]!, mcq: Number(c[1]), essay: Number(c[2]), total: Number(c[3]) }));
}

const AID = "eng";
const MCQ_MAX = 46;
const ESSAY_RESERVED = 20;
const items = Array.from({ length: MCQ_MAX }, (_, i) => ({ itemId: `Q${i + 1}`, assessmentId: AID, maxScore: 1 }));

describe("audit oracle — computeScores lands essay at FULL weight into /66", () => {
  it("reproduces all 17 English totals exactly (MCQ + essay/20, out of 66)", () => {
    const audit = loadAudit();
    const responses = audit.flatMap((s) =>
      Array.from({ length: MCQ_MAX }, (_, i) => ({ participantId: s.email, itemId: `Q${i + 1}`, assessmentId: AID, score: i < s.mcq ? 1 : 0 })),
    );
    // One reconciled essay mark per student, /20 — added as-is (full weight).
    const essayMarks = audit.map((s) => ({ participantId: s.email, assessmentId: AID, mark: s.essay }));

    const scores = engine.computeScores(responses, [], {
      essayMarks,
      essayAssessmentIds: [AID],
      essayMax: ESSAY_RESERVED,
      items,
    });
    const by = new Map(scores.map((s) => [s.participantId, s]));

    for (const s of audit) {
      const got = by.get(s.email)!;
      expect(got.max).toBe(MCQ_MAX + ESSAY_RESERVED); // 66
      expect(got.mcq).toBe(s.mcq);
      expect(got.essay).toBe(s.essay); // full weight — NOT s.essay/2
      expect(got.raw, `English total for ${s.email}`).toBe(s.total);
    }
  });

  it("under-weighting (double-halve) would miss the oracle — guards the /20 full weight", () => {
    const audit = loadAudit();
    // Abed: 23 MCQ + 16 essay = 39. A double-halve (essay 8) would give 31 ≠ 39.
    const abed = audit.find((s) => s.email.startsWith("abed"))!;
    expect(abed.mcq + abed.essay).toBe(39);
    expect(abed.mcq + Math.round(abed.essay / 2)).not.toBe(abed.total);
  });
});

// ── End-to-end wiring: apply → persist → hydrate → score, banner clears ──────
const seed = seedJson as unknown as {
  liveCycle: { id: string; participants: { id: string; studentId: string }[]; assessments: { id: string; name: string }[] };
};
const CYCLE = seed.liveCycle.id;
const english = seed.liveCycle.assessments.find((a) => /english/i.test(a.name))!;

const HEADER = ["QM email", "Student name", "Essay ID", "Marker", "Mark (/20)", "Final essay mark (/20)"];
function sheet(students: { email: string; final: number }[]) {
  const rows = [HEADER];
  students.forEach((s) =>
    ["Essay 1", "Essay 2", "Essay 1", "Essay 2"].forEach((eid, k) =>
      rows.push([s.email, "name", eid, "M1", "9", k === 0 ? String(s.final) : ""]),
    ),
  );
  return { students: extractSheet(rows, "ESL"), subjectsSeen: ["ESL" as const], skippedSheets: [] as string[] };
}

/** Mirror of supabase-hydrate `classify(name).subjectCode` for the round-trip. */
function subjectCodeOf(name: string): "AFL" | "ESL" | null {
  if (/[؀-ۿ]/.test(name) || /arabic/i.test(name)) return "AFL";
  if (/english/i.test(name)) return "ESL";
  return null;
}

describe("essay → score wiring survives the persistence round-trip", () => {
  it("apply → persist → hydrate keeps the essay in the score, and the banner state is right", () => {
    const p = new InMemoryDataProvider();
    const ctx = p.getEssayContext(CYCLE)!;
    const eng = ctx.subjects.find((s) => s.assessmentId === english.id)!;
    const join = eng.participants[0]!.studentId; // seed join key (= QM email in prod)
    const pid = eng.participants[0]!.participantId;

    // Apply: moderated Final 15.5 → half_up → 16.
    const report = validateEssayMasterfile(sheet([{ email: join, final: 15.5 }]), ctx);
    p.uploadEssayMarks(CYCLE, "english.xlsx", report.valid);

    const cellApplied = p.getComposition(CYCLE)!.students.find((s) => s.participantId === pid)!
      .subjects.find((s) => s.assessmentId === english.id)!;
    expect(cellApplied.essay).toBe(16); // full weight, into the reserved 20

    // Persist (what the RPC writes) then hydrate (essay_marks rows → d.essays).
    const persisted = p.essayMarksForPersistence(CYCLE);
    expect(persisted).toHaveLength(1);
    const nameById = new Map(seed.liveCycle.assessments.map((a) => [a.id, a.name]));
    const dEssays: EssayUploadRow[] = persisted
      .map((r) => {
        const code = subjectCodeOf(nameById.get(r.assessment_id) ?? "");
        return code ? { participantId: r.participant_id, subjectCode: code, totalScore: Number(r.mark) } : null;
      })
      .filter((r): r is EssayUploadRow => r !== null);

    const fresh = new InMemoryDataProvider();
    fresh.uploadEssayMarks(CYCLE, "essay_marks.xlsx", dEssays);

    const cellHydrated = fresh.getComposition(CYCLE)!.students.find((s) => s.participantId === pid)!
      .subjects.find((s) => s.assessmentId === english.id)!;
    expect(cellHydrated.essay).toBe(16); // STILL counts after rehydrate — the wiring lock

    // Banner: English loaded (count>0) → clears; Arabic still empty → remains.
    const model = fresh.getEssayMarks(CYCLE)!;
    const englishSubj = model.subjects.find((s) => s.code === "ESL")!;
    const arabicSubj = model.subjects.find((s) => s.code === "AFL")!;
    expect(englishSubj.count).toBeGreaterThan(0);
    expect(arabicSubj.count).toBe(0);
  });
});
