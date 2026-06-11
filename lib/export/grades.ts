/**
 * Grades workbook — the self-contained, auditable record of the grades a cycle
 * produced (Section 9). Four sheets:
 *   1. Grade Summary        — cycle metadata, award distribution, per-assessment
 *                             performance-level distribution.
 *   2. Student Grades       — the main deliverable: per-student section levels +
 *                             scores + percentages, overall award, and the
 *                             Distinction-safeguard cap / override columns.
 *   3. Alterations          — the canonical record of human-decided raw-mark
 *                             alterations (from the Adjustments incident triage).
 *   4. Audit Trail          — every audit entry that produced these grades.
 *
 * Performance-level cells are colour-filled (Outstanding green → Doesn't-yet-meet
 * red) using the configurable performance-levels order, so nothing hardcodes the
 * band names.
 */

import {
  XLSX,
  HEADER_STYLE,
  TITLE_STYLE,
  META_STYLE,
  PERFORMANCE_STYLES,
  styleCell,
  roundOrNull,
} from "./sheet-utils";
import { buildAlterationsSheet } from "./alterations";
import type { GradesInput, StudentGradeRow, SubjectColumn } from "./types";

export const GRADES_SHEETS = [
  "Grade Summary",
  "Student Grades",
  "Alterations",
  "Audit Trail",
] as const;

/** Canonical subject columns in template order (assessmentId filled by caller). */
export const DEFAULT_SUBJECT_COLUMNS: SubjectColumn[] = [
  { key: "ApplicableMath", prefix: "ApplicableMath", label: "Applicable Math", assessmentId: null },
  { key: "EnglishL2", prefix: "EnglishL2", label: "English as a 2nd Language", assessmentId: null },
  { key: "ScientificThinking", prefix: "ScientificThinking", label: "Scientific Thinking", assessmentId: null },
  { key: "ArabicL1", prefix: "ArabicL1", label: "Arabic as a 1st Language", assessmentId: null },
  { key: "LifeSuccessSkills", prefix: "LifeSuccessSkills", label: "Life Success Skills", assessmentId: null },
];

/** The exact Student-Grades header for the canonical 5-subject template. */
export const GRADES_STUDENT_HEADERS = [
  "ParticipantID",
  "ParticipantFullName",
  "ApplicableMath_Level",
  "ApplicableMath_Score",
  "ApplicableMath_Pct",
  "EnglishL2_Level",
  "EnglishL2_Score",
  "EnglishL2_Pct",
  "ScientificThinking_Level",
  "ScientificThinking_Score",
  "ScientificThinking_Pct",
  "ArabicL1_Level",
  "ArabicL1_Score",
  "ArabicL1_Pct",
  "LifeSuccessSkills_Level",
  "LifeSuccessSkills_Score",
  "LifeSuccessSkills_Pct",
  "OverallAward",
  "DistinctionCapApplied",
  "CapReason",
  "CapOverridden",
  "OverrideReason",
] as const;

const AUDIT_HEADER = ["Timestamp", "Actor", "Action", "Detail", "Entity", "EntityId"];

function studentHeader(subjects: SubjectColumn[]): string[] {
  // DOWNSTREAM: the cap columns are named after the "Distinction" top award. The
  // safeguard logic itself reads the configured top award (awardLevels[0]); only
  // these column labels bake in the default name. If a non-default ScoringConfig
  // renames the top award, the next prompt should derive these labels from the
  // configured top-award name rather than hardcoding "Distinction".
  return [
    "ParticipantID",
    "ParticipantFullName",
    ...subjects.flatMap((s) => [`${s.prefix}_Level`, `${s.prefix}_Score`, `${s.prefix}_Pct`]),
    "OverallAward",
    "DistinctionCapApplied",
    "CapReason",
    "CapOverridden",
    "OverrideReason",
  ];
}

function buildGradeSummarySheet(input: GradesInput): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [];
  aoa[0] = [`G12++ Grade Summary — ${input.cycleName}`];
  aoa[2] = [
    "Participants",
    input.participantCount,
    "Assessments",
    input.assessmentCount,
    "Locked at",
    input.lockedAt ?? "Not locked",
    "Signed off by",
    input.signedOffBy ?? "—",
  ];

  aoa[4] = ["Overall award distribution"];
  const awardHeaderRow = 5;
  aoa[5] = ["Award", "Count", "Percentage"];
  let row = 6;
  for (const d of input.awardDistribution) {
    aoa[row++] = [d.level, d.count, `${d.pct}%`];
  }

  row += 1;
  aoa[row++] = ["Performance-level distribution by assessment"];
  const perfHeaderRow = row;
  aoa[row++] = ["Assessment", ...input.performanceLevels];
  for (const pd of input.performanceDistribution) {
    aoa[row++] = [pd.assessmentName, ...input.performanceLevels.map((lvl) => pd.counts[lvl] ?? 0)];
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleCell(ws, 0, 0, TITLE_STYLE);
  for (let c = 0; c < 8; c += 2) styleCell(ws, 2, c, META_STYLE);
  for (let c = 0; c < 3; c++) styleCell(ws, awardHeaderRow, c, HEADER_STYLE);
  for (let c = 0; c <= input.performanceLevels.length; c++) styleCell(ws, perfHeaderRow, c, HEADER_STYLE);
  ws["!cols"] = [{ wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }];
  return ws;
}

function awardRank(award: string, awardLevels: string[]): number {
  const i = awardLevels.indexOf(award);
  return i === -1 ? awardLevels.length : i;
}

function buildStudentGradesSheet(input: GradesInput): XLSX.WorkSheet {
  const header = studentHeader(input.subjects);
  const aoa: (string | number | null)[][] = [];
  aoa[0] = [`G12++ Student Grades — ${input.cycleName}`];
  aoa[2] = header;

  const students = [...input.students].sort(
    (a, b) =>
      awardRank(a.overallAward, input.awardLevels) - awardRank(b.overallAward, input.awardLevels) ||
      (b.overallPct ?? -Infinity) - (a.overallPct ?? -Infinity),
  );

  const headerRow = 2;
  const levelColOf = (subjectIdx: number) => 2 + subjectIdx * 3;

  students.forEach((s, i) => {
    const rowIdx = headerRow + 1 + i;
    const cells: (string | number | null)[] = [s.participantId, s.participantName];
    for (const subj of input.subjects) {
      const cell = subj.assessmentId ? s.perAssessment[subj.assessmentId] : undefined;
      cells.push(cell?.level ?? "", cell?.score ?? null, cell?.pct ?? null);
    }
    cells.push(
      s.overallAward,
      s.capApplied ? "Yes" : "No",
      s.capReason ?? "",
      s.capOverridden ? "Yes" : "No",
      s.overrideReason ?? "",
    );
    aoa[rowIdx] = cells;
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleCell(ws, 0, 0, TITLE_STYLE);
  for (let c = 0; c < header.length; c++) styleCell(ws, headerRow, c, HEADER_STYLE);

  // Performance-level fills.
  students.forEach((s, i) => {
    const rowIdx = headerRow + 1 + i;
    input.subjects.forEach((subj, sIdx) => {
      const level = subj.assessmentId ? s.perAssessment[subj.assessmentId]?.level : undefined;
      if (!level) return;
      const lvlIdx = input.performanceLevels.indexOf(level);
      // DOWNSTREAM: PERFORMANCE_STYLES is a fixed 4-entry palette. A 5th+ level
      // from a non-default ScoringConfig yields `undefined` here and renders with
      // no fill. The next prompt (Settings CRUD + exports) must extend the palette
      // to N levels or validate the level count before export.
      const style = lvlIdx >= 0 ? PERFORMANCE_STYLES[lvlIdx] : undefined;
      if (style) styleCell(ws, rowIdx, levelColOf(sIdx), style);
    });
  });

  ws["!cols"] = [
    { wch: 14 },
    { wch: 18 },
    ...input.subjects.flatMap(() => [{ wch: 22 }, { wch: 10 }, { wch: 8 }]),
    { wch: 22 }, // OverallAward
    { wch: 18 }, // CapApplied
    { wch: 30 }, // CapReason
    { wch: 14 }, // CapOverridden
    { wch: 30 }, // OverrideReason
  ];
  return ws;
}

function buildAuditTrailSheet(input: GradesInput): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [];
  aoa[0] = [`G12++ Audit Trail — ${input.cycleName}`];
  aoa[2] = [...AUDIT_HEADER];
  const entries = [...input.audit].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let row = 3;
  for (const e of entries) {
    aoa[row++] = [e.timestamp, e.actor, e.action, e.detail, e.entity, e.entityId];
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  styleCell(ws, 0, 0, TITLE_STYLE);
  for (let c = 0; c < AUDIT_HEADER.length; c++) styleCell(ws, 2, c, HEADER_STYLE);
  ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 28 }, { wch: 48 }, { wch: 14 }, { wch: 14 }];
  return ws;
}

export function buildGradesWorkbook(input: GradesInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildGradeSummarySheet(input), GRADES_SHEETS[0]);
  XLSX.utils.book_append_sheet(wb, buildStudentGradesSheet(input), GRADES_SHEETS[1]);
  XLSX.utils.book_append_sheet(wb, buildAlterationsSheet(input.alterations), GRADES_SHEETS[2]);
  XLSX.utils.book_append_sheet(wb, buildAuditTrailSheet(input), GRADES_SHEETS[3]);
  return wb;
}

/** Round helper re-exported for callers assembling pct values. */
export { roundOrNull };
export type { StudentGradeRow };
