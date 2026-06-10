/**
 * Parse a Questionmark export (xlsx or csv) into raw rows. Uses SheetJS.
 */

import * as XLSX from "xlsx";
import type { IngestOptions, RawExportRow } from "./types";

export interface ParseResult {
  rows: RawExportRow[];
  sheetName: string;
}

type ParseInput = ArrayBuffer | Uint8Array | Buffer;

/**
 * Read the workbook/csv and return rows of the chosen sheet. For xlsx the
 * preferred sheet is `in` (the Questionmark "in" tab); if absent, the first
 * sheet is used. CSV files have a single sheet.
 */
export function parseExport(
  data: ParseInput,
  options: IngestOptions = {},
): ParseResult {
  const wb = XLSX.read(data, { type: "array", codepage: 65001 });
  const preferred = options.sheetName ?? "in";
  const sheetName =
    wb.SheetNames.find((n) => n === preferred) ?? wb.SheetNames[0];

  if (!sheetName) {
    return { rows: [], sheetName: "" };
  }

  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    return { rows: [], sheetName };
  }

  const rows = XLSX.utils.sheet_to_json<RawExportRow>(sheet, { defval: null });
  return { rows, sheetName };
}
