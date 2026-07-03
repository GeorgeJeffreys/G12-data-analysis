/**
 * Migration 0022_delete_reingest_sitting_grain.sql — structural safety guard.
 *
 * The "bring-DB-current for the delete/re-ingest lifecycle" runner must:
 *   (a) re-affirm the 0021 sitting grain idempotently (qm_result_id + the
 *       (item_id, qm_result_id) uniqueness, dropping the old participant-grain key);
 *   (b) re-affirm the clear/delete/reset/clear_cycle_ingest objects at RETURNS
 *       bigint via drop-then-create (so a stale VOID body — the silent no-op that
 *       caused "no change" — is replaced);
 *   (c) re-affirm ingest_persist at the sitting grain (responses INSERT carries
 *       qm_result_id) with the clear-before-insert replace + the cohort guard;
 *   (d) HARDEN schema_health to verify DEFINITIONS not just names — the sitting-grain
 *       constraint and that the delete/clear functions RETURN bigint — and report
 *       migration '0022';
 *   (e) never destructively drop user data, and never touch the scoring engine.
 * (Text assertions — the build environment has no DB, per the RUNBOOK.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0022_delete_reingest_sitting_grain.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0022_delete_reingest_sitting_grain.rollback.sql"), "utf8");

describe("0022 — delete + re-ingest at the sitting grain", () => {
  it("re-affirms the 0021 sitting grain idempotently (add column + swap uniqueness)", () => {
    expect(SQL).toMatch(/alter table responses add column if not exists qm_result_id text/i);
    expect(SQL).toMatch(/drop constraint if exists responses_participant_id_item_id_key/i);
    expect(SQL).toMatch(/add constraint responses_item_id_qm_result_id_key unique \(item_id, qm_result_id\)/i);
  });

  it("makes clear/delete/reset/clear_cycle_ingest RETURN a bigint row count (not void)", () => {
    for (const name of ["clear_sitting_data", "delete_sitting", "reset_cycle_for_reingest"]) {
      const at = SQL.search(new RegExp(`function public\\.${name}`, "i"));
      expect(at, `${name} defined`).toBeGreaterThanOrEqual(0);
      expect(SQL.slice(at, at + 200)).toMatch(/returns bigint/i);
    }
    const cci = SQL.search(/function app\.clear_cycle_ingest/i);
    expect(SQL.slice(cci, cci + 200)).toMatch(/returns bigint/i);
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

  it("re-affirms ingest_persist at the sitting grain — clear-before-insert + qm_result_id + the cohort guard", () => {
    const fn = SQL.slice(SQL.search(/function public\.ingest_persist/i));
    // clear-then-insert replace, scoped to the cycle.
    expect(fn).toMatch(/perform app\.clear_cycle_ingest\(p_cycle\)/i);
    // the responses insert names + selects qm_result_id (the sitting key persists).
    const respInsert = fn.slice(fn.search(/insert into responses/i), fn.search(/insert into responses/i) + 400);
    expect((respInsert.match(/qm_result_id/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // the dropped-sitter guard is retained.
    expect(fn).toMatch(/no attached responses/i);
  });

  it("clear_cycle_ingest clears responses by cycle_id (grain-agnostic, cycle-scoped)", () => {
    const fn = SQL.slice(SQL.search(/function app\.clear_cycle_ingest/i));
    expect(fn).toMatch(/delete from responses where cycle_id = p_cycle/i);
    expect(fn).toMatch(/return v_total/i);
  });

  it("delete_sitting counts across every per-sitting table then cascades, returning the total", () => {
    const del = SQL.slice(SQL.search(/function public\.delete_sitting/i));
    expect(del).toMatch(/app\.cycle_row_count\(p_cycle\)/i);
    expect(del).toMatch(/delete from exam_cycles where id = p_cycle/i);
    expect(del).toMatch(/return v_total/i);
  });

  it("hardens schema_health: verifies the sitting-grain constraint and bigint return types, reports 0022", () => {
    const fn = SQL.slice(SQL.search(/function public\.schema_health/i));
    // sitting key column + the actual grain swap (new key present, old key gone).
    expect(fn).toMatch(/responses\.qm_result_id/);
    expect(fn).toMatch(/responses_item_id_qm_result_id_key/);
    expect(fn).toMatch(/responses_participant_id_item_id_key/);
    // return-type checks — a stale VOID delete must be flagged, not passed as ok.
    expect((fn.match(/prorettype = 'bigint'::regtype/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(fn).toMatch(/delete_sitting/);
    expect(fn).toMatch(/clear_sitting_data/);
    expect(fn).toMatch(/'migration', '0022'/);
  });

  it("does not destructively drop any TABLE or user data", () => {
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).not.toMatch(/drop column/i);
    expect(SQL).not.toMatch(/truncate/i);
  });

  it("does not touch the scoring engine's maths (only the persistence lifecycle)", () => {
    expect(SQL).not.toMatch(/\b(update|insert into)\s+(participant_scores|item_stats|score_runs)\b/i);
  });

  it("rollback restores the 0021 schema_health body and touches nothing destructive", () => {
    expect(ROLLBACK).toMatch(/create or replace function public\.schema_health/i);
    expect(ROLLBACK).toMatch(/'migration', '0021'/);
    expect(ROLLBACK).not.toMatch(/drop table/i);
    expect(ROLLBACK).not.toMatch(/drop column/i);
    expect(ROLLBACK).not.toMatch(/truncate/i);
    // must NOT reintroduce a void delete (the silent no-op this migration kills).
    expect(ROLLBACK).not.toMatch(/returns void/i);
  });
});
