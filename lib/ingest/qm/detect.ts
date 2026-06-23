/**
 * Auto-detect which of the three Questionmark exports a parsed CSV is, by its
 * header signature — the filename is only a hint, never the source of truth.
 *
 *   • Items       — has `QuestionId` AND `AnswerScore`
 *   • Assessments — has `AssessmentName` AND `ResultTotalScore` AND `ResultParticipantName`
 *   • Topics      — has `TopicName` AND `TopicScore`
 *
 * All three share `ResultId` (the join key), so we key off the columns unique to
 * each file rather than the shared one.
 */

import { parseCsv, type CsvTable } from "./csv";

export type QmFileKind = "items" | "assessments" | "topics";

export interface DetectedFile {
  kind: QmFileKind;
  table: CsvTable;
}

export interface NamedInput {
  /** Original filename — used only to disambiguate, never as the sole signal. */
  name: string;
  data: string | ArrayBuffer | Uint8Array;
}

function has(headers: readonly string[], col: string): boolean {
  return headers.includes(col);
}

/** Classify a single parsed table by its header signature, or null if unknown. */
export function detectKind(headers: readonly string[]): QmFileKind | null {
  // Topics is the most specific (TopicScore is unique to it); check it before
  // Items so a malformed file can't double-match.
  if (has(headers, "TopicName") && has(headers, "TopicScore")) return "topics";
  if (has(headers, "QuestionId") && has(headers, "AnswerScore")) return "items";
  if (
    has(headers, "AssessmentName") &&
    has(headers, "ResultTotalScore") &&
    has(headers, "ResultParticipantName")
  ) {
    return "assessments";
  }
  return null;
}

export interface DetectionResult {
  items: CsvTable;
  assessments: CsvTable;
  topics: CsvTable;
  /**
   * The source filename recognised as each kind — by header columns, not by the
   * filename itself. Lets the upload UI show what each dropped file was detected
   * as (Items / Assessments / Topics) rather than guessing from its name.
   */
  sources: Record<QmFileKind, string>;
}

export class DetectionError extends Error {}

/**
 * Parse + classify an arbitrary set of uploaded files (multi-file drop) into the
 * three required QM exports. Requires exactly one of each; throws a clear error
 * listing what's missing or duplicated so the upload UI can surface it.
 */
export function detectThreeExports(files: readonly NamedInput[]): DetectionResult {
  const found: Partial<Record<QmFileKind, { name: string; table: CsvTable }>> = {};
  const duplicates: string[] = [];
  const unknown: string[] = [];

  for (const file of files) {
    const table = parseCsv(file.data);
    const kind = detectKind(table.headers);
    if (!kind) {
      unknown.push(file.name);
      continue;
    }
    if (found[kind]) {
      duplicates.push(`${kind} (${found[kind]!.name} and ${file.name})`);
      continue;
    }
    found[kind] = { name: file.name, table };
  }

  const missing = (["items", "assessments", "topics"] as const).filter((k) => !found[k]);
  if (missing.length > 0 || duplicates.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(
        `missing the ${missing.join(", ")} export${missing.length > 1 ? "s" : ""}`,
      );
    }
    if (duplicates.length > 0) parts.push(`two files detected as ${duplicates.join("; ")}`);
    if (unknown.length > 0) parts.push(`unrecognised file(s): ${unknown.join(", ")}`);
    throw new DetectionError(
      `Need all three Questionmark CSVs (Items, Assessments, Topics) — ${parts.join("; ")}.`,
    );
  }

  return {
    items: found.items!.table,
    assessments: found.assessments!.table,
    topics: found.topics!.table,
    sources: {
      items: found.items!.name,
      assessments: found.assessments!.name,
      topics: found.topics!.name,
    },
  };
}
