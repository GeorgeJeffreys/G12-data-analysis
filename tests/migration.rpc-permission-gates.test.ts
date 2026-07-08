/**
 * Migration 0037_rpc_permission_gates.sql — structural safety guard.
 *
 * The SQL is applied by a human in the Supabase editor, so it can't run in CI.
 * This locks the property that makes P2 correct server-side: every RPC in the
 * mapping table now gates on `app.has_permission(cycle, '<permission>')` instead
 * of its old `app.has_role(...)` / `app.is_workspace_admin()` / `app.can_override`
 * guard — the P1 matrix is the single source of truth on the server too. The
 * rollback restores the pre-0037 role guards verbatim.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0037_rpc_permission_gates.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0037_rpc_permission_gates.rollback.sql"), "utf8");

/** Slice out one function body from a create-or-replace block (up to `$$;`). */
function fnBody(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\b`, "i"));
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end);
}

// RPC → the permission it must now gate on.
const EXPECTED: Record<string, string> = {
  set_clean_removal: "clean",
  clear_clean_removals: "clean",
  set_cohort_exclusion: "clean",
  adjust_participant_mark: "adjust",
  remove_mark_adjustment: "adjust",
  import_incident_rows: "adjust",
  clear_incident_rows: "adjust",
  upsert_incident_code: "configure",
  delete_incident_code: "configure",
  set_incident_settings: "configure",
  set_incident_mapping: "configure",
  set_element_labels: "configure",
  set_document_settings: "configure",
  set_workspace_setting: "configure",
  override_item_exclusion: "override",
  override_mark_adjustment: "override",
  clear_sitting_data: "intake",
  invite_member: "workspace_admin",
  set_member_role: "workspace_admin",
  remove_member: "workspace_admin",
  delete_sitting: "workspace_admin",
  delete_cycle: "workspace_admin",
  create_test_centre: "workspace_admin",
  update_test_centre: "workspace_admin",
  set_test_centre_active: "workspace_admin",
  move_exam_year_to_centre: "workspace_admin",
  lock_grades: "signoff",
  unlock_grades: "signoff",
};

describe("0037_rpc_permission_gates.sql — every gated RPC swaps to app.has_permission", () => {
  for (const [fn, perm] of Object.entries(EXPECTED)) {
    it(`${fn} → has_permission(..., '${perm}')`, () => {
      const body = fnBody(SQL, fn);
      expect(body).toMatch(new RegExp(`app\\.has_permission\\([^)]*'${perm}'\\)`));
      // The old role gates are gone from the gated function body.
      expect(body).not.toMatch(/app\.has_role\(/);
      expect(body).not.toMatch(/app\.is_workspace_admin\(\)/);
      expect(body).not.toMatch(/not app\.can_override\(/);
    });
  }

  it("does NOT touch the base primitives or set_role_permission's own gate", () => {
    // These must not be redefined here (they belong to 0036 / earlier migrations).
    expect(SQL).not.toMatch(/create or replace function app\.has_role\b/);
    expect(SQL).not.toMatch(/create or replace function app\.has_permission\b/);
    expect(SQL).not.toMatch(/create or replace function public\.set_role_permission\b/);
  });

  it("flags service_role-only tooling as intentionally NOT re-gated", () => {
    // ingest_persist / reset_cycle_for_reingest run under service_role with an
    // explicit actor (no auth.uid()), so they are not recreated here.
    expect(SQL).not.toMatch(/create or replace function public\.ingest_persist\b/);
    expect(SQL).not.toMatch(/create or replace function public\.reset_cycle_for_reingest\b/);
  });
});

describe("0037 rollback restores the pre-0037 role guards", () => {
  it("brings back has_role / is_workspace_admin / can_override", () => {
    expect(ROLLBACK).toMatch(/app\.has_role\(/);
    expect(ROLLBACK).toMatch(/app\.is_workspace_admin\(\)/);
    expect(ROLLBACK).toMatch(/app\.can_override\(/);
    // And recreates the same set of functions.
    expect((ROLLBACK.match(/create or replace function public\./g) ?? []).length).toBe(Object.keys(EXPECTED).length);
  });
});
