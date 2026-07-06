/**
 * Migration 0029_responses_sitting_qualified_persist.sql — structural safety guard.
 *
 * 0029 brings a drifted deployment current: it re-affirms the sitting-qualified
 * `responses` grain + the guarded `ingest_persist`, and makes a guard-less persist
 * detectable via schema_health. The SQL is applied by a human in the Supabase editor
 * (no DB in CI), so these text assertions lock the properties that make the fix work.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(
  resolve(__dirname, "../supabase/migrations/0029_responses_sitting_qualified_persist.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  resolve(__dirname, "../supabase/migrations/0029_responses_sitting_qualified_persist.rollback.sql"),
  "utf8",
);

describe("0029 — responses sitting-qualified persist", () => {
  it("(a) re-affirms the sitting-qualified unique key and drops the stale non-qualified ones", () => {
    expect(SQL).toMatch(/unique \(cycle_id, qm_result_id, question_id\)/i);
    expect(SQL).toMatch(/drop constraint if exists responses_item_id_qm_result_id_key/i);
    expect(SQL).toMatch(/drop constraint if exists responses_participant_id_item_id_key/i);
  });

  it("(b) ingest_persist inserts sittings before responses and carries the whole-sitting guard", () => {
    const fn = SQL.slice(SQL.search(/function public\.ingest_persist/i), SQL.search(/function public\.schema_health/i));
    const sittingsAt = fn.search(/insert into sittings/i);
    const responsesAt = fn.search(/insert into responses/i);
    expect(sittingsAt).toBeGreaterThan(-1);
    expect(responsesAt).toBeGreaterThan(sittingsAt); // FK order: parent first
    // The responses insert is a plain insert (no ON CONFLICT that could drop a sitting).
    expect(fn).not.toMatch(/insert into responses[\s\S]*?on conflict/i);
    // The whole-sitting completeness guard is present and raises.
    expect(fn).toMatch(/whole-sitting drop/i);
    expect(fn).toMatch(/raise exception[\s\S]*whole-sitting drop/i);
  });

  it("(c) schema_health probes the LIVE ingest_persist body for the guard, reports '0029'", () => {
    expect(SQL).toMatch(/'migration',\s*'0029'/);
    // Not just "a function named ingest_persist exists" — its BODY must carry the guard.
    expect(SQL).toMatch(/pg_get_functiondef\(p\.oid\) ilike '%whole-sitting drop%'/i);
    expect(SQL).toMatch(/ingest_persist:whole-sitting guard/i);
    // Retains the 0026/0028 grain + auth probes.
    expect(SQL).toMatch(/responses_cycle_id_qm_result_id_question_id_key/);
    expect(SQL).toMatch(/topic_rollups_cycle_id_qm_result_id_qm_topic_id_key/);
    expect(SQL).toMatch(/proname = 'has_role'[\s\S]*cycle_id is null/i);
  });

  it("(d) is functions + constraints only — no data drop / row mutation", () => {
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).not.toMatch(/delete from/i);
    expect(SQL).not.toMatch(/update\s+(participant_scores|item_stats|grades|responses|sittings)\b/i);
  });

  it("rollback restores the 0028 schema_health (reports '0028')", () => {
    expect(ROLLBACK).toMatch(/create or replace function public\.schema_health/i);
    expect(ROLLBACK).toMatch(/'migration',\s*'0028'/);
  });
});
