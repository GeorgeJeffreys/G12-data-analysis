/**
 * Students' Performance Report workbook — reworked to match the original
 * `Students_Performance_Report` file. Three matched sheets, then the
 * clearly-additional Alterations and Audit Trail sheets appended after them:
 *
 *  1. `Class Performance` — per assessment × major-element, the proportion of
 *     students at each performance level, then the overall award-level
 *     distribution.
 *  2. `Student Summary` — one row per student: award level + the five canonical
 *     subject performance levels (mapped by subject alias), with a Legend block.
 *  3. `Student Profiles` — a repeating per-student block: award, then each
 *     subject's overall level and a bulleted major-element breakdown.
 *
 * Performance-level cells carry the same semantic fills as the item-analysis
 * ratings (Outstanding → green … Doesn't-yet-meet → red), keyed by the level's
 * index in the configured set — so nothing hardcodes the level names.
 *
 * DOWNSTREAM: the level fills come from PERFORMANCE_STYLES, a fixed 4-colour
 * palette indexed by performance-level position; a configured set with >4 levels
 * renders the extra band(s) without a fill until the palette is extended.
 */

import {
  XLSX,
  HEADER_STYLE,
  TITLE_STYLE,
  PERFORMANCE_STYLES,
  styleCell,
  sanitizeSheetName,
} from "./sheet-utils";
import { buildAlterationsSheet, ALTERATIONS_SHEET_NAME } from "./alterations";
import type { GradeAuditEntry, AlterationRecord } from "./types";

export const PERFORMANCE_REPORT_SHEETS = [
  "Class Performance",
  "Student Summary",
  "Student Profiles",
] as const;

export const STUDENT_SUMMARY_HEADERS = [
  "Student Name",
  "Award Level",
  "Applicable Maths",
  "Scientific Thinking",
  "Arabic 1st Language",
  "English 2nd Language",
  "Life Success Skills",
  "Open Profile",
] as const;

/** One assessment/subject with its ordered major elements. */
export interface PRSubject {
  assessmentId: string;
  name: string;
  majorElements: string[];
  /** Major element → its ordered sub-elements (construct structure, from data). */
  subElements?: Record<string, string[]>;
}

/** A student's result on one subject: overall level + per-element + per-sub-element levels. */
export interface PRStudentSubject {
  level: string;
  elements: Record<string, string>;
  /** Major element → (sub-element → level). Finer-grained breakdown. */
  subElements?: Record<string, Record<string, string>>;
}

export interface PRStudent {
  participantId: string;
  name: string;
  award: string;
  /** Keyed by assessmentId. */
  subjects: Record<string, PRStudentSubject>;
}

/** A canonical Student-Summary column mapped to a suite assessment by alias. */
export interface PRSummarySubject {
  label: string;
  assessmentId: string | null;
}

export interface PerformanceReportInput {
  cycleName: string;
  /** Performance levels, best → lowest. */
  performanceLevels: string[];
  /** Award levels, best → lowest. */
  awardLevels: string[];
  /** Assessments with their major elements (Class Performance + Profiles). */
  subjects: PRSubject[];
  /** The five canonical Student-Summary columns (by alias). */
  summarySubjects: PRSummarySubject[];
  students: PRStudent[];
  awardDistribution: { level: string; count: number; pct: number }[];
  alterations: AlterationRecord[];
  audit: GradeAuditEntry[];
}

const AUDIT_HEADER = ["Timestamp", "Actor", "Action", "Detail", "Entity", "EntityId"];

function levelIndex(levels: string[], label: string): number {
  return levels.indexOf(label);
}

/** Proportion (0–100, 1 dp) of `values` equal to `target`, over defined entries. */
function proportionAt(values: (string | undefined)[], target: string): number {
  const defined = values.filter((v) => v != null && v !== "");
  if (defined.length === 0) return 0;
  const n = defined.filter((v) => v === target).length;
  return Math.round((n / defined.length) * 1000) / 10;
}

function buildClassPerformanceSheet(input: PerformanceReportInput): XLSX.WorkSheet {
  const levels = input.performanceLevels;
  // Column plan: col 0 = labels; then per subject a block of [overall, ...elements].
  type Col = { kind: "overall" | "element"; assessmentId: string; element?: string };
  const cols: Col[] = [];
  const blocks: { name: string; start: number; span: number }[] = [];
  for (const s of input.subjects) {
    const start = cols.length + 1; // +1 for the label column
    cols.push({ kind: "overall", assessmentId: s.assessmentId });
    for (const el of s.majorElements) cols.push({ kind: "element", assessmentId: s.assessmentId, element: el });
    blocks.push({ name: s.name, start, span: 1 + s.majorElements.length });
  }
  const width = 1 + cols.length;

  const valueFor = (col: Col, level: string): number => {
    const vals = input.students
      .map((st) => {
        const subj = st.subjects[col.assessmentId];
        if (!subj) return undefined;
        return col.kind === "overall" ? subj.level : subj.elements[col.element!];
      });
    return proportionAt(vals, level);
  };

  const aoa: (string | number | null)[][] = [];
  aoa[0] = ["Class Performance Report"];
  aoa[1] = [];
  // r3 (index 2): group headers per assessment (merged across its block)
  const groupRow: (string | number | null)[] = new Array(width).fill(null);
  for (const b of blocks) groupRow[b.start] = b.name;
  aoa[2] = groupRow;
  // r4 (index 3): header — "% Performance", then per block: assessment name + elements
  const headerRow: (string | number | null)[] = ["% Performance"];
  for (const s of input.subjects) {
    headerRow.push(s.name);
    for (const el of s.majorElements) headerRow.push(el);
  }
  aoa[3] = headerRow;
  // r5.. : one row per performance level
  levels.forEach((lvl, i) => {
    const row: (string | number | null)[] = [lvl];
    for (const col of cols) row.push(valueFor(col, lvl));
    aoa[4 + i] = row;
  });

  // Award Level Distribution block (two rows below the last level row)
  const awardTitleRow = 4 + levels.length + 1;
  aoa[awardTitleRow] = ["Award Level Distribution"];
  aoa[awardTitleRow + 1] = ["Award Level", "Number of Students", "% of Class"];
  input.awardDistribution.forEach((d, i) => {
    aoa[awardTitleRow + 2 + i] = [d.level, d.count, d.pct];
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleCell(ws, 0, 0, TITLE_STYLE);
  // group-header merges + style
  const merges: XLSX.Range[] = [];
  for (const b of blocks) {
    if (b.span > 1) merges.push({ s: { r: 2, c: b.start }, e: { r: 2, c: b.start + b.span - 1 } });
    styleCell(ws, 2, b.start, HEADER_STYLE);
  }
  ws["!merges"] = merges;
  for (let c = 0; c < width; c++) styleCell(ws, 3, c, HEADER_STYLE);
  // performance-level fills on the label column
  levels.forEach((lvl, i) => {
    const style = PERFORMANCE_STYLES[levelIndex(levels, lvl)];
    if (style) styleCell(ws, 4 + i, 0, style);
  });
  styleCell(ws, awardTitleRow, 0, TITLE_STYLE);
  for (let c = 0; c < 3; c++) styleCell(ws, awardTitleRow + 1, c, HEADER_STYLE);

  ws["!cols"] = [{ wch: 26 }, ...cols.map(() => ({ wch: 16 }))];
  return ws;
}

function buildStudentSummarySheet(input: PerformanceReportInput): XLSX.WorkSheet {
  const levels = input.performanceLevels;
  const aoa: (string | number | null)[][] = [];
  aoa[0] = [`Students' Performance Report — ${input.cycleName}`];
  aoa[1] = [];
  aoa[2] = [...STUDENT_SUMMARY_HEADERS];
  input.students.forEach((st, i) => {
    const row: (string | number | null)[] = [st.name, st.award];
    for (const subj of input.summarySubjects) {
      row.push(subj.assessmentId ? st.subjects[subj.assessmentId]?.level ?? "" : "");
    }
    row.push("Open profile");
    aoa[3 + i] = row;
  });

  // Legend block in a right-hand column (col J = index 9): award levels, then
  // performance levels.
  const LEG = 9;
  const legend: string[] = ["Legend", "Award levels", ...input.awardLevels, "", "Performance levels", ...levels];
  legend.forEach((text, row) => {
    if (!text) return;
    const r = (aoa[row] = aoa[row] ?? []);
    r[LEG] = text;
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleCell(ws, 0, 0, TITLE_STYLE);
  for (let c = 0; c < STUDENT_SUMMARY_HEADERS.length; c++) styleCell(ws, 2, c, HEADER_STYLE);
  styleCell(ws, 0, LEG, HEADER_STYLE);
  // fills: subject performance-level cells (columns 2..6)
  input.students.forEach((st, i) => {
    input.summarySubjects.forEach((subj, sIdx) => {
      const lvl = subj.assessmentId ? st.subjects[subj.assessmentId]?.level : undefined;
      if (!lvl) return;
      const style = PERFORMANCE_STYLES[levelIndex(levels, lvl)];
      if (style) styleCell(ws, 3 + i, 2 + sIdx, style);
    });
  });
  ws["!cols"] = [
    { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 2 }, { wch: 22 },
  ];
  return ws;
}

function buildStudentProfilesSheet(input: PerformanceReportInput): XLSX.WorkSheet {
  const levels = input.performanceLevels;
  const aoa: (string | number | null)[][] = [];
  const fills: { r: number; c: number; lvl: string }[] = [];
  let r = 0;
  for (const st of input.students) {
    aoa[r] = [st.name, null, "Back"];
    r += 1;
    aoa[r] = ["Award Level", st.award];
    r += 1;
    aoa[r] = ["Subject", "Subject Performance", "Major Elements Performance", "Sub-Elements Performance"];
    const headerRow = r;
    r += 1;
    for (const subj of input.summarySubjects) {
      const result = subj.assessmentId ? st.subjects[subj.assessmentId] : undefined;
      const level = result?.level ?? "—";
      const bullets = result
        ? Object.entries(result.elements).map(([el, lvl]) => `• ${el}: ${lvl}`).join("\n") || "—"
        : "—";
      // Sub-element breakdown: each major element, then its sub-elements indented.
      const subBullets = result?.subElements
        ? Object.entries(result.subElements)
            .map(([el, subs]) => {
              const lines = Object.entries(subs).map(([s, lvl]) => `   – ${s}: ${lvl}`);
              return lines.length ? `• ${el}\n${lines.join("\n")}` : null;
            })
            .filter((x): x is string => x !== null)
            .join("\n") || "—"
        : "—";
      aoa[r] = [subj.label, level, bullets, subBullets];
      if (result?.level) fills.push({ r, c: 1, lvl: result.level });
      r += 1;
    }
    void headerRow;
    aoa[r] = []; // blank separator
    r += 1;
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // style each block's header rows
  let rr = 0;
  for (const st of input.students) {
    styleCell(ws, rr, 0, TITLE_STYLE); // student name
    styleCell(ws, rr + 1, 0, HEADER_STYLE); // "Award Level"
    for (let c = 0; c < 4; c++) styleCell(ws, rr + 2, c, HEADER_STYLE); // subject header
    rr += 3 + input.summarySubjects.length + 1;
    void st;
  }
  for (const f of fills) {
    const style = PERFORMANCE_STYLES[levelIndex(levels, f.lvl)];
    if (style) styleCell(ws, f.r, f.c, style);
    for (const c of [2, 3]) {
      const addr = XLSX.utils.encode_cell({ r: f.r, c });
      const cell = ws[addr] as XLSX.CellObject | undefined;
      if (cell) cell.s = { ...(cell.s as object), alignment: { wrapText: true, vertical: "top" } };
    }
  }
  ws["!cols"] = [{ wch: 24 }, { wch: 26 }, { wch: 52 }, { wch: 58 }];
  return ws;
}

function buildAuditTrailSheet(input: PerformanceReportInput): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [];
  aoa[0] = [`Audit Trail — ${input.cycleName}`];
  aoa[2] = [...AUDIT_HEADER];
  input.audit.forEach((e, i) => {
    aoa[3 + i] = [e.timestamp, e.actor, e.action, e.detail, e.entity, e.entityId];
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleCell(ws, 0, 0, TITLE_STYLE);
  for (let c = 0; c < AUDIT_HEADER.length; c++) styleCell(ws, 2, c, HEADER_STYLE);
  ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 44 }, { wch: 14 }, { wch: 14 }];
  return ws;
}

export function buildPerformanceReportWorkbook(input: PerformanceReportInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const append = (name: string, ws: XLSX.WorkSheet) =>
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(name, used));

  // matched sheets first
  append(PERFORMANCE_REPORT_SHEETS[0], buildClassPerformanceSheet(input));
  append(PERFORMANCE_REPORT_SHEETS[1], buildStudentSummarySheet(input));
  append(PERFORMANCE_REPORT_SHEETS[2], buildStudentProfilesSheet(input));
  // clearly-additional sheets appended AFTER the matched layout
  append(ALTERATIONS_SHEET_NAME, buildAlterationsSheet(input.alterations));
  append("Audit Trail", buildAuditTrailSheet(input));
  return wb;
}
