/**
 * Diagnostics & reliability export. There is no prior reference workbook for the
 * Wave-4 reliability / Wave diagnostics data, so this follows the nearest
 * pattern in the suite: a titled, header-styled sheet per table (as in the
 * score- and item-analysis workbooks).
 *
 *  - "Reliability" sheet: Cronbach's α per construct group, with the item count
 *    (k) and complete-case participant count (n) alongside, as requested.
 *  - "Speededness" / "Timing" sheets: the per-assessment / per-element measures
 *    the Diagnostics screen shows (informational only — never grading).
 *
 * Export/formatting only — no engine or scoring change.
 */
import type { DiagnosticsModel, ReliabilityModel } from "@/lib/data/types";
import { XLSX, HEADER_STYLE, TITLE_STYLE } from "./sheet-utils";

export const DIAGNOSTICS_SHEETS = ["Reliability", "Speededness", "Timing"] as const;

export interface DiagnosticsExportInput {
  cycleName: string;
  reliability: ReliabilityModel | null;
  diagnostics: DiagnosticsModel | null;
}

const LEVEL_LABEL: Record<string, string> = {
  overall: "Overall exam",
  subject: "Subject",
  majorElement: "Major element",
  subElement: "Sub-element",
};

export const RELIABILITY_HEADERS = [
  "Level", "Group", "Subject", "Items (k)", "Participants (n)",
  "Cronbach's Alpha", "Low items?", "Small sample?", "Note",
] as const;

export const SPEEDEDNESS_HEADERS = [
  "Assessment", "Group", "Items", "Presentations", "Omission Rate", "Completion",
  "Speededness Index", "Early Omission", "Late Omission", "Early Accuracy", "Late Accuracy",
  "Omission", "Completion Status", "Speededness Status",
] as const;

export const TIMING_HEADERS = [
  "Assessment", "Group", "Students", "Pearson", "Pearson Strength", "Spearman", "Spearman Strength",
] as const;

function styleRow(ws: XLSX.WorkSheet, row: number, ncols: number, style: typeof HEADER_STYLE): void {
  for (let c = 0; c < ncols; c++) {
    const addr = XLSX.utils.encode_cell({ r: row, c });
    const cell = (ws[addr] ?? (ws[addr] = { t: "z" } as XLSX.CellObject)) as XLSX.CellObject;
    cell.s = { ...(cell.s as object | undefined), ...style };
  }
}

function reliabilitySheet(input: DiagnosticsExportInput): XLSX.WorkSheet {
  const aoa: unknown[][] = [];
  aoa.push([`Reliability (Cronbach's Alpha) — ${input.cycleName}`]);
  const r = input.reliability;
  aoa.push([
    r ? `Participants: ${r.participants} · Low-items threshold: ${r.lowItemsThreshold} · Small-sample threshold: ${r.smallSampleThreshold}` : "No reliability data.",
  ]);
  aoa.push([]);
  const headerRow = aoa.length;
  aoa.push([...RELIABILITY_HEADERS]);
  for (const row of r?.rows ?? []) {
    aoa.push([
      LEVEL_LABEL[row.level] ?? row.level,
      row.label,
      row.assessmentName ?? "",
      row.k,
      row.n,
      row.alpha ?? "n/a",
      row.lowItems ? "Yes" : "",
      row.smallSample ? "Yes" : "",
      row.note ?? "",
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleRow(ws, 0, 1, TITLE_STYLE);
  styleRow(ws, headerRow, RELIABILITY_HEADERS.length, HEADER_STYLE);
  return ws;
}

function speedednessSheet(input: DiagnosticsExportInput): XLSX.WorkSheet {
  const aoa: unknown[][] = [["Speededness & omission — informational only"], [], [...SPEEDEDNESS_HEADERS]];
  const headerRow = 2;
  for (const a of input.diagnostics?.assessments ?? []) {
    for (const g of a.groups) {
      const s = g.speeded;
      aoa.push([
        a.assessmentName, g.key, s.nItems, s.nPresentations, s.omissionRate, s.completion,
        s.speedednessIndex, s.earlyOmission, s.lateOmission, s.earlyAccuracy, s.lateAccuracy,
        s.omissionStatus, s.completionStatus, s.speededStatus,
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleRow(ws, 0, 1, TITLE_STYLE);
  styleRow(ws, headerRow, SPEEDEDNESS_HEADERS.length, HEADER_STYLE);
  return ws;
}

function timingSheet(input: DiagnosticsExportInput): XLSX.WorkSheet {
  const aoa: unknown[][] = [["Timing vs performance — informational only"], [], [...TIMING_HEADERS]];
  const headerRow = 2;
  for (const a of input.diagnostics?.assessments ?? []) {
    for (const g of a.groups) {
      const t = g.timing;
      aoa.push([a.assessmentName, g.key, t.nStudents, t.pearson ?? "n/a", t.pearsonStrength, t.spearman ?? "n/a", t.spearmanStrength]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleRow(ws, 0, 1, TITLE_STYLE);
  styleRow(ws, headerRow, TIMING_HEADERS.length, HEADER_STYLE);
  return ws;
}

export function buildDiagnosticsWorkbook(input: DiagnosticsExportInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, reliabilitySheet(input), DIAGNOSTICS_SHEETS[0]);
  XLSX.utils.book_append_sheet(wb, speedednessSheet(input), DIAGNOSTICS_SHEETS[1]);
  XLSX.utils.book_append_sheet(wb, timingSheet(input), DIAGNOSTICS_SHEETS[2]);
  return wb;
}
