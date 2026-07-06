/**
 * Migration 0026_pipeline_natural_key_spine.sql — structural safety guard.
 *
 * 0026 resets the per-sitting fact tables to a clean natural-key baseline. The SQL
 * is applied by a human in the Supabase editor (no DB in CI), so these text
 * assertions lock the properties that make the model correct:
 *   (a) a first-class `sittings` table keyed by the natural (cycle_id, qm_result_id);
 *   (b) `responses` UNIQUE (cycle_id, qm_result_id, question_id) — the anti-collision key;
 *   (c) FK cascade responses → sittings → cycle (real delete cascade);
 *   (d) ingest_persist = clear-then-write, inserting sittings before its children;
 *   (e) schema_health covers the new schema AND retains the 0025 auth probes, reports '0026';
 *   (f) the scoring engine / grade-bearing tables are NOT touched.
 * The rollback restores the pre-0026 shape and reports '0025'.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0026_pipeline_natural_key_spine.sql"), "utf8");
const ROLLBACK = readFileSync(
  resolve(__dirname, "../supabase/migrations/0026_pipeline_natural_key_spine.rollback.sql"),
  "utf8",
);

describe("0026 — pipeline natural-key spine", () => {
  it("(a) creates a first-class sittings table keyed by the natural (cycle_id, qm_result_id)", () => {
    expect(SQL).toMatch(/create table sittings/i);
    const t = SQL.slice(SQL.search(/create table sittings/i), SQL.search(/create table responses/i));
    expect(t).toMatch(/qm_result_id\s+text not null/i);
    expect(t).toMatch(/participant_email\s+text not null/i);
    expect(t).toMatch(/primary key \(cycle_id, qm_result_id\)/i);
  });

  it("(b) responses are UNIQUE at the natural (cycle_id, qm_result_id, question_id) grain", () => {
    const t = SQL.slice(SQL.search(/create table responses/i), SQL.search(/create table topic_rollups/i));
    expect(t).toMatch(/question_id\s+text not null/i);
    expect(t).toMatch(/unique \(cycle_id, qm_result_id, question_id\)/i);
  });

  it("(c) FK cascade responses → sittings → cycle (real delete cascade)", () => {
    const t = SQL.slice(SQL.search(/create table responses/i), SQL.search(/create table topic_rollups/i));
    expect(t).toMatch(
      /foreign key \(cycle_id, qm_result_id\)\s*references sittings \(cycle_id, qm_result_id\) on delete cascade/i,
    );
    // sittings cascades from the cycle.
    const s = SQL.slice(SQL.search(/create table sittings/i), SQL.search(/create table responses/i));
    expect(s).toMatch(/cycle_id\s+uuid not null references exam_cycles\(id\) on delete cascade/i);
  });

  it("(d) ingest_persist is clear-then-write and inserts sittings before its children", () => {
    const fn = SQL.slice(SQL.search(/function public\.ingest_persist/i), SQL.search(/schema_health/i));
    expect(fn).toMatch(/perform app\.clear_cycle_ingest\(p_cycle\)/i);
    const sittingsAt = fn.search(/insert into sittings/i);
    const responsesAt = fn.search(/insert into responses/i);
    expect(sittingsAt).toBeGreaterThan(-1);
    expect(responsesAt).toBeGreaterThan(sittingsAt); // FK order: parent first
    // The payload key is `sittings`, not the old `result_totals`.
    expect(fn).toMatch(/p_payload->'sittings'/i);
    expect(fn).not.toMatch(/p_payload->'result_totals'/i);
  });

  it("(e) schema_health covers the new schema, retains the 0025 auth probes, reports '0026'", () => {
    expect(SQL).toMatch(/'migration',\s*'0026'/);
    // New pipeline probes.
    expect(SQL).toMatch(/to_regclass\('public\.sittings'\) is null/i);
    expect(SQL).toMatch(/responses_cycle_id_qm_result_id_question_id_key/);
    expect(SQL).toMatch(/confrelid = 'public\.sittings'::regclass and confdeltype = 'c'/i);
    // Retained 0025 auth probes.
    expect(SQL).toMatch(/proname = 'has_role'[\s\S]*cycle_id is null/i);
    expect(SQL).toMatch(/memberships_select'[\s\S]*not ilike '%is_member%'/i);
    // Retained delete lifecycle.
    expect(SQL).toMatch(/delete_sitting'\s*\n?\s*and p\.prorettype = 'bigint'/i);
  });

  it("(f) does not touch the scoring engine / grade-bearing tables", () => {
    // Only the fact tables are dropped.
    expect(SQL).toMatch(/drop table if exists responses/i);
    expect(SQL).not.toMatch(/drop table if exists (participant_scores|item_stats|score_runs|grades|participants|items|assessments)/i);
    expect(SQL).not.toMatch(/update\s+(participant_scores|item_stats|grades)\b/i);
    expect(SQL).not.toMatch(/rename value/i);
  });

  it("rollback restores the pre-0026 shape and reports '0025'", () => {
    expect(ROLLBACK).toMatch(/create table result_totals/i);
    expect(ROLLBACK).toMatch(/unique \(item_id, qm_result_id\)/i);
    expect(ROLLBACK).toMatch(/'migration',\s*'0025'/);
    expect(ROLLBACK).toMatch(/drop table if exists sittings/i);
  });
});
