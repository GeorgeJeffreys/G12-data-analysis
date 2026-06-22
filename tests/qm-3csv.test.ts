/**
 * 3-CSV Questionmark ingest — canonical-model tests against the anonymised
 * fixtures (`tests/fixtures/qm/{Items,Assessments,Topics}.csv`). The fixtures are
 * synthetic-PII copies of the real May-2026 export with the structure (IDs,
 * scores, types, statuses, topics, group names, attempts) preserved, so the
 * reconciliation and join assertions exercise the real shape.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseCsv,
  detectKind,
  detectThreeExports,
  DetectionError,
  buildCanonicalModel,
  buildCanonicalModelFromTables,
  normalizeSubjectName,
  parseSitting,
  ingestThreeExports,
  type NamedInput,
} from "@/lib/ingest/qm";

const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const read = (name: string) => readFileSync(path.join(qmDir, `${name}.csv`));

function files(): NamedInput[] {
  // Deliberately out of order + misleading-ish names to prove header-detection,
  // not filename, drives classification.
  return [
    { name: "export_a.csv", data: read("Topics") },
    { name: "export_b.csv", data: read("Items") },
    { name: "export_c.csv", data: read("Assessments") },
  ];
}

const model = buildCanonicalModel(files());

describe("CSV parsing (BOM / CRLF / quoted fields)", () => {
  it("strips the BOM and reads the header cleanly", () => {
    const table = parseCsv(read("Assessments"));
    expect(table.headers[0]).toBe("AssessmentId");
    expect(table.headers).toContain("ResultParticipantName");
    expect(table.rows.length).toBe(130);
  });

  it("preserves big ResultId join keys as exact strings (no number coercion)", () => {
    const table = parseCsv(read("Topics"));
    expect(table.rows[0]!.ResultId).toMatch(/^\d+$/);
  });
});

describe("header-signature detection", () => {
  it("classifies each file by its columns, not its name", () => {
    expect(detectKind(parseCsv(read("Items")).headers)).toBe("items");
    expect(detectKind(parseCsv(read("Assessments")).headers)).toBe("assessments");
    expect(detectKind(parseCsv(read("Topics")).headers)).toBe("topics");
  });

  it("requires all three; throws a clear error when one is missing", () => {
    expect(() =>
      detectThreeExports([
        { name: "i.csv", data: read("Items") },
        { name: "a.csv", data: read("Assessments") },
      ]),
    ).toThrowError(DetectionError);
  });
});

describe("subject-name normalisation", () => {
  it("merges the 'Applicable Maths' variant into one subject", () => {
    expect(normalizeSubjectName("G12++ Applicable Maths")).toBe("G12++ Applicable Math");
    expect(normalizeSubjectName("G12++ Applicable Math")).toBe("G12++ Applicable Math");
  });

  it("yields exactly the five graded subjects (no survey, no 'Maths' duplicate)", () => {
    const names = model.subjects.map((s) => s.name).sort();
    expect(names).toEqual(
      [
        "G12++ Applicable Math",
        "G12++ English as a 2nd Language",
        "G12++ Life Success Skills",
        "G12++ Scientific Thinking",
        "G12++ اللّغة العربيّة",
      ].sort(),
    );
    const am = model.subjects.find((s) => s.name === "G12++ Applicable Math")!;
    // Both raw variants folded into this one subject.
    expect(am.rawNames).toEqual(
      expect.arrayContaining(["G12++ Applicable Math", "G12++ Applicable Maths"]),
    );
  });
});

describe("surveys excluded", () => {
  it("drops every survey / UX assessment and records them", () => {
    expect(model.excludedSurveys.length).toBeGreaterThan(0);
    for (const r of model.results) {
      expect(/survey|user experience/i.test(r.rawSubjectName)).toBe(false);
    }
  });
});

describe("every question counts (no QuestionStatus filtering)", () => {
  it("retains all question types and Beta items in the canonical items", () => {
    const types = new Set(model.items.map((i) => i.questionType));
    // The graded subjects include essays + stimulus (max-0) + MCQ — all kept.
    expect(types.has("Multiple Choice")).toBe(true);
    expect(types.has("Essay")).toBe(true);
    const beta = model.items.filter((i) => (i.status ?? "").toLowerCase() === "beta");
    expect(beta.length).toBeGreaterThan(0); // Beta retained, only informational
  });

  it("matches the data-map per-subject item structure", () => {
    const by = new Map(model.subjects.map((s) => [s.name, s]));
    // Unmerged subjects match the data map exactly.
    expect(by.get("G12++ Scientific Thinking")!.itemCount).toBe(37);
    expect(by.get("G12++ Life Success Skills")!.itemCount).toBe(26);
    expect(by.get("G12++ English as a 2nd Language")!.itemCount).toBe(66);
    expect(by.get("G12++ English as a 2nd Language")!.qmMaximumScore).toBe(88);
    expect(by.get("G12++ English as a 2nd Language")!.betaItemCount).toBe(9);
    // Applicable Math folds in the attempt-2 "Maths" pilot's 44 distinct items
    // (42 real + 44 pilot = 86) — merged, never dropped, so scoring can decide later.
    expect(by.get("G12++ Applicable Math")!.itemCount).toBe(86);
  });
});

describe("participants — all personal fields retained", () => {
  it("keys by email and keeps names, DOB, gender, group", () => {
    expect(model.participants.length).toBe(18);
    for (const p of model.participants) {
      expect(p.email).toContain("@");
      expect(p.firstName).toBeTruthy();
      expect(p.lastName).toBeTruthy();
      expect(p.dob).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Gender / cohort group are RETAINED where present (null/empty only where QM
    // had them "<Not defined>" — faithful to the real export, where a couple of
    // participants genuinely lack a defined gender or group).
    expect(model.participants.filter((p) => p.gender).length).toBeGreaterThanOrEqual(15);
    expect(model.participants.filter((p) => p.groupNames.length > 0).length).toBeGreaterThanOrEqual(16);
  });
});

describe("QM totals trusted + topic rollups joined", () => {
  it("carries QM's per-result totals straight through", () => {
    const r = model.results[0]!;
    expect(r.maximumScore).toBeGreaterThan(0);
    expect(r.percentageScore).not.toBeNull();
    expect(r.responses.length).toBeGreaterThan(0);
    expect(r.topics.length).toBeGreaterThan(0);
  });

  it("captures the technical flag, attempt number and sitting", () => {
    const statuses = new Set(model.results.map((r) => r.status));
    expect([...statuses].some((s) => s && /finished/i.test(s))).toBe(true);
    expect(model.results.some((r) => r.attemptNumber === 2)).toBe(true);
    expect(model.sitting?.code).toBe("MAY2026");
    expect(model.sitting?.period).toBe("may");
  });
});

describe("integrity guard (reconciliation)", () => {
  it("every result reconciles on the clean fixture", () => {
    expect(model.integrity.ok).toBe(true);
    expect(model.integrity.reconciled).toBe(model.integrity.resultsChecked);
  });

  it("flags (does not throw on) a tampered, non-reconciling result", () => {
    const assessments = parseCsv(read("Assessments"));
    // Corrupt one graded result's stated total so it no longer matches its items.
    const graded = assessments.rows.find((r) => /^G12\+\+/.test(r.AssessmentName!))!;
    graded.ResultTotalScore = String(Number(graded.ResultTotalScore) + 5);
    const tampered = buildCanonicalModelFromTables(
      parseCsv(read("Items")),
      assessments,
      parseCsv(read("Topics")),
    );
    expect(tampered.integrity.ok).toBe(false);
    expect(tampered.integrity.issues.length).toBe(1);
    expect(tampered.integrity.issues[0]!.totalOk).toBe(false);
  });
});

describe("bridge to the engine path + report", () => {
  it("produces MCQ clean responses and a passing report with QM checks", () => {
    const { cleanedResponses, validationReport, canonical } = ingestThreeExports(files());
    expect(cleanedResponses.length).toBeGreaterThan(0);
    for (const r of cleanedResponses) expect(r.questionType).toBe("Multiple Choice");
    const ids = validationReport.checks.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["qm_reconciliation", "surveys_excluded", "sitting"]));
    expect(validationReport.passed).toBe(true);
    expect(canonical.subjects.length).toBe(5);
  });
});

describe("worked example — one participant across their subjects", () => {
  it("links a participant's results across subjects with trusted totals", () => {
    // Pick the participant with the most graded results.
    const byEmail = new Map<string, number>();
    for (const r of model.results) byEmail.set(r.participantEmail, (byEmail.get(r.participantEmail) ?? 0) + 1);
    const [email] = [...byEmail.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const theirs = model.results.filter((r) => r.participantEmail === email);
    expect(theirs.length).toBeGreaterThanOrEqual(2);
    const participant = model.participants.find((p) => p.email === email)!;
    expect(participant).toBeDefined();
    for (const r of theirs) {
      // QM total never exceeds QM max; topic rollups present.
      expect(r.totalScore).toBeLessThanOrEqual(r.maximumScore);
      expect(r.subject.startsWith("G12++")).toBe(true);
    }
  });
});
