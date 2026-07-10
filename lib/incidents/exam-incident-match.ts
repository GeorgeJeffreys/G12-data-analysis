/**
 * Matcher + reconciliation for the technical-incident export. Pure + engine-free:
 * it takes parsed rows (`parseExamIncidentRows`) and a provider-supplied match
 * context, resolves each incident to a real sitting within the ACTIVE cycle, and
 * buckets it into exactly one reconciliation status — mirroring the essay
 * masterfile validator (`validate-essay-masterfile.ts`).
 *
 * It NEVER derives an adjustment (see `docs/incident-upload-findings.md`, §3
 * gate): matched records land with `adjustmentType` / `adjustmentMagnitude`
 * unpopulated. Composition of multiple incidents is deferred to the
 * adjudication/engine step — this layer only flags `multiple_incidents`.
 *
 * Matching invariants:
 *  - The ONLY join key is the lowercased full email. `Student ID` (STU-…) is never
 *    used. Emails are matched exactly (no domain normalisation).
 *  - Scope is the active cycle's `cycle_id` (the "G12++ May 2026" row). A sitting
 *    is resolved as (email → participant → the subject's `qm_result_id`) IN SCOPE.
 *  - Nothing is silently dropped; one bad row never fails the batch.
 */

import type { ParsedExamIncidentRow, ParseExamIncidentsResult } from "./exam-incident-parse";

/** The persisted substantive bucket for a row (stored in `match_status`). */
export type ExamIncidentMatchStatus =
  | "matched"
  | "out_of_scope_cycle"
  | "staff_excluded"
  | "unmatched_email"
  | "unmatched_subject";

/** The report status: the substantive bucket, plus the upload-relative extras. */
export type ExamIncidentReportStatus = ExamIncidentMatchStatus | "duplicate" | "error";

/** A resolved sitting the matcher can join an incident to. */
export interface IncidentSittingEntry {
  /** Lowercased participant email (`qm_participant_id`). */
  email: string;
  /** Subject code the sitting belongs to (e.g. AFL / ESL / AM / ST). */
  subjectCode: string;
  /** The sitting id (`qm_result_id`, text). */
  qmResultId: string;
  /** Participant display name (for the review table). */
  name: string;
}

/** Everything the matcher needs, supplied by the provider (read-only). */
export interface ExamIncidentMatchContext {
  cycleId: string;
  /** The active cycle's display name, e.g. "G12++ May 2026". */
  activeCycleName: string;
  /** The cycle's scored subjects: display name + resolved code. */
  subjects: { code: string; name: string }[];
  /** Every sitting in the cycle, keyed later by (email, subjectCode). */
  sittings: IncidentSittingEntry[];
  /** Lowercased emails on the cycle's staff / non-cohort exclusion list. */
  staffEmails: string[];
  /** References already staged for the cycle (for the `duplicate` observation). */
  existingReferences: string[];
}

/**
 * One staged incident record — the shape persisted to `exam_incidents`. The three
 * `adjustment*` fields are ALWAYS null here (§3 gate): staging never adjusts.
 */
export interface ExamIncidentRecord {
  reference: string;
  importBatchId: string;
  examCycle: string;
  subjectRaw: string;
  subjectKey: string | null;
  examDate: string | null;
  partnerCenter: string;
  category: string;
  issue: string;
  code: string;
  studentName: string;
  studentEmail: string;
  studentIdExternal: string;
  timeStarted: string;
  timeResolved: string;
  durationMin: number | null;
  actionTaken: string;
  questionsAffectedCount: number | null;
  questionsAffectedList: string[] | null;
  status: string;
  invigilator: string;
  sourceCreatedAt: string | null;
  matchedQmResultId: string | null;
  matchStatus: ExamIncidentMatchStatus;
  /** Report/QA flags (`q_list_missing`, `multiple_incidents`). */
  flags: string[];
  adjustmentType: null;
  adjustmentMagnitude: null;
  adjustmentNotes: null;
}

/** One row of the reconciliation report George reviews before committing. */
export interface ExamIncidentReviewRow {
  rowNumber: number;
  reference: string;
  studentName: string;
  studentEmail: string;
  subjectRaw: string;
  subjectKey: string | null;
  examCycle: string;
  status: ExamIncidentReportStatus;
  /** The substantive bucket even when `status === "duplicate"`. */
  matchStatus: ExamIncidentMatchStatus | null;
  matchedQmResultId: string | null;
  matchedName: string | null;
  flags: string[];
  reason: string | null;
}

export interface ExamIncidentReconciliation {
  batchId: string;
  cycleId: string;
  fileName: string;
  counts: {
    total: number;
    matched: number;
    out_of_scope_cycle: number;
    staff_excluded: number;
    unmatched_email: number;
    unmatched_subject: number;
    duplicate: number;
    error: number;
    multiple_incidents: number;
    q_list_missing: number;
  };
  rows: ExamIncidentReviewRow[];
  /** The rows to persist (everything with a Reference + Email). */
  records: ExamIncidentRecord[];
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Map a subject NAME to a subject code, using the same rules as the hydrate
 * classifier (`lib/data/supabase-hydrate.ts:classify`). Returns null when nothing
 * maps (Life Skills, or an unknown subject) — the caller then buckets the row
 * `unmatched_subject`. Kept here so the matcher stays pure and testable.
 */
export function classifySubjectName(rawName: string): string | null {
  const s = norm(rawName);
  if (!s) return null;
  if (/arabic/.test(s) || /[؀-ۿ]/.test(rawName)) return "AFL";
  if (/applicable|\bmaths?\b/.test(s)) return "AM";
  if (/english/.test(s)) return "ESL";
  if (/scientific|\bscience\b/.test(s)) return "ST";
  return null; // Life Skills / unknown → unmatched_subject
}

/**
 * Does the export's `Exam Cycle` (e.g. "May 2026") belong to the active cycle
 * (e.g. "G12++ May 2026")? Exact-or-contained, case-insensitive — the export uses
 * a short label while the app carries the prefixed name. A blank row cycle is NOT
 * in scope (we never assume).
 */
export function isActiveCycle(rowCycle: string, activeCycleName: string): boolean {
  const r = norm(rowCycle);
  const a = norm(activeCycleName);
  if (!r || !a) return false;
  return r === a || a.includes(r) || r.includes(a);
}

const REASONS: Record<ExamIncidentReportStatus, (r: ParsedExamIncidentRow) => string | null> = {
  matched: () => null,
  duplicate: () => null,
  error: (r) => r.errors.join(" ") || null,
  out_of_scope_cycle: (r) => `Exam Cycle "${r.examCycle}" is not the active cycle — out of scope, not an error.`,
  staff_excluded: () => "Staff / non-cohort account — excluded from cohort results.",
  unmatched_subject: (r) => `Subject "${r.subjectRaw}" does not map to a subject in this cycle.`,
  unmatched_email: (r) => `Email "${r.studentEmail}" has no matching sitting in the active cycle + subject.`,
};

/**
 * Resolve + bucket every parsed row against the cycle context. See
 * `docs/incident-upload-findings.md` for the precedence.
 */
export function matchExamIncidents(
  parsed: ParseExamIncidentsResult,
  ctx: ExamIncidentMatchContext,
  opts: { batchId: string; fileName: string },
): ExamIncidentReconciliation {
  const subjectCodes = new Set(ctx.subjects.map((s) => s.code));
  const sittingByKey = new Map<string, IncidentSittingEntry>();
  for (const s of ctx.sittings) sittingByKey.set(`${norm(s.email)}||${s.subjectCode}`, s);
  const staff = new Set(ctx.staffEmails.map(norm));
  const existing = new Set(ctx.existingReferences.map(norm));
  const seen = new Set<string>();

  const rows: ExamIncidentReviewRow[] = [];
  const records: ExamIncidentRecord[] = [];

  for (const r of parsed.rows) {
    const subjectKey = classifySubjectName(r.subjectRaw);
    const subjectKnown = subjectKey !== null && subjectCodes.has(subjectKey);

    // --- report-only: rows we cannot stage (no Reference / no Email) ----------
    if (r.errors.length > 0) {
      rows.push({
        rowNumber: r.rowNumber,
        reference: r.reference,
        studentName: r.studentName,
        studentEmail: r.studentEmail,
        subjectRaw: r.subjectRaw,
        subjectKey: subjectKnown ? subjectKey : null,
        examCycle: r.examCycle,
        status: "error",
        matchStatus: null,
        matchedQmResultId: null,
        matchedName: null,
        flags: r.flags,
        reason: REASONS.error(r),
      });
      continue;
    }

    // --- substantive bucket (persisted) ---------------------------------------
    let matchStatus: ExamIncidentMatchStatus;
    let matchedQmResultId: string | null = null;
    let matchedName: string | null = null;

    if (!isActiveCycle(r.examCycle, ctx.activeCycleName)) {
      matchStatus = "out_of_scope_cycle";
    } else if (staff.has(r.studentEmail)) {
      matchStatus = "staff_excluded";
    } else if (!subjectKnown) {
      matchStatus = "unmatched_subject";
    } else {
      const sitting = sittingByKey.get(`${r.studentEmail}||${subjectKey}`);
      if (sitting) {
        matchStatus = "matched";
        matchedQmResultId = sitting.qmResultId;
        matchedName = sitting.name;
      } else {
        matchStatus = "unmatched_email";
      }
    }

    const isDuplicate = existing.has(norm(r.reference)) || seen.has(norm(r.reference));
    seen.add(norm(r.reference));

    const record: ExamIncidentRecord = {
      reference: r.reference,
      importBatchId: opts.batchId,
      examCycle: r.examCycle,
      subjectRaw: r.subjectRaw,
      subjectKey: subjectKnown ? subjectKey : null,
      examDate: r.examDate,
      partnerCenter: r.partnerCenter,
      category: r.category,
      issue: r.issue,
      code: r.code,
      studentName: r.studentName,
      studentEmail: r.studentEmail,
      studentIdExternal: r.studentIdExternal,
      timeStarted: r.timeStarted,
      timeResolved: r.timeResolved,
      durationMin: r.durationMin,
      actionTaken: r.actionTaken,
      questionsAffectedCount: r.questionsAffectedCount,
      questionsAffectedList: r.questionsAffectedList,
      status: r.status,
      invigilator: r.invigilator,
      sourceCreatedAt: r.sourceCreatedAt,
      matchedQmResultId,
      matchStatus,
      flags: [...r.flags],
      adjustmentType: null,
      adjustmentMagnitude: null,
      adjustmentNotes: null,
    };
    records.push(record);

    const status: ExamIncidentReportStatus = isDuplicate ? "duplicate" : matchStatus;
    rows.push({
      rowNumber: r.rowNumber,
      reference: r.reference,
      studentName: r.studentName,
      studentEmail: r.studentEmail,
      subjectRaw: r.subjectRaw,
      subjectKey: record.subjectKey,
      examCycle: r.examCycle,
      status,
      matchStatus,
      matchedQmResultId,
      matchedName,
      flags: record.flags,
      reason: REASONS[status](r),
    });
  }

  // --- multiple_incidents: >1 MATCHED incident for one (email, subject) -------
  const pairCount = new Map<string, number>();
  for (const rec of records) {
    if (rec.matchStatus !== "matched") continue;
    const k = `${norm(rec.studentEmail)}||${rec.subjectKey}`;
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  const flagMultiple = (email: string, subjectKey: string | null): boolean =>
    subjectKey !== null && (pairCount.get(`${norm(email)}||${subjectKey}`) ?? 0) > 1;
  for (const rec of records) {
    if (rec.matchStatus === "matched" && flagMultiple(rec.studentEmail, rec.subjectKey) && !rec.flags.includes("multiple_incidents")) {
      rec.flags.push("multiple_incidents");
    }
  }
  const recByRef = new Map(records.map((rec) => [rec.reference, rec]));
  for (const row of rows) {
    const rec = recByRef.get(row.reference);
    if (rec) row.flags = rec.flags;
  }

  const count = (s: ExamIncidentReportStatus) => rows.filter((r) => r.status === s).length;
  const flagged = (f: string) => rows.filter((r) => r.flags.includes(f)).length;

  return {
    batchId: opts.batchId,
    cycleId: ctx.cycleId,
    fileName: opts.fileName,
    counts: {
      total: rows.length,
      matched: count("matched"),
      out_of_scope_cycle: count("out_of_scope_cycle"),
      staff_excluded: count("staff_excluded"),
      unmatched_email: count("unmatched_email"),
      unmatched_subject: count("unmatched_subject"),
      duplicate: count("duplicate"),
      error: count("error"),
      multiple_incidents: flagged("multiple_incidents"),
      q_list_missing: flagged("q_list_missing"),
    },
    rows,
    records,
  };
}

/** Build a reconciliation report for an already-persisted batch's records. */
export function reconciliationFromRecords(
  records: readonly ExamIncidentRecord[],
  meta: { batchId: string; cycleId: string; fileName: string },
): ExamIncidentReconciliation {
  const rows: ExamIncidentReviewRow[] = records.map((rec) => ({
    rowNumber: 0,
    reference: rec.reference,
    studentName: rec.studentName,
    studentEmail: rec.studentEmail,
    subjectRaw: rec.subjectRaw,
    subjectKey: rec.subjectKey,
    examCycle: rec.examCycle,
    status: rec.matchStatus,
    matchStatus: rec.matchStatus,
    matchedQmResultId: rec.matchedQmResultId,
    matchedName: null,
    flags: rec.flags,
    reason: REASONS[rec.matchStatus]({
      examCycle: rec.examCycle,
      subjectRaw: rec.subjectRaw,
      studentEmail: rec.studentEmail,
    } as ParsedExamIncidentRow),
  }));
  const count = (s: ExamIncidentMatchStatus) => rows.filter((r) => r.status === s).length;
  const flagged = (f: string) => rows.filter((r) => r.flags.includes(f)).length;
  return {
    batchId: meta.batchId,
    cycleId: meta.cycleId,
    fileName: meta.fileName,
    counts: {
      total: rows.length,
      matched: count("matched"),
      out_of_scope_cycle: count("out_of_scope_cycle"),
      staff_excluded: count("staff_excluded"),
      unmatched_email: count("unmatched_email"),
      unmatched_subject: count("unmatched_subject"),
      duplicate: 0,
      error: 0,
      multiple_incidents: flagged("multiple_incidents"),
      q_list_missing: flagged("q_list_missing"),
    },
    rows,
    records: [...records],
  };
}
