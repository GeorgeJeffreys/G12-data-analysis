/**
 * Migration 0020_restore_ingest_delete.sql — structural safety guard.
 *
 * The consolidated bring-DB-current runner must: (a) add items.item_set idempotently,
 * (b) re-affirm ingest_persist with item_set + the cohort guard, (c) make clear/
 * delete RETURN a row count (so the UI can confirm the op did something), (d) count
 * across EVERY per-sitting table on delete, (e) ship a schema_health() drift probe,
 * (f) never destructively drop user data, and (g) never touch the scoring engine.
 * These lock it. (Text assertions — the build environment has no DB, per the RUNBOOK.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0020_restore_ingest_delete.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0020_restore_ingest_delete.rollback.sql"), "utf8");

describe("0020 — restore ingest + delete", () => {
  it("adds items.item_set idempotently (the fresh-import blocker)", () => {
    expect(SQL).toMatch(/alter table items add column if not exists item_set text/i);
  });

  it("re-affirms ingest_persist with item_set and the cohort-integrity guard", () => {
    const fn = SQL.slice(SQL.search(/function public\.ingest_persist/i));
    // item_set appears in both the column list and the select of the items insert.
    expect((fn.match(/item_set/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(fn).toMatch(/no attached responses/i); // the dropped-sitter guard
  });

  it("makes clear/delete/reset RETURN a bigint row count (not void)", () => {
    for (const name of ["clear_sitting_data", "delete_sitting", "reset_cycle_for_reingest"]) {
      const fn = SQL.slice(SQL.search(new RegExp(`function public\\.${name}`, "i")));
      expect(fn.slice(0, 200)).toMatch(/returns bigint/i);
    }
    expect(SQL.slice(SQL.search(/function app\.clear_cycle_ingest/i), 200 + SQL.search(/function app\.clear_cycle_ingest/i)))
      .toMatch(/returns bigint/i);
  });

  it("changes return types via drop-then-create (CREATE OR REPLACE can't change a return type)", () => {
    for (const sig of [
      "public.clear_sitting_data(uuid)",
      "public.delete_sitting(uuid)",
      "public.reset_cycle_for_reingest(uuid, uuid)",
      "app.clear_cycle_ingest(uuid)",
    ]) {
      expect(SQL).toContain(`drop function if exists ${sig}`);
    }
  });

  it("delete_sitting counts across EVERY per-sitting table before the cascade", () => {
    // The exhaustive counter names the ingest, engine-output, decision, and config tables.
    for (const t of [
      "assessments", "items", "participants", "responses", "result_totals", "topic_rollups",
      "import_batches", "score_runs", "grades", "clean_exclusions", "grade_schemes",
      "alterations", "essay_marks", "incidents", "incident_rows", "distinction_overrides",
      "document_settings", "memberships", "audit_log",
    ]) {
      expect(SQL).toContain(`'${t}'`);
    }
    // ...and the indirectly-keyed engine outputs (via items / score_runs).
    expect(SQL).toMatch(/item_stats st join items/i);
    expect(SQL).toMatch(/item_reviews ir join items/i);
    expect(SQL).toMatch(/participant_scores ps join score_runs/i);
    // delete_sitting uses the counter and returns the total.
    const del = SQL.slice(SQL.search(/function public\.delete_sitting/i));
    expect(del).toMatch(/app\.cycle_row_count\(p_cycle\)/i);
    expect(del).toMatch(/return v_total/i);
  });

  it("adds a schema_health() drift probe checking item_set + the key functions", () => {
    const fn = SQL.slice(SQL.search(/function public\.schema_health/i));
    expect(fn).toMatch(/items\.item_set/);
    expect(fn).toMatch(/ingest_persist/);
    expect(fn).toMatch(/delete_sitting/);
    expect(fn).toMatch(/clear_sitting_data/);
    expect(fn).toMatch(/'ok'/);
  });

  it("does not destructively drop any TABLE or user data", () => {
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).not.toMatch(/drop column/i);
    expect(SQL).not.toMatch(/truncate/i);
  });

  it("does not touch the scoring engine's maths (only the persistence lifecycle)", () => {
    expect(SQL).not.toMatch(/\b(update|insert into)\s+(participant_scores|item_stats|score_runs)\b/i);
  });

  it("rollback restores void bodies and drops the new probes, but keeps item_set", () => {
    expect(ROLLBACK).toMatch(/drop function if exists public\.schema_health/i);
    expect(ROLLBACK).toMatch(/drop function if exists app\.cycle_row_count/i);
    expect(ROLLBACK).toMatch(/returns void/i);
    // item_set belongs to 0010 and is referenced by ingest_persist — must NOT be dropped.
    expect(ROLLBACK).not.toMatch(/drop column .*item_set/i);
    expect(ROLLBACK).not.toMatch(/alter table items drop/i);
  });
});
