/**
 * Excel export module (Section 9). Generates the three workbooks that match the
 * current templates and a helper to serialise to a Buffer.
 *
 * Generation uses `xlsx-js-style` (a drop-in SheetJS fork) so cell fills are
 * written — the item-analysis rating columns are colour-coded green/amber/red.
 * The item-analysis workbook is reconciled to the exact `MCQ_Item_Analysis`
 * layout: a "README & Summary" sheet plus one titled sheet per assessment with
 * the canonical 20-column header and a single Remove/Reason pair.
 */

export {
  buildItemAnalysisWorkbook,
  ITEM_ANALYSIS_HEADERS,
  ITEM_ANALYSIS_SUMMARY_HEADERS,
} from "./item-analysis";
export { assembleItemAnalysis } from "./assemble";
export {
  buildScoreAnalysisWorkbook,
  assembleScoreAnalysis,
  SCORE_ANALYSIS_SHEETS,
} from "./score-analysis";
export {
  buildGradesWorkbook,
  GRADES_STUDENT_HEADERS,
  GRADES_SHEETS,
  DEFAULT_SUBJECT_COLUMNS,
} from "./grades";
export {
  buildPerformanceReportWorkbook,
  PERFORMANCE_REPORT_SHEETS,
  STUDENT_SUMMARY_HEADERS,
} from "./performance-report";
export type {
  PerformanceReportInput,
  PRSubject,
  PRStudent,
  PRStudentSubject,
  PRSummarySubject,
} from "./performance-report";
export {
  buildAlterationsSheet,
  ALTERATION_HEADERS,
  ALTERATIONS_SHEET_NAME,
} from "./alterations";
export { workbookToBuffer, sanitizeSheetName, RATING_STYLES, PERFORMANCE_STYLES } from "./sheet-utils";
export type * from "./types";
