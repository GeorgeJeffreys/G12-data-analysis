/**
 * Combined-export splitting & merging (Section 5).
 *
 * The Questionmark export is a SINGLE combined sheet whose every row carries an
 * `AssessmentName` (the subject) — so "splitting a combined upload by subject" is
 * just grouping cleaned responses by `assessmentName`. These helpers formalise
 * that: they group a cleaned dataset into its constituent subjects, summarise
 * each subject for the upload UI (item/participant/element/demand counts), and
 * merge several uploaded files/sheets into one row set before cleaning.
 *
 * None of this touches how item statistics are computed — it produces exactly the
 * same per-subject grouping the rest of the pipeline already consumes, so parity
 * is unaffected.
 */

import type { CleanResponse, RawExportRow } from "./types";

export interface SubjectElementSummary {
  /** Major element name. */
  major: string;
  /** Distinct sub-elements seen under this major, in first-appearance order. */
  subs: string[];
  /** Distinct items belonging to this major element. */
  items: number;
}

export interface SubjectSummary {
  assessmentName: string;
  /** Distinct scored items (by question id). */
  items: number;
  /** Distinct participants with at least one response in this subject. */
  participants: number;
  /** Counts by major element, in first-appearance order (3–5 per subject, not fixed). */
  elements: SubjectElementSummary[];
  /** Distinct items per demand level. */
  demand: { D1: number; D2: number; D3: number };
}

/**
 * Group cleaned responses by subject (`assessmentName`), preserving first-seen
 * subject order. This is the canonical "split a combined export into subjects".
 */
export function splitBySubject(clean: readonly CleanResponse[]): Map<string, CleanResponse[]> {
  const out = new Map<string, CleanResponse[]>();
  for (const r of clean) {
    const bucket = out.get(r.assessmentName);
    if (bucket) bucket.push(r);
    else out.set(r.assessmentName, [r]);
  }
  return out;
}

/** Summarise one subject's cleaned responses for the upload/raw-data screens. */
export function summarizeSubject(assessmentName: string, rows: readonly CleanResponse[]): SubjectSummary {
  // Distinct items keyed by question id; the first occurrence carries the metadata.
  const itemMeta = new Map<string, CleanResponse>();
  const participants = new Set<string>();
  for (const r of rows) {
    participants.add(r.participantPseudonym);
    if (!itemMeta.has(r.qmQuestionId)) itemMeta.set(r.qmQuestionId, r);
  }

  const elements: SubjectElementSummary[] = [];
  const elementIndex = new Map<string, SubjectElementSummary>();
  const demand = { D1: 0, D2: 0, D3: 0 };

  for (const item of itemMeta.values()) {
    if (item.demandLevel && (item.demandLevel === "D1" || item.demandLevel === "D2" || item.demandLevel === "D3")) {
      demand[item.demandLevel] += 1;
    }
    const major = item.majorElement;
    if (major) {
      let el = elementIndex.get(major);
      if (!el) {
        el = { major, subs: [], items: 0 };
        elementIndex.set(major, el);
        elements.push(el);
      }
      el.items += 1;
      if (item.subElement && !el.subs.includes(item.subElement)) el.subs.push(item.subElement);
    }
  }

  return {
    assessmentName,
    items: itemMeta.size,
    participants: participants.size,
    elements,
    demand,
  };
}

/** Summarise every subject found in a cleaned (combined) dataset. */
export function summarizeSubjects(clean: readonly CleanResponse[]): SubjectSummary[] {
  return [...splitBySubject(clean).entries()].map(([name, rows]) => summarizeSubject(name, rows));
}

/**
 * Participant-collapse guard at the ingest/detection boundary (root cause: identity
 * collapse). This is the `#distinct-input == #distinct-output participants`
 * invariant, extended to the EARLIEST point — the per-subject participant count
 * shown on Upload — so a collapse fails loudly here instead of silently surfacing
 * as "8 participants when 15 sat it" and corrupting the per-student score matrix.
 *
 * Each distinct `ResultId` is one participant's sitting of one subject, so a
 * subject's distinct OUTPUT participants (pseudonyms) must equal its distinct
 * sitters (results). Fewer means the identity step folded distinct students into
 * one record. (Re-sit / alternate forms are held out as separate subjects upstream,
 * so a graded subject carries exactly one result per sitter.)
 */
export function assertParticipantIdentityIntact(clean: readonly CleanResponse[]): void {
  const bySubject = new Map<string, { results: Set<string>; participants: Set<string> }>();
  for (const r of clean) {
    let g = bySubject.get(r.assessmentName);
    if (!g) {
      g = { results: new Set(), participants: new Set() };
      bySubject.set(r.assessmentName, g);
    }
    if (r.qmResultId) g.results.add(r.qmResultId);
    g.participants.add(r.participantPseudonym);
  }
  for (const [subject, g] of bySubject) {
    if (g.participants.size < g.results.size) {
      throw new Error(
        `participant identity collapse at ingest: "${subject}" has ${g.results.size} sitter(s) ` +
          `(distinct ResultIds) but only ${g.participants.size} distinct participant(s) — distinct ` +
          `students folded into one identity. Key participant identity on the collision-free ` +
          `natural key (ParticipantID / email = ResultParticipantName / the result→participant ` +
          `mapping), never a name-, initial- or DOB-shaped field.`,
      );
    }
  }
}

/**
 * Merge several parsed row sets (multiple files or sheets) into one combined
 * dataset before cleaning. Rows are concatenated as-is — each already carries its
 * own AssessmentName / participant id, so the subsequent split re-groups them
 * correctly regardless of which file they came from.
 */
export function mergeRawExports(...rowSets: ReadonlyArray<readonly RawExportRow[]>): RawExportRow[] {
  const merged: RawExportRow[] = [];
  for (const set of rowSets) for (const row of set) merged.push(row);
  return merged;
}
