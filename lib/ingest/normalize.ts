/**
 * Normalise raw Questionmark rows into clean MCQ responses (Section 5 cleaning):
 *   - repair mojibake text,
 *   - filter to Multiple Choice only,
 *   - drop survey assessments,
 *   - parse demand level from MetaTags (`Demand Level==Dx||...`),
 *   - derive major/sub element from QuestionTopicPath (backslash-delimited).
 */

import type { DemandLevel } from "@/lib/types/database";
import { repairText, repairValue } from "./repair";
import type { CleanResponse, RawExportRow } from "./types";

export const MCQ_QUESTION_TYPE = "Multiple Choice";

/** Historical "remove?" column header variants normalised to one canonical key. */
const REMOVE_HEADER_VARIANTS = new Set([
  "remove item?",
  "remove item",
  "remove?",
  "remove",
  "column1",
]);

/**
 * Normalise a header that may be one of the historical Remove/exclude column
 * variants ("Remove Item?", "Remove item?", "Remove?", "Column1") to the single
 * canonical key "remove". Any other header is returned trimmed but unchanged.
 * Used when importing the item-analysis workbook back in (Section 9).
 */
export function normalizeRemoveColumnHeader(header: string): string {
  const key = header.trim().toLowerCase();
  return REMOVE_HEADER_VARIANTS.has(key) ? "remove" : header.trim();
}

/** Detect survey / non-exam assessments that must not leak into analysis. */
export function isSurveyAssessment(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("survey") ||
    n.includes("user experience") ||
    n.includes("introduction to the g12") ||
    n.includes("مقدمة") // "introduction" (Arabic)
  );
}

/** Parse the demand level (D1/D2/D3) out of the MetaTags field. */
export function parseDemandLevel(metaTags: unknown): DemandLevel | null {
  if (typeof metaTags !== "string") return null;
  const m = metaTags.match(/Demand Level==\s*(D[123])\b/i);
  if (!m) return null;
  return m[1]!.toUpperCase() as DemandLevel;
}

/**
 * Derive major and sub element from a backslash-delimited QuestionTopicPath.
 * The first segment is the assessment/subject; the next two are major and sub.
 * e.g. "Applicable Math\Numerical and quantitative reasoning\Applying …"
 *      → { major: "Numerical and quantitative reasoning", sub: "Applying …" }
 */
export function deriveElements(topicPath: unknown): {
  major: string | null;
  sub: string | null;
} {
  if (typeof topicPath !== "string" || topicPath.trim() === "") {
    return { major: null, sub: null };
  }
  const repaired = repairText(topicPath);
  const segments = repaired
    .split("\\")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // Drop the leading subject segment.
  const rest = segments.slice(1);
  return { major: rest[0] ?? null, sub: rest[1] ?? null };
}

/** Strip HTML tags and collapse whitespace from question wording. */
export function stripHtml(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const repaired = repairText(value);
  const text = repaired
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[​‎‏]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

function toNumber(value: unknown, fallback: number | null): number | null {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export interface NormalizeResult {
  clean: CleanResponse[];
  droppedSurveyRows: number;
  droppedNonMcqRows: number;
}

/**
 * Turn raw rows into clean MCQ responses, dropping surveys and non-MCQ rows.
 * Participants are given a stable sequential pseudonym (P0001, P0002 …) in order
 * of first appearance, so downstream consumers never need the PII identifier.
 */
export function normalizeResponses(rows: readonly RawExportRow[]): NormalizeResult {
  const clean: CleanResponse[] = [];
  let droppedSurveyRows = 0;
  let droppedNonMcqRows = 0;

  const pseudonymByParticipant = new Map<string, string>();
  const pseudonym = (participantId: string): string => {
    let p = pseudonymByParticipant.get(participantId);
    if (!p) {
      p = `P${String(pseudonymByParticipant.size + 1).padStart(4, "0")}`;
      pseudonymByParticipant.set(participantId, p);
    }
    return p;
  };

  for (const row of rows) {
    const assessmentName = repairText(str(row["AssessmentName"]));
    const questionType = str(row["QuestionType"]);

    if (isSurveyAssessment(assessmentName)) {
      droppedSurveyRows += 1;
      continue;
    }
    if (questionType !== MCQ_QUESTION_TYPE) {
      droppedNonMcqRows += 1;
      continue;
    }

    const qmParticipantId =
      str(row["ResultParticipantName"]) || str(row["ResultId"]);
    const { major, sub } = deriveElements(row["QuestionTopicPath"]);

    clean.push({
      assessmentName,
      qmQuestionId: str(row["QuestionId"]),
      qmParticipantId,
      participantPseudonym: pseudonym(qmParticipantId),
      wording: stripHtml(row["QuestionWording"]),
      majorElement: major,
      subElement: sub,
      demandLevel: parseDemandLevel(row["MetaTags"]),
      questionType,
      maxScore: toNumber(row["QuestionMaximumScore"], 1) ?? 1,
      answerGiven: repairValue(row["AnswerGiven"]) as string | null,
      answerScore: toNumber(row["AnswerScore"], 0) ?? 0,
      responseTime: toNumber(row["AnswerResponseTimeSeconds"], null),
      resultStatus: (str(row["ResultStatus"]) || null) as string | null,
    });
  }

  return { clean, droppedSurveyRows, droppedNonMcqRows };
}
