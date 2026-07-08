/**
 * Migration 0039_configurable_permissions.sql — structural safety guard.
 *
 * The SQL is applied by a human in the Supabase editor, so it can't run in CI.
 * This locks the properties that make R1 correct server-side: the permissions +
 * role_grants tables and their seed, app.has_capability, the admin RPCs with the
 * Workspace-administration lockout guard, and that every 0037 RPC is re-gated onto
 * app.has_capability (the two override RPCs onto override.marks_exclusions). The
 * old fixed matrix (has_permission / set_role_permission / role_permissions) is
 * dropped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0039_configurable_permissions.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0039_configurable_permissions.rollback.sql"), "utf8");

function fnBody(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\b`, "i"));
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end);
}

describe("0039 — tables, seed, gate, admin RPCs", () => {
  it("creates permissions + role_grants and seeds the default set", () => {
    expect(SQL).toMatch(/create table if not exists public\.permissions/);
    expect(SQL).toMatch(/create table if not exists public\.role_grants/);
    expect(SQL).toMatch(/references public\.permissions\(id\) on delete cascade/);
    // Seeds the protected system permission + the split-override bundle.
    expect(SQL).toMatch(/'Workspace administration'.*array\['workspace_admin'\], true/);
    expect(SQL).toMatch(/array\['override\.marks_exclusions','override\.distinction'\]/);
  });

  it("adds app.has_capability and drops app.has_permission + the fixed matrix", () => {
    expect(SQL).toMatch(/create or replace function app\.has_capability\(p_cycle uuid, p_cap text\)/);
    expect(SQL).toMatch(/p_cap = any\(p\.capabilities\)/);
    expect(SQL).toMatch(/drop function if exists app\.has_permission\(uuid, text\)/);
    expect(SQL).toMatch(/drop function if exists public\.set_role_permission/);
    expect(SQL).toMatch(/drop table if exists public\.role_permissions/);
  });

  it("gates each admin RPC on workspace_admin with the lockout guard", () => {
    for (const fn of ["create_permission", "update_permission", "delete_permission", "set_role_grant"]) {
      expect(fnBody(SQL, fn)).toMatch(/app\.has_capability\(null, 'workspace_admin'\)/);
    }
    expect(fnBody(SQL, "delete_permission")).toMatch(/cannot be deleted/);
    expect(fnBody(SQL, "update_permission")).toMatch(/cannot remove workspace_admin/);
    expect(fnBody(SQL, "set_role_grant")).toMatch(/cannot be un-granted from admin/);
  });
});

describe("0039 — re-gates the 0037 RPCs onto has_capability", () => {
  const REGATED: Record<string, string> = {
    set_clean_removal: "clean", set_cohort_exclusion: "clean",
    adjust_participant_mark: "adjust", import_incident_rows: "adjust",
    upsert_incident_code: "configure", set_workspace_setting: "configure",
    clear_sitting_data: "intake", delete_cycle: "workspace_admin",
    lock_grades: "signoff", unlock_grades: "signoff",
  };
  for (const [fn, cap] of Object.entries(REGATED)) {
    it(`${fn} → has_capability(..., '${cap}')`, () => {
      const body = fnBody(SQL, fn);
      expect(body).toMatch(new RegExp(`app\\.has_capability\\([^)]*'${cap.replace(".", "\\.")}'\\)`));
      expect(body).not.toMatch(/app\.has_permission\(/);
    });
  }

  it("points both override RPCs at override.marks_exclusions (not bare 'override')", () => {
    for (const fn of ["override_item_exclusion", "override_mark_adjustment"]) {
      const body = fnBody(SQL, fn);
      expect(body).toMatch(/app\.has_capability\([^)]*'override\.marks_exclusions'\)/);
      expect(body).not.toMatch(/'override'\)/);
    }
  });

  it("leaves no has_permission call in any gated RPC body", () => {
    // Only comments + the drop statement may mention has_permission.
    const nonComment = SQL.split("\n").filter((l) => !l.trim().startsWith("--") && !/drop function/.test(l)).join("\n");
    expect(nonComment).not.toMatch(/app\.has_permission\(/);
  });
});

describe("0039 rollback restores the fixed matrix", () => {
  it("recreates has_permission, role_permissions and set_role_permission, and drops has_capability", () => {
    expect(ROLLBACK).toMatch(/create or replace function app\.has_permission/);
    expect(ROLLBACK).toMatch(/create table if not exists public\.role_permissions/);
    expect(ROLLBACK).toMatch(/create or replace function public\.set_role_permission/);
    expect(ROLLBACK).toMatch(/drop function if exists app\.has_capability/);
  });
});
