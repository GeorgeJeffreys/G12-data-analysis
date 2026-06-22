import "server-only";

/**
 * Server-side raw-export ingest write path.
 *
 * Persists a cleaned, split combined export (the per-subject assessments, their
 * items, the participants, and the long-format response matrix the engine
 * consumes) into Supabase. Like the engine write path (engine-write.ts) these
 * tables are not client-writable (`assessments.status`, `items.status`, the
 * immutable `responses` facts), so the writes go through the secret-key admin
 * client, which bypasses RLS and is the sanctioned privileged writer. The HTTP
 * route in front of this authorizes the caller as a lead_admin of the cycle via
 * the RLS-scoped session client before handing over.
 *
 * This is a full REPLACE of the cycle's data set: re-uploading a corrected export
 * clears the prior assessments/items/participants/responses for the cycle and
 * re-ingests, so the stored data always matches the latest upload. Ingest is the
 * first pipeline stage, so there is no downstream scored/graded data to preserve.
 *
 * The engine is untouched — this only persists the same response-matrix shape the
 * engine already reads; recompute (item_stats/participant_scores) runs afterwards
 * through the existing engine write path.
 */
import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import type { CleanResponse } from "@/lib/ingest/types";
import type { ValidationReport } from "@/lib/ingest/types";
import type { CanonicalModel } from "@/lib/ingest/qm";

type Admin = SupabaseAdminClient;

interface LooseTable {
  insert(rows: unknown): {
    select(c?: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  } & PromiseLike<{ error: { message: string } | null; data: unknown }>;
  delete(): { eq(col: string, val: string): Promise<{ error: { message: string } | null }> };
}
function table(admin: Admin, name: string): LooseTable {
  return (admin.from as unknown as (n: string) => LooseTable)(name);
}

async function insertReturning<T>(admin: Admin, name: string, rows: unknown, returning: string): Promise<T[]> {
  const { data, error } = await table(admin, name).insert(rows).select(returning);
  if (error) throw new Error(`insert ${name}: ${error.message}`);
  return (data ?? []) as T[];
}
async function insertMany(admin: Admin, name: string, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  for (const chunk of chunks(rows, 1000)) {
    const { error } = await table(admin, name).insert(chunk);
    if (error) throw new Error(`insert ${name}: ${error.message}`);
  }
}
function* chunks<T>(arr: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

export interface IngestWriteResult {
  assessments: number;
  items: number;
  participants: number;
  responses: number;
}

export interface IngestWriteOptions {
  /**
   * Authenticated user id recorded as `import_batches.created_by` (audit column).
   * REQUIRED: this write goes through the secret-key admin client, which has no
   * session, so the `auth.uid()` column default always resolves to null and would
   * violate the NOT NULL constraint. The caller resolves the user from the
   * session-aware server client and passes it explicitly.
   */
  createdBy: string;
  /** File name / reference recorded on the import_batches row. */
  fileRef?: string;
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
 * Persist cleaned responses for a cycle (full replace). Returns row counts.
 * Throws on any write error so the caller can surface it.
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

  // ── 1. Clear any prior data for this cycle (FK-safe order) ────────────────
  // result_totals/topic_rollups → responses → items (cascades item_stats/
  // item_reviews) → participants (cascades participant_scores/grades) →
  // assessments (cascades score_runs).
  for (const t of ["result_totals", "topic_rollups", "responses", "items", "participants", "assessments"]) {
    const { error } = await table(admin, t).delete().eq("cycle_id", cycleId);
    if (error) throw new Error(`clear ${t}: ${error.message}`);
  }

  // ── 2. Assessments (distinct, in first-appearance order) ──────────────────
  const assessmentNames: string[] = [];
  for (const r of recs) if (!assessmentNames.includes(r.assessmentName)) assessmentNames.push(r.assessmentName);
  const assessmentId = new Map<string, string>();
  for (const name of assessmentNames) {
    const itemCount = new Set(recs.filter((r) => r.assessmentName === name).map((r) => r.qmQuestionId)).size;
    const subj = subjectByName.get(name);
    const [a] = await insertReturning<{ id: string }>(
      admin,
      "assessments",
      {
        cycle_id: cycleId,
        name,
        item_count: itemCount,
        // Richer intake (0006): QM subject max + sitting tag, when available.
        qm_max_score: subj?.qmMaximumScore ?? null,
        sitting: canonical?.sitting?.code ?? null,
      },
      "id",
    );
    if (a) assessmentId.set(name, a.id);
  }

  // ── 3. Items (distinct per assessment) ────────────────────────────────────
  // Canonical item metadata (type / status / topic) keyed by `${subject}|${qid}`.
  const canonItem = new Map(canonical?.items.map((it) => [`${it.subject}|${it.questionId}`, it]) ?? []);
  const itemId = new Map<string, string>(); // `${assessment}|${qmQuestionId}` → uuid
  const itemRows: Record<string, unknown>[] = [];
  const seenItem = new Set<string>();
  for (const r of recs) {
    const key = `${r.assessmentName}|${r.qmQuestionId}`;
    if (seenItem.has(key)) continue;
    seenItem.add(key);
    const ci = canonItem.get(key);
    itemRows.push({
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
  const assessmentNameById = new Map([...assessmentId.entries()].map(([n, id]) => [id, n]));
  for (const chunk of chunks(itemRows, 500)) {
    const inserted = await insertReturning<{ id: string; qm_question_id: string; assessment_id: string }>(
      admin,
      "items",
      chunk,
      "id,qm_question_id,assessment_id",
    );
    for (const it of inserted) {
      const name = assessmentNameById.get(it.assessment_id);
      if (name) itemId.set(`${name}|${it.qm_question_id}`, it.id);
    }
  }

  // ── 4. Participants (distinct) — retain every personal field ──────────────
  // Canonical participant by email (lowercased), to enrich the personal fields.
  const canonPart = new Map(canonical?.participants.map((p) => [p.email, p]) ?? []);
  const participantId = new Map<string, string>(); // qmParticipantId → uuid
  const emailToParticipantId = new Map<string, string>(); // lowercased email → uuid
  const partRows: Record<string, unknown>[] = [];
  const seenPart = new Set<string>();
  for (const r of recs) {
    if (seenPart.has(r.qmParticipantId)) continue;
    seenPart.add(r.qmParticipantId);
    const cp = canonPart.get(r.qmParticipantId.toLowerCase());
    partRows.push({
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
  for (const chunk of chunks(partRows, 500)) {
    const inserted = await insertReturning<{ id: string; qm_participant_id: string }>(
      admin,
      "participants",
      chunk,
      "id,qm_participant_id",
    );
    for (const p of inserted) {
      participantId.set(p.qm_participant_id, p.id);
      emailToParticipantId.set(p.qm_participant_id.toLowerCase(), p.id);
    }
  }

  // ── 5. Responses (long-format facts; dedupe to keep the unique(participant,item)) ──
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
  await insertMany(admin, "responses", respRows);

  // ── 5b. Richer intake (0006): per-result QM totals + per-topic rollups ────
  // These hold QM's TRUSTED totals across EVERY question type (essays/Likert/…),
  // not just the MCQ engine matrix above. Written only when a canonical model is
  // supplied; results whose participant/subject didn't map are skipped silently.
  if (canonical) {
    const resultRows: Record<string, unknown>[] = [];
    const topicRows: Record<string, unknown>[] = [];
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
          qm_topic_id: t.topicId,
          topic_name: t.name,
          topic_path: t.path,
          score: t.score,
          maximum_score: t.maximumScore,
          percentage_score: t.percentageScore,
          question_count: t.questionCount,
        });
      }
    }
    await insertMany(admin, "result_totals", resultRows);
    await insertMany(admin, "topic_rollups", topicRows);
  }

  // ── 6. Import batch (file refs + validation report; read back on refresh) ──
  const { error: batchErr } = await table(admin, "import_batches").insert({
    cycle_id: cycleId,
    file_ref: opts.fileRef ?? opts.files?.assessments ?? null,
    parsed_rows: opts.report?.stats.rawRows ?? recs.length,
    validation_passed: opts.report?.passed ?? true,
    report_json: opts.report ?? null,
    // Richer intake (0006): the three source filenames + reconciliation summary.
    items_file: opts.files?.items ?? null,
    assessments_file: opts.files?.assessments ?? null,
    topics_file: opts.files?.topics ?? null,
    results_total: canonical?.integrity.resultsChecked ?? null,
    results_reconciled: canonical?.integrity.reconciled ?? null,
    // Explicit — the service client has no auth.uid() to default from (NOT NULL).
    created_by: opts.createdBy,
  });
  if (batchErr) throw new Error(`insert import_batches: ${batchErr.message}`);

  return {
    assessments: assessmentNames.length,
    items: itemRows.length,
    participants: partRows.length,
    responses: respRows.length,
  };
}
