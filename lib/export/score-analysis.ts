/**
 * Overall Score Analysis workbook (mirrors `MCQ_Overall_Score_Analysis`):
 * a Scores sheet with each participant's raw and % per assessment and overall,
 * plus a Summary sheet with per-assessment means and the score distribution.
 */

import * as XLSX from "xlsx";
import type { ScoreAnalysisInput } from "./types";

export function buildScoreAnalysisWorkbook(input: ScoreAnalysisInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { assessments, participants, scores, rollUp } = input;

  // index scores by participant + assessment
  const byKey = new Map(scores.map((s) => [`${s.participantId} ${s.assessmentId}`, s]));

  // --- Scores sheet ---------------------------------------------------------
  const header: string[] = ["Participant"];
  for (const a of assessments) {
    header.push(`${a.name} Raw`, `${a.name} %`);
  }
  header.push("Overall Raw", "Overall %");

  const rows: (string | number | null)[][] = [header];

  for (const p of participants) {
    const row: (string | number | null)[] = [p.label];
    let overallRaw = 0;
    let overallMaxPct = 0;
    let counted = 0;
    for (const a of assessments) {
      const s = byKey.get(`${p.id} ${a.id}`);
      if (s) {
        row.push(s.raw, s.pct);
        overallRaw += s.raw;
        overallMaxPct += s.pct;
        counted += 1;
      } else {
        row.push(null, null);
      }
    }
    row.push(
      counted > 0 ? Math.round(overallRaw * 1000) / 1000 : null,
      counted > 0 ? Math.round((overallMaxPct / counted) * 100) / 100 : null,
    );
    rows.push(row);
  }

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Scores");

  // --- Summary sheet --------------------------------------------------------
  const summaryRows: (string | number)[][] = [
    ["Assessment", "Participants", "Mean Raw", "Mean %"],
  ];
  const nameById = new Map(assessments.map((a) => [a.id, a.name]));
  if (rollUp) {
    for (const a of rollUp.byAssessment) {
      summaryRows.push([
        nameById.get(a.assessmentId) ?? a.assessmentId,
        a.participants,
        a.meanRaw,
        a.meanPct,
      ]);
    }
    summaryRows.push([]);
    summaryRows.push(["Score distribution (overall %)", "", "", ""]);
    summaryRows.push(["From", "To", "Count", ""]);
    for (const b of rollUp.distribution) {
      summaryRows.push([b.from, b.to, b.count, ""]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");

  return wb;
}

export const SCORE_ANALYSIS_FIXED_HEADERS = ["Participant"] as const;
