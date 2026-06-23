import "server-only";

/**
 * Server-side raw-export ingest write path.
 *
 * Persists a cleaned, split combined export (the per-subject assessments, their
 * items, the participants, and the long-format response matrix the engine
 * consumes — plus the richer 3-CSV intake: result totals + topic rollups) into
 * Supabase. These tables are not client-writable (`assessments.status`,
 * `items.status`, the immutable `responses` facts), so the write goes through
 * the secret-key admin client, which bypasses RLS. The HTTP route in front of
 * this authorizes the caller as a lead_admin of the cycle via the RLS-scoped
 * session client before handing over.
 *
 * TRANSACTIONAL + IDEMPOTENT (migration 0007). The whole persist for one upload
 * runs as a SINGLE call to the `ingest_persist` SQL function: it clears the
 * sitting's existing ingested rows and re-inserts the fresh set inside one
 * transaction (a plpgsql body is atomic). Two consequences:
 *   * Re-uploading a sitting cleanly REPLACES it (clear-before-insert) instead
 *     of colliding with leftover rows — row counts stay stable.
 *   * A mid-ingest failure rolls back WHOLE — there is no multi-statement REST
 *     sequence that could leave partial rows behind. (The old path inserted
 *     assessments/items first and stranded them when topic_rollups blew up.)
 *
 * To wire the foreign keys without reading ids back (which is what forced the
 * old non-atomic, statement-by-statement REST writes), we generate the row ids
 * client-side here and hand the SQL function the fully-formed payload.
 *
 * The engine is untouched — this only persists the same response-matrix shape
 * the engine already reads; recompute (item_stats/participant_scores) runs
 * afterwards through the existing engine write path.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import type { CleanResponse } from "@/lib/ingest/types";
import type { ValidationReport } from "@/lib/ingest/types";
import type { CanonicalModel } from "@/lib/ingest/qm";

type Admin = SupabaseAdminClient;

/** Loose view of `.rpc` — the dynamic function name defeats the typed client's
 *  per-function inference; the name/args are checked against the `Functions`
 *  map in lib/types/database.ts at the (single) call site below. */
function callRpc(
  admin: Admin,
  name: string,
  args: unknown,
): Promise<{ data: unknown; error: { message: string } | null }> {
  return (admin.rpc as unknown as (
    n: string,
    a: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(name, args);
}

export interface IngestWriteResult {
  assessments: number;
  items: number;
  participants: number;
  responses: number;
}

export interface IngestWriteOptions {
  /**
   * Authenticated user id recorded as `import_batches.created_by` + the audit
   * actor. REQUIRED: this write goes through the secret-key admin client, which
   * has no session, so the DB's `auth.uid()` always resolves to null and would
   * violate NOT NULL. The caller resolves the user from the session-aware server
   * client and passes it explicitly.
   */
  createdBy: string;
  /** File name / reference recorded on the import_batches row. */
  fileRef?: string;
  /** Combined size (MB) of the uploaded export set — migration 0009. */
  fileSizeMB?: number;
  /** Validation report stored alongside the batch (surfaced on refresh). */
  report?: ValidationReport;
  /**
   * The faithful 3-CSV canonical model. When present, the write also persists the
   * richer intake (migration 0006): participant personal fields, per-item type /
   * status / topic, per-result QM totals (`result_totals`), per-topic rollups
   * (`topic_rollups`), and the subject QM max + sitting. Optional — when absent
   * (legacy single-file path / older callers) only the engine response matrix is
   * written, exactly as before.
   */
  canonical?: CanonicalModel;
  /** Source filenames for the three exports (recorded on import_batches). */
  files?: { items?: string; assessments?: string; topics?: string };
}

/**
 * Persist cleaned responses for a cycle (atomic full replace). Returns row
 * counts. Throws on any write error so the caller can surface it.
 */
export async function ingestCleanResponses(
  admin: Admin,
  cycleId: string,
  recs: readonly CleanResponse[],
  opts: IngestWriteOptions,
): Promise<IngestWriteResult> {
  // The service client has no session, so we never let the DB's auth.uid()
  // default fill an audit column — the caller must resolve the user explicitly.
  if (!opts.createdBy) throw new Error("You must be signed in to upload");

  const canonical = opts.canonical;
  // Subject (canonical name) → its QmSubject, for the qm_max_score + sitting columns.
  const subjectByName = new Map(canonical?.subjects.map((s) => [s.name, s]) ?? []);

  // ── 1. Assessments (distinct, in first-appearance order) — client ids ─────
  const assessmentNames: string[] = [];
  for (const r of recs) if (!assessmentNames.includes(r.assessmentName)) assessmentNames.push(r.assessmentName);
  const assessmentId = new Map<string, string>();
  const assessmentRows: Record<string, unknown>[] = [];
  for (const name of assessmentNames) {
    const id = randomUUID();
    assessmentId.set(name, id);
    const itemCount = new Set(recs.filter((r) => r.assessmentName === name).map((r) => r.qmQuestionId)).size;
    const subj = subjectByName.get(name);
    assessmentRows.push({
      id,
      cycle_id: cycleId,
      name,
      item_count: itemCount,
      // Richer intake (0006): QM subject max + sitting tag, when available.
      qm_max_score: subj?.qmMaximumScore ?? null,
      sitting: canonical?.sitting?.code ?? null,
    });
  }

  // ── 2. Items (distinct per assessment) — client ids ───────────────────────
  // Canonical item metadata (type / status / topic) keyed by `${subject}|${qid}`.
  const canonItem = new Map(canonical?.items.map((it) => [`${it.subject}|${it.questionId}`, it]) ?? []);
  const itemId = new Map<string, string>(); // `${assessment}|${qmQuestionId}` → uuid
  const itemRows: Record<string, unknown>[] = [];
  const seenItem = new Set<string>();
  for (const r of recs) {
    const key = `${r.assessmentName}|${r.qmQuestionId}`;
    if (seenItem.has(key)) continue;
    seenItem.add(key);
    const id = randomUUID();
    itemId.set(key, id);
    const ci = canonItem.get(key);
    itemRows.push({
      id,
      cycle_id: cycleId,
      assessment_id: assessmentId.get(r.assessmentName),
      qm_question_id: r.qmQuestionId,
      wording: r.wording,
      major_element: r.majorElement,
      sub_element: r.subElement,
      demand_level: r.demandLevel,
      max_score: r.maxScore ?? 1,
      // Richer intake (0006): QuestionType, QuestionStatus (Beta/Normal —
      // informational), and the topic name/path. Null when no canonical model.
      question_type: ci?.questionType ?? null,
      question_status: ci?.status ?? null,
      topic_name: ci?.topicName ?? null,
      topic_path: ci?.topicPath ?? null,
    });
  }

  // ── 3. Participants (distinct) — client ids; retain every personal field ──
  // Canonical participant by email (lowercased), to enrich the personal fields.
  const canonPart = new Map(canonical?.participants.map((p) => [p.email, p]) ?? []);
  const participantId = new Map<string, string>(); // qmParticipantId → uuid
  const emailToParticipantId = new Map<string, string>(); // lowercased email → uuid
  const partRows: Record<string, unknown>[] = [];
  const seenPart = new Set<string>();
  for (const r of recs) {
    if (seenPart.has(r.qmParticipantId)) continue;
    seenPart.add(r.qmParticipantId);
    const id = randomUUID();
    participantId.set(r.qmParticipantId, id);
    emailToParticipantId.set(r.qmParticipantId.toLowerCase(), id);
    const cp = canonPart.get(r.qmParticipantId.toLowerCase());
    partRows.push({
      id,
      cycle_id: cycleId,
      qm_participant_id: r.qmParticipantId,
      pseudonym_id: r.participantPseudonym,
      // Richer intake (0006): full participant identity (PII — EU region, RLS).
      full_name: cp?.fullName ?? null,
      first_name: cp?.firstName ?? null,
      last_name: cp?.lastName ?? null,
      email: cp?.email ?? null,
      dob: cp?.dob ?? null,
      gender: cp?.gender ?? null,
      group_name: cp?.groupNames[0] ?? null,
    });
  }

  // ── 4. Responses (long-format facts; dedupe to keep unique(participant,item)) ──
  const respRows: Record<string, unknown>[] = [];
  const seenResp = new Set<string>();
  for (const r of recs) {
    const pId = participantId.get(r.qmParticipantId);
    const iId = itemId.get(`${r.assessmentName}|${r.qmQuestionId}`);
    if (!pId || !iId) continue;
    const key = `${pId}|${iId}`;
    if (seenResp.has(key)) continue; // first response wins (duplicates flagged in validation)
    seenResp.add(key);
    const ci = canonItem.get(`${r.assessmentName}|${r.qmQuestionId}`);
    respRows.push({
      cycle_id: cycleId,
      participant_id: pId,
      item_id: iId,
      answer_given: r.answerGiven,
      answer_score: r.answerScore,
      response_time: r.responseTime,
      result_status: r.resultStatus,
      // Richer intake (0006): per-answer question type + status.
      question_type: ci?.questionType ?? null,
      question_status: ci?.status ?? null,
    });
  }

  // ── 5. Richer intake (0006): per-result QM totals + per-topic rollups ─────
  // These hold QM's TRUSTED totals across EVERY question type (essays/Likert/…),
  // not just the MCQ engine matrix above. Built only when a canonical model is
  // supplied; results whose participant/subject didn't map are skipped silently.
  // topic_rollups are keyed on the topic's ID (0007) — same display name at
  // different TopicIds within one result is preserved, not collapsed.
  const resultRows: Record<string, unknown>[] = [];
  const topicRows: Record<string, unknown>[] = [];
  if (canonical) {
    for (const res of canonical.results) {
      const aId = assessmentId.get(res.subject);
      const pId = emailToParticipantId.get(res.participantEmail);
      if (!aId || !pId) continue;
      const reconciled = !canonical.integrity.issues.some((i) => i.resultId === res.resultId);
      resultRows.push({
        cycle_id: cycleId,
        assessment_id: aId,
        participant_id: pId,
        qm_result_id: res.resultId,
        total_score: res.totalScore,
        maximum_score: res.maximumScore,
        percentage_score: res.percentageScore,
        scoreband: res.scoreband,
        result_status: res.status,
        attempt_number: res.attemptNumber,
        sitting: res.sitting?.code ?? canonical.sitting?.code ?? null,
        reconciled,
      });
      for (const t of res.topics) {
        topicRows.push({
          cycle_id: cycleId,
          assessment_id: aId,
          participant_id: pId,
          qm_result_id: res.resultId,
          qm_topic_id: t.topicId, // the natural key (0007) — never the name
          topic_name: t.name,
          topic_path: t.path,
          score: t.score,
          maximum_score: t.maximumScore,
          percentage_score: t.percentageScore,
          question_count: t.questionCount,
        });
      }
    }
  }

  // ── 6. Import batch row (file refs + validation report; read back on refresh) ──
  const importBatch: Record<string, unknown> = {
    file_ref: opts.fileRef ?? opts.files?.assessments ?? null,
    file_size_mb: opts.fileSizeMB ?? null,
    parsed_rows: opts.report?.stats.rawRows ?? recs.length,
    validation_passed: opts.report?.passed ?? true,
    report_json: opts.report ?? null,
    items_file: opts.files?.items ?? null,
    assessments_file: opts.files?.assessments ?? null,
    topics_file: opts.files?.topics ?? null,
    results_total: canonical?.integrity.resultsChecked ?? null,
    results_reconciled: canonical?.integrity.reconciled ?? null,
  };

  // ── 7. Persist atomically: clear-then-insert inside ONE transaction. ──────
  // A single call — so a failure cannot leave partial rows, and a re-upload
  // replaces the prior set cleanly (the function clears the cycle first).
  const payload = {
    assessments: assessmentRows,
    items: itemRows,
    participants: partRows,
    responses: respRows,
    result_totals: resultRows,
    topic_rollups: topicRows,
    import_batch: importBatch,
  };
  const { error } = await callRpc(admin, "ingest_persist", {
    p_cycle: cycleId,
    p_payload: payload,
    p_actor: opts.createdBy,
  });
  if (error) throw new Error(`ingest_persist: ${error.message}`);

  return {
    assessments: assessmentRows.length,
    items: itemRows.length,
    participants: partRows.length,
    responses: respRows.length,
  };
}
