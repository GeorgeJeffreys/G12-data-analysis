/**
 * Grade-boundaries / cut-scores export. No prior reference workbook exists, so
 * this follows the suite's titled-sheet pattern: a "Cut-scores" sheet (per
 * subject and the overall award, raw + %) and a "Band Distribution" sheet (the
 * resulting student counts per band). Export/formatting only — no engine change.
 */
import { XLSX, HEADER_STYLE, TITLE_STYLE } from "./sheet-utils";

export const BOUNDARIES_SHEETS = ["Cut-scores", "Band Distribution"] as const;
export const CUTSCORE_HEADERS = ["Scope", "Level", "Stars", "Min Score (%)", "Min Score (raw)"] as const;
export const BAND_DIST_HEADERS = ["Scope", "Level", "Students", "% of cohort"] as const;

export interface BoundaryBandExport {
  level: string;
  stars: string | null;
  /** Minimum score (%) for this band; null for the lowest (remainder) band. */
  cut: number | null;
  students: number;
  pct: number;
}

export interface BoundaryScopeExport {
  label: string;
  /** Subject total max (raw marks) — lets us show the raw cut alongside %. */
  maxRaw: number;
  isAward: boolean;
  bands: BoundaryBandExport[];
}

export interface BoundariesExportInput {
  cycleName: string;
  scopes: BoundaryScopeExport[];
}

function styleRow(ws: XLSX.WorkSheet, row: number, ncols: number, style: typeof HEADER_STYLE): void {
  for (let c = 0; c < ncols; c++) {
    const addr = XLSX.utils.encode_cell({ r: row, c });
    const cell = (ws[addr] ?? (ws[addr] = { t: "z" } as XLSX.CellObject)) as XLSX.CellObject;
    cell.s = { ...(cell.s as object | undefined), ...style };
  }
}

function rawCut(cut: number | null, maxRaw: number): number | string {
  return cut === null ? "—" : Math.round((cut / 100) * maxRaw);
}

export function buildBoundariesWorkbook(input: BoundariesExportInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const cutAoa: unknown[][] = [[`Cut-scores — ${input.cycleName}`], [], [...CUTSCORE_HEADERS]];
  for (const s of input.scopes) {
    for (const b of s.bands) {
      cutAoa.push([s.label, b.level, b.stars ?? "", b.cut ?? "—", rawCut(b.cut, s.maxRaw)]);
    }
  }
  const cutWs = XLSX.utils.aoa_to_sheet(cutAoa);
  styleRow(cutWs, 0, 1, TITLE_STYLE);
  styleRow(cutWs, 2, CUTSCORE_HEADERS.length, HEADER_STYLE);
  XLSX.utils.book_append_sheet(wb, cutWs, BOUNDARIES_SHEETS[0]);

  const distAoa: unknown[][] = [[`Band distribution — ${input.cycleName}`], [], [...BAND_DIST_HEADERS]];
  for (const s of input.scopes) {
    for (const b of s.bands) distAoa.push([s.label, b.level, b.students, b.pct]);
  }
  const distWs = XLSX.utils.aoa_to_sheet(distAoa);
  styleRow(distWs, 0, 1, TITLE_STYLE);
  styleRow(distWs, 2, BAND_DIST_HEADERS.length, HEADER_STYLE);
  XLSX.utils.book_append_sheet(wb, distWs, BOUNDARIES_SHEETS[1]);

  return wb;
}
