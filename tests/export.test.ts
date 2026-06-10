/**
 * Excel export tests: assert each workbook has the expected sheets, the exact
 * item-analysis layout (title / meta / guide / header / rows), the README &
 * Summary sheet, rating-column fills, and xlsx round-trip.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSXR from "xlsx"; // community reader (styles ignored on read — fine)
import {
  assembleItemAnalysis,
  buildItemAnalysisWorkbook,
  buildScoreAnalysisWorkbook,
  buildGradesWorkbook,
  workbookToBuffer,
  ITEM_ANALYSIS_HEADERS,
  ITEM_ANALYSIS_SUMMARY_HEADERS,
  RATING_STYLES,
} from "@/lib/export";
import type { ItemResponseFact } from "@/lib/export";
import { getEngine, responsesFromClean } from "@/lib/engine";
import type { ItemMeta, ItemStat, ResponseRecord } from "@/lib/engine";
import { parseExport, ingestAndClean } from "@/lib/ingest";
import { loadParityFixtures, sampleExportPath } from "./fixtures";

const engine = getEngine();
const fixtures = loadParityFixtures();
const ASSESSMENT = "Applicable Math";

function buildFromFixture() {
  const a = fixtures[ASSESSMENT]!;
  const responses: ResponseRecord[] = a.responses.map((r) => ({
    participantId: r.student,
    itemId: String(r.qid),
    assessmentId: ASSESSMENT,
    score: r.score,
  }));
  const items: ItemMeta[] = a.items.map((it) => ({
    itemId: String(it.qid),
    assessmentId: ASSESSMENT,
    wording: it.wording,
    majorElement: it.major,
    subElement: it.sub,
    demandLevel: it.demand,
  }));
  const stats = engine.computeItemStats({ responses, items });
  const facts: ItemResponseFact[] = a.responses.map((r) => ({
    assessmentId: ASSESSMENT,
    itemId: String(r.qid),
    participantId: r.student,
    answered: true,
    responseTime: null,
  }));
  const participants = [...new Set(responses.map((r) => r.participantId))].map((id) => ({
    id,
    label: id,
  }));
  return { responses, items, stats, facts, participants };
}

function aoaOf(wb: XLSXR.WorkBook, sheet: string): unknown[][] {
  const ws = wb.Sheets[sheet]!;
  return XLSXR.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true });
}

describe("item analysis workbook — exact layout", () => {
  const { stats, facts } = buildFromFixture();
  const input = assembleItemAnalysis({
    cycleName: "May 2026",
    assessments: [{ id: ASSESSMENT, name: ASSESSMENT }],
    stats,
    facts,
    reviews: {
      [stats[0]!.itemId]: {
        exclude: true,
        reason: "Negative discrimination",
        notes: "SME flagged wording",
      },
    },
  });
  const wb = buildItemAnalysisWorkbook(input);

  it("has a README & Summary sheet first, then one sheet per assessment", () => {
    expect(wb.SheetNames).toEqual(["README & Summary", "Applicable Math"]);
  });

  it("lays out the assessment sheet exactly (title / meta / guide / header)", () => {
    const aoa = aoaOf(wb as unknown as XLSXR.WorkBook, "Applicable Math");
    expect(aoa[0]![0]).toBe("Applicable Math – Item-Level Psychometric Analysis");
    const meta = String(aoa[1]![0]);
    expect(meta).toContain("Participants: 15");
    expect(meta).toContain("Items: 40");
    expect(meta).toContain("Rows analysed: 600");
    expect(meta).toContain("Upper/Lower group size for discrimination: 5 students");
    expect(String(aoa[2]![0])).toContain("Reading guide:");
    // rows 4 and 5 (index 3,4) are blank
    expect(aoa[3] ?? []).toEqual([]);
    expect(aoa[4] ?? []).toEqual([]);
    // header on row 6 (index 5)
    expect(aoa[5]).toEqual([...ITEM_ANALYSIS_HEADERS]);
  });

  it("has 20 columns with a single Remove/Reason pair", () => {
    expect(ITEM_ANALYSIS_HEADERS).toHaveLength(20);
    expect(ITEM_ANALYSIS_HEADERS.filter((h) => h === "Remove Item?")).toHaveLength(1);
    expect(
      ITEM_ANALYSIS_HEADERS.filter((h) => h === "Reason for removing item"),
    ).toHaveLength(1);
  });

  it("writes one row per item starting at row 7, with the exclusion decision", () => {
    const aoa = aoaOf(wb as unknown as XLSXR.WorkBook, "Applicable Math");
    const dataRows = aoa.slice(6).filter((r) => r.length > 0);
    expect(dataRows).toHaveLength(stats.length);
    const first = dataRows[0]!;
    expect(String(first[0])).toBe(stats[0]!.itemId); // QuestionId
    expect(first[17]).toBe("SME flagged wording"); // Notes
    expect(first[18]).toBe("Yes"); // Remove Item?
    expect(first[19]).toBe("Negative discrimination"); // Reason
  });

  it("applies green/amber/red fills to the rating columns", () => {
    const ws = wb.Sheets["Applicable Math"]!;
    const first = stats[0]!;
    // Row 7 = sheet row index 6. P-Value Rating is column 9, Overall is 16.
    const pCell = ws[XLSXR.utils.encode_cell({ r: 6, c: 9 })] as { s?: { fill?: { fgColor?: { rgb?: string } } } };
    const oCell = ws[XLSXR.utils.encode_cell({ r: 6, c: 16 })] as { s?: { fill?: { fgColor?: { rgb?: string } } } };
    expect(pCell.s?.fill?.fgColor?.rgb).toBe(
      (RATING_STYLES[first.pRating]!.fill as { fgColor: { rgb: string } }).fgColor.rgb,
    );
    expect(oCell.s?.fill?.fgColor?.rgb).toBe(
      (RATING_STYLES[first.overallReview]!.fill as { fgColor: { rgb: string } }).fgColor.rgb,
    );
  });

  it("builds the README & Summary sheet", () => {
    const aoa = aoaOf(wb as unknown as XLSXR.WorkBook, "README & Summary");
    expect(String(aoa[0]![0])).toBe("G12++ MCQ Psychometric Item Analysis – May 2026");
    expect(String(aoa[1]![0])).toContain("Purpose:");
    expect(aoa[3]).toEqual([...ITEM_ANALYSIS_SUMMARY_HEADERS]);
    const row = aoa[4]!;
    expect(row[0]).toBe("Applicable Math");
    expect(row[1]).toBe(15); // Participants
    expect(row[2]).toBe(40); // Items
    expect(row[3]).toBe(600); // Rows
    expect(row[4]).toBe(5); // group size
    // Good + Review + Flag counts sum to item count.
    expect(Number(row[5]) + Number(row[6]) + Number(row[7])).toBe(40);
  });

  it("round-trips through a buffer", () => {
    const buf = workbookToBuffer(wb);
    expect(buf.length).toBeGreaterThan(0);
    const reread = XLSXR.read(buf, { type: "buffer" });
    expect(reread.SheetNames).toEqual(["README & Summary", "Applicable Math"]);
  });
});

describe("item analysis — average response time from real responses", () => {
  it("computes a positive average response time from the sample export", () => {
    const file = readFileSync(sampleExportPath());
    const { rows } = parseExport(file);
    const { cleanedResponses } = ingestAndClean(rows);

    const responses = responsesFromClean(cleanedResponses);
    // distinct item metadata
    const itemMap = new Map<string, ItemMeta>();
    for (const r of cleanedResponses) {
      if (!itemMap.has(r.qmQuestionId)) {
        itemMap.set(r.qmQuestionId, {
          itemId: r.qmQuestionId,
          assessmentId: r.assessmentName,
          wording: r.wording,
          majorElement: r.majorElement,
          subElement: r.subElement,
          demandLevel: r.demandLevel ?? null,
        });
      }
    }
    const stats: ItemStat[] = engine.computeItemStats({
      responses,
      items: [...itemMap.values()],
    });
    const facts: ItemResponseFact[] = cleanedResponses.map((r) => ({
      assessmentId: r.assessmentName,
      itemId: r.qmQuestionId,
      participantId: r.participantPseudonym,
      answered: !!r.answerGiven,
      responseTime: r.responseTime,
    }));
    const assessments = [...new Set(cleanedResponses.map((r) => r.assessmentName))].map(
      (name) => ({ id: name, name }),
    );

    const input = assembleItemAnalysis({
      cycleName: "Feb 2026",
      assessments,
      stats,
      facts,
    });

    const withTimes = input.blocks
      .flatMap((b) => b.rows)
      .filter((r) => r.avgResponseTime !== null);
    expect(withTimes.length).toBeGreaterThan(0);
    for (const r of withTimes) expect(r.avgResponseTime!).toBeGreaterThan(0);

    // Presented/answered are populated and consistent.
    for (const block of input.blocks) {
      for (const r of block.rows) {
        expect(r.participantsPresented).toBeGreaterThan(0);
        expect(r.participantsAnswered).toBeLessThanOrEqual(r.participantsPresented);
      }
    }
  });
});

describe("score analysis workbook", () => {
  const { participants } = buildFromFixture();
  const a = fixtures[ASSESSMENT]!;
  const responses: ResponseRecord[] = a.responses.map((r) => ({
    participantId: r.student,
    itemId: String(r.qid),
    assessmentId: ASSESSMENT,
    score: r.score,
  }));
  const scores = engine.computeScores(responses, []);
  const items: ItemMeta[] = a.items.map((it) => ({
    itemId: String(it.qid),
    assessmentId: ASSESSMENT,
    majorElement: it.major,
    demandLevel: it.demand,
  }));
  const rollUp = engine.rollUp({ participantScores: scores, responses, items });
  const wb = buildScoreAnalysisWorkbook({
    assessments: [{ id: ASSESSMENT, name: ASSESSMENT }],
    participants,
    scores,
    rollUp,
  });

  it("has Scores and Summary sheets", () => {
    expect(wb.SheetNames).toEqual(["Scores", "Summary"]);
  });

  it("has a Raw and % column per assessment plus overall", () => {
    const header = aoaOf(wb as unknown as XLSXR.WorkBook, "Scores")[0]!;
    expect(header[0]).toBe("Participant");
    expect(header).toContain("Applicable Math Raw");
    expect(header).toContain("Applicable Math %");
    expect(header).toContain("Overall Raw");
    expect(header).toContain("Overall %");
  });
});

describe("grades workbook", () => {
  const { participants } = buildFromFixture();
  const grades = participants.map((p, i) => ({
    participantId: p.id,
    scope: "overall",
    gradeLabel: i % 2 === 0 ? "Pass" : "Merit",
    score: 70 + i,
  }));
  const wb = buildGradesWorkbook({
    assessments: [{ id: ASSESSMENT, name: ASSESSMENT }],
    participants,
    grades,
  });

  it("has Grades and Distribution sheets", () => {
    expect(wb.SheetNames).toEqual(["Grades", "Distribution"]);
  });

  it("has a grade column per assessment plus overall", () => {
    const header = aoaOf(wb as unknown as XLSXR.WorkBook, "Grades")[0]!;
    expect(header).toEqual([
      "Participant",
      "Applicable Math Grade",
      "Overall Grade",
      "Overall Score",
    ]);
  });
});
