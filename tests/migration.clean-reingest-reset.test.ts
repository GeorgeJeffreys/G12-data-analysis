/**
 * Migration 0018_clean_reingest_reset.sql — structural safety guard.
 *
 * The reset must (a) work in the Supabase SQL editor (no `auth.uid()` dependency),
 * (b) fully clear a cycle's ingested AND materialised rows so no stale score
 * survives, (c) keep `clean_exclusions` (they re-resolve by stable key on
 * re-ingest), and (d) never touch the parity-locked scoring engine. These lock it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0018_clean_reingest_reset.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0018_clean_reingest_reset.rollback.sql"), "utf8");

describe("0018 — clean re-ingest reset", () => {
  it("adds an SQL-editor-runnable reset that does not depend on auth.uid()", () => {
    const body = SQL.slice(SQL.search(/function public\.reset_cycle_for_reingest/i));
    const head = body.slice(0, 700);
    expect(head).toMatch(/p_actor uuid default null/i);
    // Authorisation is NOT via auth.uid()/has_role (would fail in the SQL editor).
    expect(head).not.toMatch(/auth\.uid\(\)/i);
    expect(head).not.toMatch(/has_role/i);
    expect(head).toMatch(/perform app\.clear_cycle_ingest\(p_cycle\)/i);
    expect(head).toMatch(/status\s*=\s*'draft'/i);
  });

  it("hardens clear_cycle_ingest to remove the engine outputs explicitly", () => {
    const body = SQL.slice(SQL.search(/function app\.clear_cycle_ingest/i));
    const head = body.slice(0, 900);
    expect(head).toMatch(/delete from participant_scores/i);
    expect(head).toMatch(/delete from score_runs/i);
    expect(head).toMatch(/delete from item_stats/i);
    expect(head).toMatch(/delete from grades/i);
  });

  it("keeps clean_exclusions (manual cohort removals survive re-ingest)", () => {
    const clear = SQL.slice(
      SQL.search(/function app\.clear_cycle_ingest/i),
      SQL.search(/function public\.reset_cycle_for_reingest/i),
    );
    expect(clear).not.toMatch(/delete from clean_exclusions/i);
  });

  it("grants the reset to service_role only (not public)", () => {
    expect(SQL).toMatch(/revoke all on function public\.reset_cycle_for_reingest/i);
    expect(SQL).toMatch(/grant execute on function public\.reset_cycle_for_reingest\([^)]*\) to service_role/i);
  });

  it("does not touch the scoring engine's maths (only the persistence lifecycle)", () => {
    // It deletes engine OUTPUT rows (lifecycle) but never writes/updates scores.
    expect(SQL).not.toMatch(/\b(update|insert into)\s+(participant_scores|item_stats|score_runs)\b/i);
  });

  it("rollback drops the reset and restores the cascade-only clear", () => {
    expect(ROLLBACK).toMatch(/drop function if exists public\.reset_cycle_for_reingest/i);
    expect(ROLLBACK).toMatch(/create or replace function app\.clear_cycle_ingest/i);
  });
});
