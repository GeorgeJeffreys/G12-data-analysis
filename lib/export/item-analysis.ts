/**
 * Item Analysis workbook — reconciled to the exact layout of the real
 * `MCQ_Item_Analysis` file (Section 9).
 *
 * Workbook structure:
 *   - "README & Summary" sheet: title, purpose, then one row per assessment with
 *     counts, Good/Review/Flag tallies and median statistics.
 *   - one sheet per assessment: a title row, a meta row, a reading-guide row,
 *     two blank rows, the 20-column header on row 6, then one row per item.
 *
 * Rating columns carry green/amber/red fills per Good/Review/Flag.
 */

import {
  XLSX,
  RATING_STYLES,
  HEADER_STYLE,
  TITLE_STYLE,
  META_STYLE,
  GUIDE_STYLE,
  sanitizeSheetName,
  styleCell,
  median,
  roundOrNull,
} from "./sheet-utils";
import type {
  ItemAnalysisBlock,
  ItemAnalysisInput,
  ItemAnalysisRow,
} from "./types";

/** Canonical per-assessment header (exact column order from the template). */
export const ITEM_ANALYSIS_HEADERS = [
  "QuestionId",
  "QuestionWording",
  "QuestionMajorElement",
  "QuestionSubElement",
  "DemandLevel",
  "Participants Presented",
  "Participants Answered",
  "Avg Response Time (sec)",
  "P-Value",
  "P-Value Rating",
  "Item-Total Correlation",
  "Item-Total Rating",
  "Point-Biserial Correlation",
  "Point-Biserial Rating",
  "Item Discrimination",
  "Discrimination Rating",
  "Overall Item Review",
  "Notes",
  "Remove Item?",
  "Reason for removing item",
] as const;

/** Summary-sheet header (exact column order from the template). */
export const ITEM_ANALYSIS_SUMMARY_HEADERS = [
  "AssessmentName",
  "Participants",
  "Items",
  "Rows",
  "Upper/Lower Group Size",
  "Good Items",
  "Review Items",
  "Flag Items",
  "Median P-Value",
  "Median Item-Total",
  "Median Point-Biserial",
  "Median Discrimination",
] as const;

const READING_GUIDE =
  "Reading guide: Green = psychometrically strong/acceptable, amber = review, " +
  "red = flag for priority review.\nBecause sample size is small, use these " +
  "findings as evidence for expert review rather than automatic item removal.";

const SUMMARY_PURPOSE =
  "Purpose: item-level evidence to help review question quality before deciding " +
  "which MCQ items should contribute to the overall score.";

// 0-based indices of the columns that get rating fills.
const RATING_COLUMNS = [9, 11, 13, 15, 16];

interface RatingTally {
  good: number;
  review: number;
  flag: number;
}

function tallyRatings(rows: ItemAnalysisRow[]): RatingTally {
  const t: RatingTally = { good: 0, review: 0, flag: 0 };
  for (const r of rows) {
    switch (r.stat.overallReview) {
      case "Good":
        t.good += 1;
        break;
      case "Review":
        t.review += 1;
        break;
      case "Flag":
        t.flag += 1;
        break;
    }
  }
  return t;
}

function buildAssessmentSheet(block: ItemAnalysisBlock): XLSX.WorkSheet {
  const ncols = ITEM_ANALYSIS_HEADERS.length;

  const title = `${block.name} – Item-Level Psychometric Analysis`;
  const meta =
    `Participants: ${block.participants} | Items: ${block.rows.length} | ` +
    `Rows analysed: ${block.rowsAnalysed} | ` +
    `Upper/Lower group size for discrimination: ${block.groupSize} students`;

  const aoa: (string | number | null)[][] = [
    [title],
    [meta],
    [READING_GUIDE],
    [],
    [],
    [...ITEM_ANALYSIS_HEADERS],
  ];

  for (const r of block.rows) {
    const s = r.stat;
    aoa.push([
      s.itemId,
      s.wording ?? null,
      s.majorElement ?? null,
      s.subElement ?? null,
      s.demandLevel ?? null,
      r.participantsPresented,
      r.participantsAnswered,
      r.avgResponseTime,
      s.pValue,
      s.pRating,
      s.itemTotal,
      s.itRating,
      s.pointBiserial,
      s.pbRating,
      s.discrimination,
      s.discRating,
      s.overallReview,
      r.notes,
      r.exclude ? "Yes" : "No",
      r.removeReason,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Title / meta / guide styling, merged across the table width.
  styleCell(ws, 0, 0, TITLE_STYLE);
  styleCell(ws, 1, 0, META_STYLE);
  styleCell(ws, 2, 0, GUIDE_STYLE);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ncols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ncols - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: ncols - 1 } },
  ];

  // Header row (row index 5).
  const headerRow = 5;
  for (let c = 0; c < ncols; c++) styleCell(ws, headerRow, c, HEADER_STYLE);

  // Rating fills on each data row.
  block.rows.forEach((r, i) => {
    const rowIdx = headerRow + 1 + i;
    const ratings = [
      r.stat.pRating,
      r.stat.itRating,
      r.stat.pbRating,
      r.stat.discRating,
      r.stat.overallReview,
    ];
    RATING_COLUMNS.forEach((col, k) => {
      const style = RATING_STYLES[ratings[k] as string];
      if (style) styleCell(ws, rowIdx, col, style);
    });
  });

  ws["!rows"] = [{}, {}, { hpt: 42 }]; // give the guide row some height
  ws["!cols"] = [
    { wch: 14 }, // QuestionId
    { wch: 50 }, // Wording
    { wch: 26 }, // Major
    { wch: 26 }, // Sub
    { wch: 11 }, // Demand
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 9 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 24 }, // Notes
    { wch: 12 },
    { wch: 26 }, // Reason
  ];

  return ws;
}

function buildSummarySheet(input: ItemAnalysisInput): XLSX.WorkSheet {
  const ncols = ITEM_ANALYSIS_SUMMARY_HEADERS.length;
  const aoa: (string | number | null)[][] = [
    [`G12++ MCQ Psychometric Item Analysis – ${input.cycleName}`],
    [SUMMARY_PURPOSE],
    [],
    [...ITEM_ANALYSIS_SUMMARY_HEADERS],
  ];

  for (const block of input.blocks) {
    const tally = tallyRatings(block.rows);
    aoa.push([
      block.name,
      block.participants,
      block.rows.length,
      block.rowsAnalysed,
      block.groupSize,
      tally.good,
      tally.review,
      tally.flag,
      roundOrNull(median(block.rows.map((r) => r.stat.pValue)), 3),
      roundOrNull(median(block.rows.map((r) => r.stat.itemTotal)), 3),
      roundOrNull(median(block.rows.map((r) => r.stat.pointBiserial)), 3),
      roundOrNull(median(block.rows.map((r) => r.stat.discrimination)), 3),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleCell(ws, 0, 0, TITLE_STYLE);
  styleCell(ws, 1, 0, META_STYLE);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ncols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ncols - 1 } },
  ];
  const headerRow = 3;
  for (let c = 0; c < ncols; c++) styleCell(ws, headerRow, c, HEADER_STYLE);
  ws["!cols"] = [{ wch: 30 }, ...Array(ncols - 1).fill({ wch: 16 })];
  return ws;
}

export function buildItemAnalysisWorkbook(input: ItemAnalysisInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  // README & Summary first.
  XLSX.utils.book_append_sheet(
    wb,
    buildSummarySheet(input),
    sanitizeSheetName("README & Summary", used),
  );

  for (const block of input.blocks) {
    XLSX.utils.book_append_sheet(
      wb,
      buildAssessmentSheet(block),
      sanitizeSheetName(block.name, used),
    );
  }

  return wb;
}
