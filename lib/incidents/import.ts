/**
 * Incident import parser — reconfigurable column mapping, row-level validation,
 * and bucketing into incident codes.
 *
 * The parser is split from file-reading on purpose: `parseIncidentRows` works on
 * plain row objects (already read from the sheet), so it is fully unit-testable
 * with no SheetJS/File. `readIncidentWorkbook` is the thin browser-only wrapper
 * that turns an uploaded File into those row objects.
 *
 * Guarantees:
 *  - Required-field validation surfaces row-level errors (bad/missing Student ID,
 *    a missing/invalid duration when the matched code needs one) — never a throw.
 *  - Every row is categorised: matched → its code; unmatched Incident Type →
 *    the "unclassified" bucket for manual attention. Nothing is silently dropped.
 *  - Participant resolution keys on P-A's stable internal id, never a per-ingest
 *    UUID or a non-unique derived key.
 */

import type { IncidentCode, IncidentColumnMapping } from "./types";
import { classifyIncidentType } from "./config";

/** One row as parsed + validated + classified. Every input row yields exactly one. */
export interface ParsedIncidentRow {
  /** 1-based source row number, for surfacing errors in the UI. */
  rowNumber: number;
  rawStudentId: string;
  studentName: string;
  incidentType: string;
  questionNumber: string;
  /** Parsed duration in minutes, or null when absent/unparseable. */
  durationMinutes: number | null;
  /** The matched incident code id, or null when unclassified. */
  codeId: string | null;
  /** `ok` = classified & valid; `unclassified` = no code match; `error` = a
   *  row-level validation problem (still surfaced, never dropped). */
  status: "ok" | "unclassified" | "error";
  /** Human-readable row-level problems. */
  errors: string[];
}

export interface ParseIncidentsResult {
  rows: ParsedIncidentRow[];
  counts: { total: number; ok: number; unclassified: number; error: number };
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/**
 * Parse a duration cell into minutes. Accepts a bare number ("15"), a number with
 * a unit ("15 min", "15 minutes"), or "mm:ss" / "h:mm" clock values. Returns null
 * when nothing numeric can be read.
 */
export function parseDurationMinutes(raw: unknown): number | null {
  const s = str(raw);
  if (!s) return null;
  // clock form h:mm or mm:ss → treat as minutes:seconds
  const clock = s.match(/^(\d+):(\d{1,2})$/);
  if (clock) {
    const a = Number(clock[1]);
    const b = Number(clock[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return a + b / 60;
  }
  const num = s.match(/-?\d+(?:\.\d+)?/);
  if (!num) return null;
  const n = Number(num[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse + validate + classify incident rows against a column mapping and the
 * active incident-code registry. Pure — no cohort matching (see
 * `resolveParticipants`).
 */
export function parseIncidentRows(
  rawRows: readonly Record<string, unknown>[],
  mapping: IncidentColumnMapping,
  codes: readonly IncidentCode[],
): ParseIncidentsResult {
  const rows: ParsedIncidentRow[] = [];
  let ok = 0;
  let unclassified = 0;
  let error = 0;

  rawRows.forEach((raw, i) => {
    const rawStudentId = str(raw[mapping.studentId]);
    const studentName = str(raw[mapping.studentName]);
    const incidentType = str(raw[mapping.incidentType]);
    const questionNumber = str(raw[mapping.questionNumber]);
    const durationCell = raw[mapping.duration];
    const durationMinutes = parseDurationMinutes(durationCell);

    const errors: string[] = [];
    // A student id is the identity anchor — missing/blank is a hard row error.
    if (!rawStudentId && !studentName) errors.push("Missing Student ID and Student Name.");
    else if (!rawStudentId) errors.push("Missing Student ID.");

    const matched = incidentType ? classifyIncidentType(incidentType, codes) : null;
    if (!incidentType) errors.push("Missing Incident Type.");

    // A per-duration code needs a usable duration; flag it (surfaced, not dropped).
    if (matched && matched.formula.kind === "per_duration") {
      if (durationMinutes === null) errors.push("This incident type needs a duration; none was readable.");
      else if (durationMinutes < 0) errors.push("Duration cannot be negative.");
    }

    let status: ParsedIncidentRow["status"];
    if (errors.length > 0) {
      status = "error";
      error += 1;
    } else if (!matched) {
      status = "unclassified";
      unclassified += 1;
    } else {
      status = "ok";
      ok += 1;
    }

    rows.push({
      rowNumber: i + 1,
      rawStudentId,
      studentName,
      incidentType,
      questionNumber,
      durationMinutes,
      codeId: matched ? matched.id : null,
      status,
      errors,
    });
  });

  return { rows, counts: { total: rawRows.length, ok, unclassified, error } };
}

/** A cohort participant, as the resolver needs to see it. `internalId` is P-A's
 *  stable, collision-free id (`qm_participant_id`, minted from the email). */
export interface RosterParticipant {
  internalId: string;
  name: string;
}

/** A parsed row with its resolved cohort participant (null when unmatched). */
export interface ResolvedIncidentRow extends ParsedIncidentRow {
  /** P-A internal participant id this row keys on, or null when no cohort match. */
  participantInternalId: string | null;
  matched: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Match parsed rows to cohort participants on P-A's stable internal id. Tries the
 * file's Student ID against the internal id first (the intended, unique key),
 * then falls back to an exact normalised name match. Unmatched rows are KEPT and
 * flagged (`matched: false`) — never dropped — so a mis-keyed file surfaces
 * instead of silently losing incidents.
 */
export function resolveParticipants(
  rows: readonly ParsedIncidentRow[],
  roster: readonly RosterParticipant[],
): ResolvedIncidentRow[] {
  const byId = new Map<string, string>();
  const byName = new Map<string, string | null>(); // null marks an ambiguous (non-unique) name
  for (const p of roster) {
    byId.set(norm(p.internalId), p.internalId);
    const nk = norm(p.name);
    if (nk) byName.set(nk, byName.has(nk) ? null : p.internalId);
  }

  return rows.map((r) => {
    let participantInternalId: string | null = null;
    if (r.rawStudentId) {
      participantInternalId = byId.get(norm(r.rawStudentId)) ?? null;
    }
    if (!participantInternalId && r.studentName) {
      const hit = byName.get(norm(r.studentName));
      if (hit) participantInternalId = hit; // ignores null (ambiguous) matches
    }
    return { ...r, participantInternalId, matched: participantInternalId !== null };
  });
}

/**
 * Browser-only: read an uploaded incident file (Excel/CSV) into row objects keyed
 * by header. The first sheet is used unless `sheetName` is given. Header detection
 * is SheetJS's default (row 1); the mapping then names the columns by header.
 */
export async function readIncidentWorkbook(
  file: File,
  sheetName?: string,
): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const name = sheetName && wb.Sheets[sheetName] ? sheetName : wb.SheetNames[0];
  if (!name || !wb.Sheets[name]) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name]!, { defval: "", blankrows: false });
}
