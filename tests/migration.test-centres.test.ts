/**
 * Migration 0010_test_centres.sql — structural safety guard.
 *
 * The SQL is applied by a human in the Supabase editor, so it can't run in CI.
 * This test instead locks the critical, non-destructive properties of the
 * migration so a careless edit can't silently drop them: the placeholder
 * backfill, the NOT NULL enforced ONLY AFTER the backfill, the centre-scoped
 * year uniqueness, the indexes, the definer-only write model, and the P3 TODO.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0010_test_centres.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0010_test_centres.rollback.sql"), "utf8");

describe("0010_test_centres.sql — structure", () => {
  it("creates the test_centres table with the expected columns", () => {
    expect(SQL).toMatch(/create table if not exists test_centres/i);
    for (const col of ["name", "code", "slug", "active", "region"]) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("adds exam_years.test_centre_id as a FK to test_centres", () => {
    expect(SQL).toMatch(/alter table exam_years add column if not exists test_centre_id uuid references test_centres\(id\)/i);
  });

  it("backfills a placeholder centre BEFORE enforcing NOT NULL (non-destructive)", () => {
    const backfillAt = SQL.search(/update exam_years set test_centre_id/i);
    const notNullAt = SQL.search(/alter column test_centre_id set not null/i);
    expect(backfillAt).toBeGreaterThan(-1);
    expect(notNullAt).toBeGreaterThan(-1);
    // The backfill must precede the NOT NULL, or existing rows would break.
    expect(backfillAt).toBeLessThan(notNullAt);
    // The placeholder centre is created so no existing year is left unassigned.
    expect(SQL).toMatch(/'unassigned'/i);
  });

  it("re-keys year uniqueness on the centre so a year can recur per centre", () => {
    expect(SQL).toMatch(/drop constraint if exists exam_years_name_region_key/i);
    expect(SQL).toMatch(/unique \(name, region, test_centre_id\)/i);
  });

  it("indexes the centre FK and the comparable period field (name)", () => {
    expect(SQL).toMatch(/create index if not exists exam_years_test_centre_id_idx on exam_years \(test_centre_id\)/i);
    expect(SQL).toMatch(/create index if not exists exam_years_name_idx\s+on exam_years \(name\)/i);
  });

  it("keeps writes definer-only and readable by authenticated users (RLS preserved)", () => {
    expect(SQL).toMatch(/alter table test_centres enable row level security/i);
    expect(SQL).toMatch(/create policy test_centres_select on test_centres for select/i);
    expect(SQL).toMatch(/revoke insert, update, delete on test_centres from authenticated, anon/i);
  });

  it("exposes the management RPCs and threads the centre through year/cycle creation", () => {
    expect(SQL).toMatch(/function public\.create_test_centre/i);
    expect(SQL).toMatch(/function public\.update_test_centre/i);
    expect(SQL).toMatch(/function public\.set_test_centre_active/i);
    // create_exam_year / create_cycle_with_assessments gain p_test_centre_id.
    expect(SQL).toMatch(/create_exam_year\([^)]*p_test_centre_id/is);
    expect(SQL).toMatch(/create_cycle_with_assessments\([\s\S]*?p_test_centre_id/i);
  });

  it("leaves a clear P3 TODO to gate management mutations to admins", () => {
    expect(SQL).toMatch(/TODO\(P3\)/);
  });

  it("does NOT touch the scoring/award/cut-score path (scoping change only)", () => {
    expect(SQL).not.toMatch(/participant_scores|score_runs|grade_schemes|item_stats/i);
  });
});

describe("0010_test_centres.rollback.sql — reversibility", () => {
  it("drops the new objects and restores the 0005 function signatures", () => {
    expect(ROLLBACK).toMatch(/drop table if exists test_centres/i);
    expect(ROLLBACK).toMatch(/drop column if exists test_centre_id/i);
    expect(ROLLBACK).toMatch(/add constraint exam_years_name_region_key unique \(name, region\)/i);
    expect(ROLLBACK).toMatch(/function public\.create_exam_year\(\s*p_name text, p_region text/i);
  });
});
