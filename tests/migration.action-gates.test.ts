/**
 * Migration 0041_action_gates.sql — structural safety guard.
 *
 * Locks that every RPC 0037/0039 gated on app.has_capability is re-gated onto
 * app.can_do(cycle, '<action>') against the granular grid, the two override RPCs onto
 * general.override_marks, no has_capability call survives in any gated body, and the
 * R1/R2 bundle layer (app.has_capability + the bundle admin RPCs + the permissions /
 * role_grants tables) is dropped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0041_action_gates.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0041_action_gates.rollback.sql"), "utf8");

function fnBody(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\b`, "i"));
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end);
}

describe("0041 — re-gates the pipeline/admin RPCs onto app.can_do(action)", () => {
  const REGATED: Record<string, string> = {
    set_clean_removal: "clean.rows",
    clear_clean_removals: "clean.rows",
    set_cohort_exclusion: "clean.cohort",
    adjust_participant_mark: "grades.adjust",
    remove_mark_adjustment: "grades.adjust",
    import_incident_rows: "incidents.upload",
    clear_incident_rows: "incidents.upload",
    upsert_incident_code: "general.config_incidents",
    set_incident_mapping: "general.config_incidents",
    set_element_labels: "general.config_methodology",
    set_workspace_setting: "general.config_methodology",
    clear_sitting_data: "upload.manage",
    delete_sitting: "general.delete",
    delete_cycle: "general.delete",
    create_test_centre: "general.manage_centres",
    move_exam_year_to_centre: "general.manage_centres",
    lock_grades: "general.signoff",
    unlock_grades: "general.signoff",
  };
  for (const [fn, action] of Object.entries(REGATED)) {
    it(`${fn} → can_do(..., '${action}')`, () => {
      const body = fnBody(SQL, fn);
      expect(body).toMatch(new RegExp(`app\\.can_do\\([^)]*'${action.replace(/\./g, "\\.")}'\\)`));
      expect(body).not.toMatch(/app\.has_capability\(/);
    });
  }

  it("points both override RPCs at general.override_marks", () => {
    for (const fn of ["override_item_exclusion", "override_mark_adjustment"]) {
      const body = fnBody(SQL, fn);
      expect(body).toMatch(/app\.can_do\([^)]*'general\.override_marks'\)/);
      expect(body).not.toMatch(/'override\.marks_exclusions'\)/);
    }
  });

  it("leaves no has_capability call in any gated RPC body (comments + drop aside)", () => {
    const nonComment = SQL.split("\n")
      .filter((l) => !l.trim().startsWith("--") && !/drop function/.test(l))
      .join("\n");
    expect(nonComment).not.toMatch(/app\.has_capability\(/);
  });
});

describe("0041 — removes the R1/R2 bundle layer", () => {
  it("drops has_capability, the bundle admin RPCs, and the permissions/role_grants tables", () => {
    expect(SQL).toMatch(/drop function if exists app\.has_capability\(uuid, text\)/);
    expect(SQL).toMatch(/drop function if exists public\.create_permission/);
    expect(SQL).toMatch(/drop function if exists public\.set_role_grant/);
    expect(SQL).toMatch(/drop table if exists public\.role_grants/);
    expect(SQL).toMatch(/drop table if exists public\.permissions/);
  });
});

describe("0041 rollback restores the bundle layer + has_capability gates", () => {
  it("recreates has_capability, the bundle tables/RPCs, and the has_capability gates", () => {
    expect(ROLLBACK).toMatch(/create or replace function app\.has_capability/);
    expect(ROLLBACK).toMatch(/create table if not exists public\.permissions/);
    expect(ROLLBACK).toMatch(/create or replace function public\.set_role_grant/);
    // A representative RPC is re-gated back onto has_capability.
    expect(ROLLBACK).toMatch(/app\.has_capability\([^)]*'clean'\)/);
  });
});
