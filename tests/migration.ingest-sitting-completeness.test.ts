/**
 * Migration 0023_ingest_sitting_completeness.sql — structural safety guard.
 *
 * 0023 hardens the persist against the whole-sitting drop (task 19). It must:
 *   (a) re-affirm `ingest_persist` at the 0021/0022 sitting grain (clear-then-insert,
 *       responses INSERT carries qm_result_id) — unchanged from 0022;
 *   (b) ADD a SITTING-grain roster↔responses guard: a sitting present in one of
 *       responses / result_totals but not the other must raise inside the persist
 *       transaction (which rolls back whole), so a short cohort is never persisted;
 *   (c) retain the 0022 (assessment, participant) roster guard;
 *   (d) bump schema_health to report '0023' (probe surface otherwise unchanged);
 *   (e) make NO table / column / constraint change, and never touch the engine.
 * The rollback restores the 0022 bodies (no sitting-grain guard, reports '0022').
 * (Text assertions — the build environment has no DB, per the RUNBOOK.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0023_ingest_sitting_completeness.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0023_ingest_sitting_completeness.rollback.sql"), "utf8");

describe("0023 — ingest sitting-completeness guard", () => {
  it("re-affirms ingest_persist at the sitting grain (clear-before-insert + qm_result_id)", () => {
    const fn = SQL.slice(SQL.search(/function public\.ingest_persist/i));
    expect(fn).toMatch(/perform app\.clear_cycle_ingest\(p_cycle\)/i);
    expect(fn).toMatch(/insert into responses[\s\S]*qm_result_id/i);
    expect(fn).toMatch(/insert into result_totals[\s\S]*qm_result_id/i);
  });

  it("retains the 0022 (assessment, participant) roster guard", () => {
    // The original guard message + its (assessment_id, participant_id) shape.
    expect(SQL).toMatch(/roster sitter\(s\) have no attached responses/i);
    expect(SQL).toMatch(/select distinct assessment_id, participant_id\s+from result_totals/i);
  });

  it("ADDS a bidirectional SITTING-grain completeness guard on qm_result_id", () => {
    const fn = SQL.slice(SQL.search(/function public\.ingest_persist/i));
    // Compares distinct qm_result_id across responses and result_totals, both ways.
    expect(fn).toMatch(/distinct qm_result_id from result_totals/i);
    expect(fn).toMatch(/distinct qm_result_id from responses/i);
    expect(fn).toMatch(/result_totals without responses/i);
    expect(fn).toMatch(/responses without result_totals/i);
    // Raises when a sitting is missing on either side (whole-sitting drop).
    expect(fn).toMatch(/raise exception[\s\S]*whole-sitting drop/i);
  });

  it("bumps schema_health to report migration '0023'", () => {
    expect(SQL).toMatch(/'migration',\s*'0023'/);
    // …and still probes the sitting-grain constraint from 0021/0022.
    expect(SQL).toMatch(/responses_item_id_qm_result_id_key/);
    expect(SQL).toMatch(/responses_participant_id_item_id_key/);
  });

  it("makes NO destructive schema change and does not touch the scoring engine", () => {
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).not.toMatch(/alter table .*drop column/i);
    expect(SQL).not.toMatch(/truncate/i);
    // Ingest/persist only — never the parity-locked engine tables.
    expect(SQL).not.toMatch(/participant_scores|item_stats|score_runs/i);
  });

  it("is wrapped in a single transaction (atomic apply)", () => {
    expect(SQL.trimStart()).toMatch(/^--[\s\S]*\bbegin;/i);
    expect(SQL).toMatch(/\bcommit;\s*$|\bcommit;\s*--/i);
  });

  it("rollback restores the 0022 bodies (no sitting-grain guard, reports '0022')", () => {
    expect(ROLLBACK).toMatch(/function public\.ingest_persist/i);
    expect(ROLLBACK).toMatch(/roster sitter\(s\) have no attached responses/i);
    // The 0023-only guard must be GONE in the rollback.
    expect(ROLLBACK).not.toMatch(/whole-sitting drop/i);
    expect(ROLLBACK).not.toMatch(/result_totals without responses/i);
    expect(ROLLBACK).toMatch(/'migration',\s*'0022'/);
  });
});
