/**
 * Migration 0013_test_centre_admin_management.sql — structural safety guard.
 *
 * The SQL is applied by a human in the Supabase editor, so it can't run in CI.
 * This test locks the properties P1b depends on: the centre-management mutations
 * are now admin-gated SERVER-SIDE (closing 0010's TODO P3), a new audited
 * reassignment RPC exists, the reassignment is a single non-recomputing UPDATE
 * that respects the centre-scoped uniqueness with a FRIENDLY conflict, and the
 * grants/rollback stay consistent. A careless edit that drops any of these fails
 * here rather than silently weakening the data layer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0013_test_centre_admin_management.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0013_test_centre_admin_management.rollback.sql"), "utf8");

/** Body of `create or replace function public.<name>(...) ... $$` up to the
 *  closing `$$;` — used to assert a property holds INSIDE a specific RPC. */
function fnBody(name: string): string {
  const start = SQL.search(new RegExp(`create or replace function public\\.${name}\\b`, "i"));
  expect(start, `function ${name} not found`).toBeGreaterThan(-1);
  const end = SQL.indexOf("$$;", start);
  expect(end, `function ${name} not terminated`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

const ADMIN_GUARD = /if not app\.is_workspace_admin\(\) then raise exception 'not authorized'/i;

describe("0013 — every management mutation is admin-gated server-side", () => {
  for (const fn of ["create_test_centre", "update_test_centre", "set_test_centre_active", "move_exam_year_to_centre"]) {
    it(`${fn} rejects a non-admin at the data layer (app.is_workspace_admin)`, () => {
      expect(fnBody(fn)).toMatch(ADMIN_GUARD);
    });
  }

  it("closes 0010's TODO(P3): the gate is not deferred to the client", () => {
    // Four guarded functions — the gate lives in the SQL, not the UI.
    const guards = SQL.match(/app\.is_workspace_admin\(\)/gi) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(4);
  });
});

describe("0013 — move_exam_year_to_centre", () => {
  const move = fnBody("move_exam_year_to_centre");

  it("is a SINGLE update of the partition key — no engine recompute, no grade tables", () => {
    expect(move).toMatch(/update exam_years set test_centre_id = p_test_centre_id/i);
    // Touches nothing grade-bearing: not exam_cycles/results/responses/scores/grades/item_stats.
    expect(move).not.toMatch(/\b(exam_cycles|results|responses|participant_scores|score_runs|item_stats|grades|write_scores|write_item_stats)\b/i);
  });

  it("respects unique (name, region, centre) with a FRIENDLY conflict (no raw unique_violation)", () => {
    expect(move).toMatch(/exception when unique_violation then/i);
    expect(move).toMatch(/already has a % year/i);
  });

  it("writes an audit row capturing the before/after centre", () => {
    expect(move).toMatch(/app\.audit\(\s*null,\s*'move',\s*'exam_year'/i);
    expect(move).toMatch(/to_jsonb\(y_before\)/i);
    expect(move).toMatch(/to_jsonb\(y_after\)/i);
  });

  it("is idempotent: moving to the current centre is a no-op", () => {
    expect(move).toMatch(/if y_before\.test_centre_id = p_test_centre_id then\s*\n?\s*return y_before/i);
  });

  it("validates the year and the target centre exist", () => {
    expect(move).toMatch(/raise exception 'exam year not found'/i);
    expect(move).toMatch(/raise exception 'test centre not found'/i);
  });
});

describe("0013 — grants & idempotency", () => {
  it("grants the new RPC and re-grants the redefined ones to authenticated", () => {
    expect(SQL).toMatch(/grant execute on function public\.move_exam_year_to_centre\(uuid, uuid\)\s+to authenticated/i);
    expect(SQL).toMatch(/grant execute on function public\.create_test_centre\(text, text, text, text\)\s+to authenticated/i);
  });

  it("is forward-only & re-runnable: every function is create or replace, no table DDL", () => {
    expect(SQL).toMatch(/create or replace function public\.move_exam_year_to_centre/i);
    // A management-RPC migration must not alter the schema shape.
    expect(SQL).not.toMatch(/\b(create table|alter table|drop table|add column|drop column)\b/i);
  });
});

describe("0013_test_centre_admin_management.rollback.sql — reversibility", () => {
  it("drops the move RPC and restores the 0010 (ungated) management RPCs", () => {
    expect(ROLLBACK).toMatch(/drop function if exists public\.move_exam_year_to_centre\(uuid, uuid\)/i);
    expect(ROLLBACK).toMatch(/create or replace function public\.create_test_centre/i);
    expect(ROLLBACK).toMatch(/create or replace function public\.set_test_centre_active/i);
    // The restored versions must NOT carry the admin gate (that's the point of reverting).
    expect(ROLLBACK).not.toMatch(/is_workspace_admin/i);
  });

  it("documents that the revert is data-safe (functions only, no data unwind)", () => {
    expect(ROLLBACK).toMatch(/no data is affected/i);
  });
});
