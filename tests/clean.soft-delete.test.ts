/**
 * 03b — Clean page rework: soft-delete, live cleaning impact, before/after Summary
 * statistics, and the cleaned master dataset export.
 *
 * Soft-delete writes through the prompt-09 `excludeParticipantFromCohort` mechanism
 * (keyed on the participant's stable id), so a removal:
 *   1. keeps the row VISIBLE + flagged (DataCleaningModel.excludedRows) — struck through,
 *   2. propagates to Scores/Grades (participant drops from the scored cohort),
 *   3. is reflected live in the cleaning-impact panel + Summary stats,
 *   4. omits the row from the cleaned master dataset export,
 *   5. is reversible.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { isSurveyAssessment, isScoredExamAssessment } from "@/lib/data/subject-catalog";
import { CLEANED_DATA_COLUMNS } from "@/lib/data/cleaned-schema";
import { buildCleanedMasterWorkbook, CLEANED_MASTER_SHEET } from "@/lib/export/cleaned-master";

function setup() {
  const p = new InMemoryDataProvider();
  const cycleId = p.listCycles()[0]!.id;
  const assessmentId = p.getCycle(cycleId)!.assessments[0]!.id;
  return { p, cycleId, assessmentId };
}

describe("soft-delete keeps rows visible + flags them (excludedRows)", () => {
  it("marks an excluded participant as struck-through but still shown", () => {
    const { p, cycleId, assessmentId } = setup();
    const before = p.getDataCleaning(cycleId, assessmentId)!;
    expect(before.excludedRows).toEqual([]);
    const victim = before.rows[0]!.id;

    p.excludeParticipantFromCohort(cycleId, victim, true, "Removed in cleaning");

    const after = p.getDataCleaning(cycleId, assessmentId)!;
    // Row is KEPT (not removed) but flagged as excluded.
    expect(after.rows.some((r) => r.id === victim)).toBe(true);
    expect(after.excludedRows).toContain(victim);
    // Reversible.
    p.excludeParticipantFromCohort(cycleId, victim, false);
    expect(p.getDataCleaning(cycleId, assessmentId)!.excludedRows).not.toContain(victim);
  });

  it("propagates to grades + the cohort count (prompt-09 mechanism)", () => {
    const { p, cycleId } = setup();
    const gradesBefore = p.getGrades(cycleId)!;
    const victim = gradesBefore.rows[0]!.id;
    const countBefore = p.getCycle(cycleId)!.participants;

    p.excludeParticipantFromCohort(cycleId, victim, true, "Removed in cleaning");

    expect(p.getGrades(cycleId)!.rows.some((r) => r.id === victim)).toBe(false);
    expect(p.getCycle(cycleId)!.participants).toBe(countBefore - 1);
  });
});

describe("getCleaningImpact — live before/after", () => {
  it("before = full ingested; after drops the excluded participant + records", () => {
    const { p, cycleId, assessmentId } = setup();
    const impact0 = p.getCleaningImpact(cycleId)!;
    expect(impact0.participants.before).toBe(impact0.participants.after);
    expect(impact0.records.before).toBe(impact0.records.after);
    expect(impact0.excludedRecords).toBe(0);
    expect(impact0.excludedParticipants).toBe(0);

    const victim = p.getDataCleaning(cycleId, assessmentId)!.rows[0]!.id;
    p.excludeParticipantFromCohort(cycleId, victim, true);

    const impact1 = p.getCleaningImpact(cycleId)!;
    expect(impact1.participants.before).toBe(impact0.participants.before); // full unchanged
    expect(impact1.participants.after).toBe(impact0.participants.after - 1);
    expect(impact1.records.after).toBeLessThan(impact1.records.before);
    expect(impact1.excludedParticipants).toBe(1);
    expect(impact1.excludedRecords).toBe(impact1.records.before - impact1.records.after);

    // Undo/restore returns to baseline (live recompute).
    p.excludeParticipantFromCohort(cycleId, victim, false);
    const impact2 = p.getCleaningImpact(cycleId)!;
    expect(impact2.participants.after).toBe(impact0.participants.after);
    expect(impact2.excludedRecords).toBe(0);
  });

  it("per-subject and per-element breakdowns cover only scored exams", () => {
    const { p, cycleId } = setup();
    const impact = p.getCleaningImpact(cycleId)!;
    const exams = p.getCycle(cycleId)!.assessments.filter((a) => isScoredExamAssessment(a.name));
    expect(impact.bySubject.length).toBe(exams.length);
    expect(impact.byElement.length).toBeGreaterThan(0);
    // Records total equals the sum of the per-subject records.
    const sum = impact.bySubject.reduce((n, s) => n + s.records.before, 0);
    expect(impact.records.before).toBe(sum);
  });
});

describe("getCleaningSummary — before/after distributions, exams only, engine denominator", () => {
  it("excludes surveys and shows per-subject before/after distributions", () => {
    const { p, cycleId } = setup();
    const summary = p.getCleaningSummary(cycleId)!;
    const exams = p.getCycle(cycleId)!.assessments.filter((a) => isScoredExamAssessment(a.name));
    expect(summary.subjects.length).toBe(exams.length);
    for (const s of summary.subjects) expect(isSurveyAssessment(s.name)).toBe(false);
    expect(summary.statusCounts.length).toBeGreaterThan(0);
    // Baseline: before == after when nothing is cleaned.
    for (const s of summary.subjects) expect(s.before.n).toBe(s.after.n);
  });

  it("recomputes the after-distribution when a participant is soft-deleted", () => {
    const { p, cycleId, assessmentId } = setup();
    const s0 = p.getCleaningSummary(cycleId)!.subjects.find((s) => s.assessmentId === assessmentId)!;
    const victim = p.getDataCleaning(cycleId, assessmentId)!.rows[0]!.id;

    p.excludeParticipantFromCohort(cycleId, victim, true);

    const s1 = p.getCleaningSummary(cycleId)!.subjects.find((s) => s.assessmentId === assessmentId)!;
    expect(s1.before.n).toBe(s0.before.n); // full ingested unchanged
    expect(s1.after.n).toBe(s0.after.n - 1); // cleaned cohort shrank
  });

  it("agrees with the engine's scored mean (not a naive raw-max average)", () => {
    const { p, cycleId, assessmentId } = setup();
    const s = p.getCleaningSummary(cycleId)!.subjects.find((x) => x.assessmentId === assessmentId)!;
    // The engine's per-subject cohort mean %, reused via getBoundaries.stats.mean.
    const boundaryMean = p.getBoundaries(cycleId, assessmentId)!.stats.mean;
    expect(Math.abs(s.after.mean - boundaryMean)).toBeLessThanOrEqual(0.6);
  });
});

describe("getCleanedMasterDataset + workbook — post-clean, single sheet, 43 cols", () => {
  it("is the canonical 43-column set across all scored exams", () => {
    const { p, cycleId } = setup();
    const ds = p.getCleanedMasterDataset(cycleId)!;
    expect(ds.headers).toEqual([...CLEANED_DATA_COLUMNS]);
    expect(ds.headers.length).toBe(43);
    const exams = p.getCycle(cycleId)!.assessments.filter((a) => isScoredExamAssessment(a.name));
    expect(ds.retained.subjects).toBe(exams.length);
    expect(ds.rows.length).toBe(ds.retained.responses);
    for (const r of ds.rows) expect(r.length).toBe(43);
  });

  it("omits struck-through (excluded) rows from the export", () => {
    const { p, cycleId, assessmentId } = setup();
    const before = p.getCleanedMasterDataset(cycleId)!;
    const victim = p.getDataCleaning(cycleId, assessmentId)!.rows[0]!;
    const pidIdx = CLEANED_DATA_COLUMNS.indexOf("ParticipantID" as never);
    const code = victim.studentId;
    expect(before.rows.some((r) => r[pidIdx] === code)).toBe(true);

    p.excludeParticipantFromCohort(cycleId, victim.id, true);

    const after = p.getCleanedMasterDataset(cycleId)!;
    expect(after.rows.length).toBeLessThan(before.rows.length);
    expect(after.rows.some((r) => r[pidIdx] === code)).toBe(false);
    expect(after.retained.participants).toBe(before.retained.participants - 1);
  });

  it("builds a single-sheet workbook from the app's own column definition", () => {
    const { p, cycleId } = setup();
    const ds = p.getCleanedMasterDataset(cycleId)!;
    const wb = buildCleanedMasterWorkbook(ds.headers, ds.rows);
    expect(wb.SheetNames).toEqual([CLEANED_MASTER_SHEET]);
    const ws = wb.Sheets[CLEANED_MASTER_SHEET]!;
    // Header row A1 is the first cleaned column.
    expect(ws["A1"]!.v).toBe(CLEANED_DATA_COLUMNS[0]);
  });
});

describe("isSurveyAssessment helper", () => {
  it("flags survey instruments and passes the five scored exams", () => {
    expect(isSurveyAssessment("User Experience Survey — May 2026")).toBe(true);
    expect(isSurveyAssessment("Survey-Applicable Maths")).toBe(true);
    expect(isSurveyAssessment("Applicable Maths")).toBe(false);
    expect(isSurveyAssessment("Arabic 1st Language")).toBe(false);
    expect(isScoredExamAssessment("Scientific Thinking")).toBe(true);
    expect(isScoredExamAssessment("User Experience Survey")).toBe(false);
  });
});
