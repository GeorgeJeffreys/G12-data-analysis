/**
 * Item Analysis workbook (mirrors the current `MCQ_Item_Analysis` template):
 * one sheet per assessment, the four statistics with their ratings, and a
 * SINGLE canonical Remove/Reason pair — ending the historical column-naming
 * drift ("Remove Item?", "Remove?", "Column1" …). See Section 9.
 */

import * as XLSX from "xlsx";
import type { ItemAnalysisInput } from "./types";
import { sanitizeSheetName } from "./sheet-utils";

/** Canonical item-analysis column order. The Remove/Reason pair is singular. */
export const ITEM_ANALYSIS_HEADERS = [
  "QID",
  "Question",
  "Major Element",
  "Sub Element",
  "Demand Level",
  "N",
  "p-value",
  "p Rating",
  "Item-Total",
  "Item-Total Rating",
  "Point-Biserial",
  "PB Rating",
  "Discrimination",
  "Disc Rating",
  "Overall Review",
  "Remove?",
  "Reason",
] as const;

export function buildItemAnalysisWorkbook(input: ItemAnalysisInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const statsByAssessment = new Map<string, typeof input.stats>();
  for (const s of input.stats) {
    const bucket = statsByAssessment.get(s.assessmentId) ?? [];
    bucket.push(s);
    statsByAssessment.set(s.assessmentId, bucket);
  }

  for (const assessment of input.assessments) {
    const stats = statsByAssessment.get(assessment.id) ?? [];
    const rows: (string | number | null)[][] = [ [...ITEM_ANALYSIS_HEADERS] ];

    for (const s of stats) {
      const review = input.reviews?.[s.itemId];
      rows.push([
        s.itemId,
        s.wording ?? null,
        s.majorElement ?? null,
        s.subElement ?? null,
        s.demandLevel ?? null,
        s.n,
        s.pValue,
        s.pRating,
        s.itemTotal,
        s.itRating,
        s.pointBiserial,
        s.pbRating,
        s.discrimination,
        s.discRating,
        s.overallReview,
        review?.exclude ? "Yes" : "No",
        review?.reason ?? null,
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const name = sanitizeSheetName(assessment.name, usedNames);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  // SheetJS requires at least one sheet.
  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[...ITEM_ANALYSIS_HEADERS]]),
      "Item Analysis",
    );
  }

  return wb;
}
