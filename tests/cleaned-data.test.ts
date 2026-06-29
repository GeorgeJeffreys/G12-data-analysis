/**
 * Clean step — cleaned-data view in the Questionmark cleaned-export column layout.
 * The on-screen table mirrors the team's Excel spreadsheet column-for-column, is a
 * read-only view of the cleaned set (raw untouched), honours Clean-stage removals,
 * and never surfaces PII the de-identified pipeline does not hold.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { CLEANED_DATA_COLUMNS, CLEANED_DATA_PII } from "@/lib/data/cleaned-schema";

const CYCLE = "may-2026";

describe("getCleanedData — cleaned-export mirror", () => {
  const provider = new InMemoryDataProvider();
  const cycle = provider.getCycle(CYCLE)!;
  const assessmentId = cycle.assessments[0]!.id;
  const model = provider.getCleanedData(CYCLE, assessmentId)!;

  const col = (name: string) => CLEANED_DATA_COLUMNS.indexOf(name as never);

  it("presents the exact QM cleaned columns, in order", () => {
    expect(model.headers).toEqual([...CLEANED_DATA_COLUMNS]);
    expect(model.headers.length).toBe(43);
  });

  it("emits one well-formed row per retained response", () => {
    expect(model.rows.length).toBeGreaterThan(0);
    expect(model.rows.length).toBe(model.retained.responses);
    for (const row of model.rows) expect(row.length).toBe(model.headers.length);
  });

  it("fills the columns the de-identified pipeline holds", () => {
    const r = model.rows[0]!;
    expect(r[col("AssessmentName")]).toBe(cycle.assessments[0]!.name);
    expect(r[col("QuestionType")]).toBe("Multiple Choice");
    // AnswerScore / QuestionMaximumScore are numeric strings
    expect(r[col("AnswerScore")]).toMatch(/^\d+(\.\d+)?$/);
    expect(Number(r[col("QuestionMaximumScore")])).toBeGreaterThanOrEqual(1);
    // QuestionId / ParticipantID are present
    expect(r[col("QuestionId")]).toBeTruthy();
    expect(r[col("ParticipantID")]).toBeTruthy();
  });

  it("keeps every PII column blank in every row (GDPR)", () => {
    for (const pii of CLEANED_DATA_PII) {
      const i = col(pii);
      for (const row of model.rows) expect(row[i]).toBe("");
    }
    // PII headers are still present (layout mirrors the spreadsheet)
    for (const pii of CLEANED_DATA_PII) expect(model.headers).toContain(pii);
  });

  it("honours Clean-stage removals (raw untouched)", () => {
    const fresh = new InMemoryDataProvider();
    const before = fresh.getCleanedData(CYCLE, assessmentId)!;
    const victim = before.rows[0]![CLEANED_DATA_COLUMNS.indexOf("ResultId" as never)]!;
    fresh.setCleanRemoval(CYCLE, assessmentId, { rows: [victim] }, true);
    const after = fresh.getCleanedData(CYCLE, assessmentId)!;
    expect(after.retained.participants).toBe(before.retained.participants - 1);
    const ri = CLEANED_DATA_COLUMNS.indexOf("ResultId" as never);
    expect(after.rows.some((r) => r[ri] === victim)).toBe(false);
    // raw matrix is untouched — getRawData still shows the full cohort
    expect(fresh.getRawData(CYCLE, assessmentId)!.rows.length).toBe(before.retained.participants);
  });
});
