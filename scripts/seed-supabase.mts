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
const { ingestCleanResponses } = await import("../lib/server/ingest-write");

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
  const { cleanedResponses, validationReport } = ingestAndClean(rows);
  console.log(`Cleaned ${cleanedResponses.length} responses.`);

  // 3. Year + cycle + owner membership (0005: cycle is the May sitting of 2026).
  const [year] = await insert(admin, "exam_years", { name: "2026", region: "eu-west", created_by: owner.id });
  const [cycle] = await insert(admin, "exam_cycles", {
    name: "May 2026",
    region: "eu-west",
    created_by: owner.id,
    year_id: year!.id,
    sitting: "may",
  });
  const cycleId = cycle!.id;
  await tbl(admin, "exam_cycles").update({ status: "in_review" }).eq("id", cycleId);
  await insert(admin, "memberships", { cycle_id: cycleId, user_id: owner.id, role: "lead_admin" }, "id");
  console.log(`Cycle ${cycleId} created.`);

  // 4. Persist the split assessments/items/participants/responses through the
  //    SHARED raw-export ingest write path (the same one the live Upload step
  //    drives). No duplicated persist logic here.
  const ingestResult = await ingestCleanResponses(admin, cycleId, cleanedResponses, {
    fileRef: "sample_qm_export.xlsx",
    report: validationReport,
    createdBy: owner.id,
  });
  console.log(
    `Ingested ${ingestResult.assessments} assessments, ${ingestResult.items} items, ` +
      `${ingestResult.participants} participants, ${ingestResult.responses} responses.`,
  );

  // 5. Engine write path: item_stats + participant_scores.
  const result = await recomputeAndWrite(admin, cycleId);
  console.log(`Computed: ${result.items} item stats, ${result.scores} participant scores across ${result.assessments} assessments.`);
  console.log(`\nDone. Sign in as ${owner.email} and open the cycle.`);
}

main().catch((e) => {
  console.error("seed:supabase failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
