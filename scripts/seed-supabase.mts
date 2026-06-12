/**
 * Seed the live Supabase database with the sample cycle.
 *
 * Runs the REAL ingest + engine over data/sample_qm_export.xlsx and inserts the
 * sample cycle (cycle, assessments, items, participants, responses) via the
 * secret-key admin client, then persists item_stats + participant_scores through
 * the shared server-side engine write path — so the deployed app has a working
 * demo cycle to open.
 *
 * Run:  npm run seed:supabase
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY, and at
 * least one Supabase auth user to own the cycle (set SEED_OWNER_EMAIL to choose,
 * otherwise the first user is used). The owner is given a lead_admin membership
 * so they can open the cycle through RLS.
 *
 * Idempotency: re-running inserts ANOTHER cycle. Delete prior demo cycles in the
 * dashboard (or by id) if you want a single clean copy.
 */
import { readFileSync, existsSync } from "node:fs";

// ── load .env.local (dependency-free) ───────────────────────────────────────
function loadEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const { parseExport, ingestAndClean } = await import("../lib/ingest/index");
const { createAdminClient } = await import("../lib/supabase/admin");
const { recomputeAndWrite } = await import("../lib/server/engine-write");
type CleanResponse = import("../lib/ingest/types").CleanResponse;

// Loose table accessor (the typed client marks decision tables non-insertable).
function tbl(admin: ReturnType<typeof createAdminClient>, name: string) {
  return (admin.from as unknown as (n: string) => {
    insert(rows: unknown): { select(c?: string): PromiseLike<{ data: unknown; error: { message: string } | null }> } & PromiseLike<{ data: unknown; error: { message: string } | null }>;
    update(v: unknown): { eq(c: string, val: string): Promise<{ error: { message: string } | null }> };
  })(name);
}
async function insert<T = { id: string }>(admin: ReturnType<typeof createAdminClient>, name: string, rows: unknown, returning = "id"): Promise<T[]> {
  const { data, error } = await tbl(admin, name).insert(rows).select(returning);
  if (error) throw new Error(`insert ${name}: ${error.message}`);
  return (data ?? []) as T[];
}

async function main() {
  const admin = createAdminClient();

  // 1. Owner (a real auth user). Created in the dashboard beforehand.
  const wanted = process.env.SEED_OWNER_EMAIL;
  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);
  const users = (list.users ?? []) as { id: string; email?: string }[];
  const owner = wanted ? users.find((u) => u.email === wanted) : users[0];
  if (!owner) {
    throw new Error(
      "No Supabase auth user found to own the cycle. Create one (Dashboard → Authentication → Users), " +
        "optionally set SEED_OWNER_EMAIL, then re-run.",
    );
  }
  console.log(`Owner: ${owner.email} (${owner.id})`);

  // 2. Ingest + clean the sample export.
  const file = readFileSync("data/sample_qm_export.xlsx");
  const { rows } = parseExport(file);
  const { cleanedResponses } = ingestAndClean(rows);
  const recs = cleanedResponses as CleanResponse[];
  console.log(`Cleaned ${recs.length} responses.`);

  // 3. Cycle + owner membership.
  const [cycle] = await insert(admin, "exam_cycles", { name: "May 2026", region: "eu-west", created_by: owner.id });
  const cycleId = cycle!.id;
  await tbl(admin, "exam_cycles").update({ status: "in_review" }).eq("id", cycleId);
  await insert(admin, "memberships", { cycle_id: cycleId, user_id: owner.id, role: "lead_admin" }, "id");
  console.log(`Cycle ${cycleId} created.`);

  // 4. Assessments.
  const assessmentNames = [...new Set(recs.map((r) => r.assessmentName))];
  const assessmentId = new Map<string, string>();
  for (const name of assessmentNames) {
    const count = new Set(recs.filter((r) => r.assessmentName === name).map((r) => r.qmQuestionId)).size;
    const [a] = await insert(admin, "assessments", { cycle_id: cycleId, name, item_count: count });
    assessmentId.set(name, a!.id);
  }

  // 5. Items (distinct per assessment).
  const itemId = new Map<string, string>(); // `${assessment}|${qmQuestionId}` → uuid
  const itemRows: Record<string, unknown>[] = [];
  const seenItem = new Set<string>();
  for (const r of recs) {
    const key = `${r.assessmentName}|${r.qmQuestionId}`;
    if (seenItem.has(key)) continue;
    seenItem.add(key);
    itemRows.push({
      cycle_id: cycleId,
      assessment_id: assessmentId.get(r.assessmentName),
      qm_question_id: r.qmQuestionId,
      wording: r.wording,
      major_element: r.majorElement,
      sub_element: r.subElement,
      demand_level: r.demandLevel,
      max_score: r.maxScore ?? 1,
    });
  }
  for (const chunk of chunks(itemRows, 500)) {
    const inserted = await insert<{ id: string; qm_question_id: string; assessment_id: string }>(admin, "items", chunk, "id,qm_question_id,assessment_id");
    for (const it of inserted) {
      const name = [...assessmentId.entries()].find(([, v]) => v === it.assessment_id)?.[0];
      itemId.set(`${name}|${it.qm_question_id}`, it.id);
    }
  }
  console.log(`Inserted ${itemRows.length} items.`);

  // 6. Participants (distinct).
  const participantId = new Map<string, string>(); // qmParticipantId → uuid
  const partRows: Record<string, unknown>[] = [];
  const seenPart = new Set<string>();
  for (const r of recs) {
    if (seenPart.has(r.qmParticipantId)) continue;
    seenPart.add(r.qmParticipantId);
    partRows.push({ cycle_id: cycleId, qm_participant_id: r.qmParticipantId, pseudonym_id: r.participantPseudonym });
  }
  for (const chunk of chunks(partRows, 500)) {
    const inserted = await insert<{ id: string; qm_participant_id: string }>(admin, "participants", chunk, "id,qm_participant_id");
    for (const p of inserted) participantId.set(p.qm_participant_id, p.id);
  }
  console.log(`Inserted ${partRows.length} participants.`);

  // 7. Responses (bulk, chunked).
  const respRows = recs.map((r) => ({
    cycle_id: cycleId,
    participant_id: participantId.get(r.qmParticipantId),
    item_id: itemId.get(`${r.assessmentName}|${r.qmQuestionId}`),
    answer_given: r.answerGiven,
    answer_score: r.answerScore,
    response_time: r.responseTime,
    result_status: r.resultStatus,
  }));
  let inserted = 0;
  for (const chunk of chunks(respRows, 1000)) {
    await insert(admin, "responses", chunk, "id");
    inserted += chunk.length;
    process.stdout.write(`\r  responses: ${inserted}/${respRows.length}`);
  }
  process.stdout.write("\n");

  // 8. Engine write path: item_stats + participant_scores.
  const result = await recomputeAndWrite(admin, cycleId);
  console.log(`Computed: ${result.items} item stats, ${result.scores} participant scores across ${result.assessments} assessments.`);
  console.log(`\nDone. Sign in as ${owner.email} and open the cycle.`);
}

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

main().catch((e) => {
  console.error("seed:supabase failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
