/**
 * Excel export module (Section 9). Generates the three workbooks that match the
 * current templates using SheetJS, and a helper to serialise to a Buffer.
 *
 * Note: the exact, pixel-level column order of the legacy templates should be
 * reconciled against the real `MCQ_Item_Analysis` / `MCQ_Overall_Score_Analysis`
 * files when they are available. The structure here is the canonical layout the
 * app standardises on — notably the single Remove/Reason pair (Section 9).
 */

export { buildItemAnalysisWorkbook, ITEM_ANALYSIS_HEADERS } from "./item-analysis";
export { buildScoreAnalysisWorkbook, SCORE_ANALYSIS_FIXED_HEADERS } from "./score-analysis";
export { buildGradesWorkbook, GRADES_FIXED_HEADERS } from "./grades";
export { workbookToBuffer, sanitizeSheetName } from "./sheet-utils";
export type * from "./types";
