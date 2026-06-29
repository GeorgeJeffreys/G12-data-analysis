/**
 * Reusable CSV/XLSX builders for the overall-score-analysis exports, shared by
 * the Raw data and Naive scores screens. The XLSX is the canonical
 * MCQ_Overall_Score_Analysis workbook (Summary + by-assessment + by-major-element
 * + by-demand-level + Analysis); the CSV is the screen's primary tabular data.
 *
 * Export/formatting only — these read the same engine primitives the score
 * engine uses (via the provider) and never recompute scores.
 */
import type { DataProvider } from "@/lib/data/provider";
import type { AssembleScoreAnalysisArgs } from "@/lib/export/types";
import { downloadCsv, downloadWorkbook, fileStem } from "@/lib/ui/export";

/** Dataset CSV: one row per retained response, with the element/sub-element/demand metadata. */
export function scoreDatasetCsv(data: AssembleScoreAnalysisArgs): { headers: string[]; rows: unknown[][] } {
  const nameById = new Map(data.assessments.map((a) => [a.id, a.name]));
  const metaById = new Map(data.items.map((i) => [`${i.assessmentId}:${i.itemId}`, i]));
  const excluded = new Set(data.excludedItemIds);
  const headers = [
    "ResultId", "Assessment", "QuestionId", "QuestionMajorElement", "QuestionSubElement",
    "DemandLevel", "Score", "QuestionMaximumScore", "Excluded",
  ];
  const rows = data.responses.map((r) => {
    const m = metaById.get(`${r.assessmentId}:${r.itemId}`);
    return [
      r.participantId, nameById.get(r.assessmentId) ?? r.assessmentId, r.itemId,
      m?.majorElement ?? "", m?.subElement ?? "", m?.demandLevel ?? "",
      r.score, m?.maxScore ?? 1, excluded.has(r.itemId) ? "Yes" : "No",
    ];
  });
  return { headers, rows };
}

/** Overall-scores CSV: one row per participant, total score per assessment + overall. */
export function overallScoreCsv(data: AssembleScoreAnalysisArgs): { headers: string[]; rows: unknown[][] } {
  // INVARIANT (root cause D — mirrored from #22 into the export-generation path).
  // The per-(participant × subject) cells below bucket on (participantId,
  // assessmentId). BOTH id spaces must be GUARANTEED-UNIQUE, and every retained
  // response must map to a listed participant; otherwise a collapsed/duplicated
  // key silently merges two students' scores into one cell. Fail loudly rather
  // than export wrong numbers.
  const partIds = new Set<string>();
  for (const p of data.participants) {
    if (partIds.has(p.id)) throw new Error(`overallScoreCsv: duplicate participant id "${p.id}" — per-(participant,subject) cells would collide.`);
    partIds.add(p.id);
  }
  const assessIds = new Set<string>();
  for (const a of data.assessments) {
    if (assessIds.has(a.id)) throw new Error(`overallScoreCsv: duplicate assessment id "${a.id}" — subject columns would collide.`);
    assessIds.add(a.id);
  }
  const excluded = new Set(data.excludedItemIds);
  const byP = new Map<string, Map<string, number>>();
  for (const r of data.responses) {
    if (excluded.has(r.itemId)) continue;
    if (!partIds.has(r.participantId)) {
      throw new Error(
        `overallScoreCsv: response references participant "${r.participantId}" absent from the roster — participant collapse (a result was bucketed under a key that no surviving participant owns).`,
      );
    }
    const perA = byP.get(r.participantId) ?? new Map<string, number>();
    perA.set(r.assessmentId, (perA.get(r.assessmentId) ?? 0) + r.score);
    byP.set(r.participantId, perA);
  }
  const headers = ["ResultId", "Participant", ...data.assessments.map((a) => a.name), "Overall"];
  const rows = data.participants.map((p) => {
    const perA = byP.get(p.id);
    const perAssessment = data.assessments.map((a) => perA?.get(a.id) ?? 0);
    const overall = perAssessment.reduce((s, v) => s + v, 0);
    return [p.id, p.label, ...perAssessment, overall];
  });
  return { headers, rows };
}

/** Build + download the canonical 5-sheet overall-score-analysis workbook. */
export async function downloadScoreAnalysisXlsx(data: AssembleScoreAnalysisArgs, label: string): Promise<void> {
  const exp = await import("@/lib/export");
  const wb = exp.buildScoreAnalysisWorkbook(exp.assembleScoreAnalysis(data));
  await downloadWorkbook(`${fileStem(label)}.xlsx`, wb);
}

/** Convenience: fetch score data for a cycle, or null if unavailable. */
export function scoreData(provider: DataProvider, cycleId: string, preExclusion: boolean): AssembleScoreAnalysisArgs | null {
  return provider.getScoreAnalysisData(cycleId, preExclusion);
}

export { downloadCsv };
