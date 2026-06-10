/**
 * Helpers for building workbooks.
 *
 * Uses `xlsx-js-style` — a drop-in fork of SheetJS (same `XLSX.utils` API) that
 * additionally writes cell styles (fills/fonts/alignment). The community SheetJS
 * build silently drops styles on write, so it cannot produce the green/amber/red
 * rating fills the templates require. Reading/parsing on import still uses the
 * upstream `xlsx` package.
 */

import * as XLSX from "xlsx-js-style";

export { XLSX };

export type CellStyle = NonNullable<XLSX.CellObject["s"]>;

/** Conditional-format-style fills for the three quality ratings (Excel palette). */
export const RATING_STYLES: Record<string, CellStyle> = {
  Good: {
    fill: { patternType: "solid", fgColor: { rgb: "C6EFCE" } },
    font: { color: { rgb: "006100" } },
  },
  Review: {
    fill: { patternType: "solid", fgColor: { rgb: "FFEB9C" } },
    font: { color: { rgb: "9C6500" } },
  },
  Flag: {
    fill: { patternType: "solid", fgColor: { rgb: "FFC7CE" } },
    font: { color: { rgb: "9C0006" } },
  },
};

export const HEADER_STYLE: CellStyle = {
  font: { bold: true },
  fill: { patternType: "solid", fgColor: { rgb: "E7E6E6" } },
  alignment: { vertical: "center", wrapText: true },
};

export const TITLE_STYLE: CellStyle = {
  font: { bold: true, sz: 14 },
};

export const META_STYLE: CellStyle = {
  font: { italic: true, color: { rgb: "595959" } },
};

export const GUIDE_STYLE: CellStyle = {
  font: { color: { rgb: "595959" } },
  alignment: { wrapText: true, vertical: "top" },
};

/** Set a cell's style, creating the cell if necessary. */
export function styleCell(
  ws: XLSX.WorkSheet,
  row: number,
  col: number,
  style: CellStyle,
): void {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = (ws[addr] ?? (ws[addr] = { t: "z" } as XLSX.CellObject)) as XLSX.CellObject;
  cell.s = { ...(cell.s as CellStyle | undefined), ...style };
}

/**
 * Excel sheet names: max 31 chars, may not contain []:*?/\ and must be unique
 * within a workbook. Sanitise and de-duplicate.
 */
export function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = (name || "Sheet").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  if (base.length === 0) base = "Sheet";

  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Serialise a workbook to an xlsx Buffer (for download / upload to storage). */
export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Median of the numeric values, ignoring null/undefined. Null if none. */
export function median(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0
    ? (nums[mid - 1]! + nums[mid]!) / 2
    : nums[mid]!;
}

/** Round to n decimals, or pass null through. */
export function roundOrNull(value: number | null, decimals: number): number | null {
  if (value === null) return null;
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r;
}
