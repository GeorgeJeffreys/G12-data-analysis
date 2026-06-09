/**
 * Helpers for building workbooks.
 */

import * as XLSX from "xlsx";

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
