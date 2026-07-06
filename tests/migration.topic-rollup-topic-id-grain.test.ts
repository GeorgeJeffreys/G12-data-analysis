/**
 * Migration 0028_topic_rollup_topic_id_grain.sql — structural safety guard.
 *
 * 0026 rebuilt topic_rollups with UNIQUE (cycle_id, qm_result_id, topic_name),
 * silently reversing the 0007 fix: distinct QM topics (different TopicId +
 * TopicPath) that share a leaf display name within one result then collide on a
 * fresh 700435 ingest. 0028 puts the uniqueness back on the TopicId. The SQL is
 * applied by a human in the Supabase editor (no DB in CI), so these text
 * assertions lock the properties that make the fix correct.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(
  resolve(__dirname, "../supabase/migrations/0028_topic_rollup_topic_id_grain.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  resolve(__dirname, "../supabase/migrations/0028_topic_rollup_topic_id_grain.rollback.sql"),
  "utf8",
);

describe("0028 — topic rollup TopicId grain", () => {
  it("(a) drops the 0026 name-based topic key", () => {
    expect(SQL).toMatch(
      /drop constraint if exists topic_rollups_cycle_id_qm_result_id_topic_name_key/i,
    );
  });

  it("(b) adds the TopicId-based unique key (cycle_id, qm_result_id, qm_topic_id)", () => {
    expect(SQL).toMatch(/topic_rollups_cycle_id_qm_result_id_qm_topic_id_key/);
    expect(SQL).toMatch(/unique \(cycle_id, qm_result_id, qm_topic_id\)/i);
  });

  it("(c) schema_health probes the new key, flags the stale one, reports '0028'", () => {
    expect(SQL).toMatch(/'migration',\s*'0028'/);
    expect(SQL).toMatch(/topic_rollups:unique\(cycle_id,qm_result_id,qm_topic_id\)/);
    expect(SQL).toMatch(/topic_rollups:stale-unique\(cycle_id,qm_result_id,topic_name\)/);
    // Retains the 0026 pipeline + auth probes (the spine key + workspace-scoped auth).
    expect(SQL).toMatch(/responses_cycle_id_qm_result_id_question_id_key/);
    expect(SQL).toMatch(/proname = 'has_role'[\s\S]*cycle_id is null/i);
  });

  it("(d) is a constraint swap only — no data drop / row mutation / engine touch", () => {
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).not.toMatch(/delete from/i);
    expect(SQL).not.toMatch(/update\s+(participant_scores|item_stats|grades|responses)\b/i);
  });

  it("rollback restores the name key and reports '0026'", () => {
    expect(ROLLBACK).toMatch(
      /drop constraint if exists topic_rollups_cycle_id_qm_result_id_qm_topic_id_key/i,
    );
    expect(ROLLBACK).toMatch(/unique \(cycle_id, qm_result_id, topic_name\)/i);
    expect(ROLLBACK).toMatch(/'migration',\s*'0026'/);
  });
});
