/**
 * Excel export tests: assert each workbook has the expected sheets and header
 * structure, and round-trips through SheetJS.
 */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildItemAnalysisWorkbook,
  buildScoreAnalysisWorkbook,
  buildGradesWorkbook,
  workbookToBuffer,
  ITEM_ANALYSIS_HEADERS,
} from "@/lib/export";
import { getEngine } from "@/lib/engine";
import type { ItemMeta, ResponseRecord } from "@/lib/engine";
import { loadParityFixtures } from "./fixtures";

const engine = getEngine();
const fixtures = loadParityFixtures();
const ASSESSMENT = "Applicable Math";

function build() {
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
  const scores = engine.computeScores(responses, []);
  const rollUp = engine.rollUp({ participantScores: scores, responses, items });
  const participants = [...new Set(responses.map((r) => r.participantId))].map((id) => ({
    id,
    label: id,
  }));
  return { responses, items, stats, scores, rollUp, participants };
}

function headerOf(wb: XLSX.WorkBook, sheet: string): unknown[] {
  const ws = wb.Sheets[sheet]!;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
  return aoa[0] ?? [];
}

describe("item analysis workbook", () => {
  const { stats } = build();
  const wb = buildItemAnalysisWorkbook({
    assessments: [{ id: ASSESSMENT, name: ASSESSMENT }],
    stats,
    reviews: { [stats[0]!.itemId]: { exclude: true, reason: "Negative discrimination" } },
  });

  it("has one sheet per assessment", () => {
    expect(wb.SheetNames).toEqual(["Applicable Math"]);
  });

  it("uses the canonical headers incl. a single Remove/Reason pair", () => {
    const header = headerOf(wb, "Applicable Math");
    expect(header).toEqual([...ITEM_ANALYSIS_HEADERS]);
    expect(header.filter((h) => h === "Remove?")).toHaveLength(1);
    expect(header.filter((h) => h === "Reason")).toHaveLength(1);
  });

  it("writes a data row per item with the exclusion decision", () => {
    const ws = wb.Sheets["Applicable Math"]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    expect(rows.length).toBe(stats.length);
    const excluded = rows.find((r) => r["QID"] === stats[0]!.itemId);
    expect(excluded!["Remove?"]).toBe("Yes");
    expect(excluded!["Reason"]).toBe("Negative discrimination");
  });

  it("round-trips through a buffer", () => {
    const buf = workbookToBuffer(wb);
    expect(buf.length).toBeGreaterThan(0);
    const reread = XLSX.read(buf, { type: "buffer" });
    expect(reread.SheetNames).toEqual(["Applicable Math"]);
  });
});

describe("score analysis workbook", () => {
  const { scores, rollUp, participants } = build();
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
    const header = headerOf(wb, "Scores");
    expect(header[0]).toBe("Participant");
    expect(header).toContain("Applicable Math Raw");
    expect(header).toContain("Applicable Math %");
    expect(header).toContain("Overall Raw");
    expect(header).toContain("Overall %");
  });

  it("has one data row per participant", () => {
    const ws = wb.Sheets["Scores"]!;
    const rows = XLSX.utils.sheet_to_json(ws);
    expect(rows.length).toBe(participants.length);
  });
});

describe("grades workbook", () => {
  const { participants } = build();
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
    const header = headerOf(wb, "Grades");
    expect(header).toEqual(["Participant", "Applicable Math Grade", "Overall Grade", "Overall Score"]);
  });

  it("summarises the overall grade distribution", () => {
    const ws = wb.Sheets["Distribution"]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    const labels = rows.map((r) => r["Grade"]);
    expect(labels).toContain("Pass");
    expect(labels).toContain("Merit");
  });
});
