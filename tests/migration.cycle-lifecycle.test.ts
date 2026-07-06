/**
 * Migration 0031_cycle_lifecycle_date_delete.sql — structural safety guard.
 *
 * 0031 carries the sitting DATE through create_cycle_with_assessments and adds a
 * cycle-level DELETE that reuses the sitting-delete cascade, admin-gated + audited,
 * with a last-cycle guard. The SQL is applied by a human in the Supabase editor (no
 * DB in CI), so these text assertions lock the properties that make it correct.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(
  resolve(__dirname, "../supabase/migrations/0031_cycle_lifecycle_date_delete.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  resolve(__dirname, "../supabase/migrations/0031_cycle_lifecycle_date_delete.rollback.sql"),
  "utf8",
);

describe("0031 — cycle lifecycle (sitting date + delete cycle)", () => {
  it("(a) adds a nullable exam_cycles.sitting_date column, idempotently", () => {
    expect(SQL).toMatch(/alter table exam_cycles add column if not exists sitting_date date/i);
  });

  it("(b) create_cycle_with_assessments gains p_sitting_date and persists it", () => {
    // The prior 6-arg signature is dropped so the 7-arg one is unambiguous.
    expect(SQL).toMatch(/drop function if exists public\.create_cycle_with_assessments\(text, text, jsonb, uuid, sitting_period, uuid\)/i);
    expect(SQL).toMatch(/p_sitting_date date default null/i);
    // The insert carries the date.
    const fn = SQL.slice(SQL.search(/function public\.create_cycle_with_assessments/i));
    expect(fn).toMatch(/insert into exam_cycles \([^)]*sitting_date[^)]*\)/i);
    expect(fn).toMatch(/values \([\s\S]*?p_sitting_date[\s\S]*?\)/i);
  });

  it("(c) delete_cycle reuses the cascade, is admin-gated, audited, and guards the last cycle", () => {
    const fn = SQL.slice(SQL.search(/function public\.delete_cycle/i), SQL.search(/function public\.schema_health/i));
    expect(fn).toMatch(/app\.has_role\(p_cycle, array\['lead_admin'\]::member_role\[\]\)/i); // admin gate via C1 primitive
    expect(fn).toMatch(/app\.cycle_row_count\(p_cycle\)/i);                                   // reuse the exhaustive count
    expect(fn).toMatch(/last remaining cycle/i);                                              // last-cycle guard
    expect(fn).toMatch(/perform app\.audit\(null,\s*'delete'/i);                              // audited (workspace level)
    expect(fn).toMatch(/delete from exam_cycles where id = p_cycle/i);                        // the cascade delete
  });

  it("(d) grants delete_cycle + the 7-arg create to authenticated (not public)", () => {
    expect(SQL).toMatch(/revoke all on function public\.delete_cycle\(uuid\) from public/i);
    expect(SQL).toMatch(/grant execute on function public\.delete_cycle\(uuid\) to authenticated/i);
    expect(SQL).toMatch(/create_cycle_with_assessments\(text, text, jsonb, uuid, sitting_period, uuid, date\)\s*\n?\s*to authenticated/i);
  });

  it("(e) schema_health reports '0031' and probes the new column + function", () => {
    expect(SQL).toMatch(/'migration', '0031'/);
    expect(SQL).toMatch(/exam_cycles\.sitting_date/);
    expect(SQL).toMatch(/public\.delete_cycle\(\)->bigint/);
    // Retains the 0030 per-subject guard probe (no regression of the collapse guard).
    expect(SQL).toMatch(/per-subject sitting-count guard/i);
  });

  it("(f) rollback drops delete_cycle and restores the 6-arg create", () => {
    expect(ROLLBACK).toMatch(/drop function if exists public\.delete_cycle\(uuid\)/i);
    expect(ROLLBACK).toMatch(/drop function if exists public\.create_cycle_with_assessments\(text, text, jsonb, uuid, sitting_period, uuid, date\)/i);
    expect(ROLLBACK).toMatch(/create or replace function\s+public\.create_cycle_with_assessments\(/i);
  });
});
