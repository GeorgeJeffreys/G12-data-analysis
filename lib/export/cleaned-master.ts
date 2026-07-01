/**
 * Cleaned master dataset workbook — a single sheet that matches the team's
 * cleaned export column-for-column, across every scored exam, reflecting the
 * current post-clean state (excluded rows omitted).
 *
 * The column set is NOT hard-coded here: the caller passes the headers straight
 * from the app's own cleaned-dataset definition (`CLEANED_DATA_COLUMNS`, surfaced
 * via `getCleanedMasterDataset`), so this stays the single source of truth and the
 * export can never drift from the on-screen cleaned view.
 */
import { XLSX } from "./sheet-utils";

/** The one sheet name used by the cleaned-master workbook. */
export const CLEANED_MASTER_SHEET = "Cleaned data";

/**
 * Build a one-sheet workbook from the cleaned-dataset headers + rows. Headers are
 * whatever the app's cleaned-dataset definition provides (43 columns today); rows
 * are aligned to them. Values are written as strings — the cleaned export is a
 * faithful text mirror, not a recomputation.
 */
export function buildCleanedMasterWorkbook(
  headers: readonly string[],
  rows: readonly string[][],
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const aoa: string[][] = [[...headers], ...rows.map((r) => [...r])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, CLEANED_MASTER_SHEET);
  return wb;
}
