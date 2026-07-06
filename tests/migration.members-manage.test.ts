/**
 * Migration 0028_members_manage.sql — structural safety guard.
 *
 * 0028 gives the Users & access UI the write primitives to manage access with no SQL:
 *   (a) upsert_member_role — admin-gated create-or-update of a (user, scope) membership;
 *   (b) a last-workspace-admin GUARD on demote/remove (no self-lockout);
 *   (c) remove_person — revoke all of a user's memberships;
 *   (d) schema_health asserts upsert_member_role and reports '0028';
 *   (e) NO change to the C1 memberships schema / has_role / RLS policies.
 * The rollback restores the 0027 remove_member and the 0026 probe ('0026').
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0028_members_manage.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0028_members_manage.rollback.sql"), "utf8");

describe("0028 — manage members from the UI", () => {
  it("(a) upsert_member_role: admin-gated create-or-update of a membership", () => {
    const fn = SQL.slice(SQL.search(/function public\.upsert_member_role/i), SQL.search(/function public\.remove_member/i));
    expect(fn).toMatch(/app\.has_role\(p_cycle, array\['lead_admin'\]/i);
    expect(fn).toMatch(/insert into memberships/i);
    expect(fn).toMatch(/update memberships set role/i);
    expect(fn).toMatch(/cycle_id is not distinct from p_cycle/i);
  });

  it("(b) last-workspace-admin guard blocks demote and remove", () => {
    // Demotion guard in upsert.
    expect(SQL).toMatch(/cannot demote the last workspace admin/i);
    // Removal guard.
    expect(SQL).toMatch(/cannot remove the last workspace admin/i);
    // The guard is keyed on "another workspace admin exists".
    expect(SQL).toMatch(/other_workspace_admin_exists/i);
    expect(SQL).toMatch(/cycle_id is null and role = 'lead_admin' and user_id <> p_user/i);
  });

  it("(c) remove_person revokes ALL of a user's memberships (workspace-admin gated)", () => {
    const fn = SQL.slice(SQL.search(/function public\.remove_person/i));
    expect(fn).toMatch(/app\.has_role\(null, array\['lead_admin'\]/i);
    expect(fn).toMatch(/delete from memberships where user_id = p_user/i);
  });

  it("(d) schema_health asserts upsert_member_role and reports '0028'", () => {
    expect(SQL).toMatch(/'migration',\s*'0028'/);
    expect(SQL).toMatch(/proname = 'upsert_member_role'/i);
    // Retains the auth + pipeline surface.
    expect(SQL).toMatch(/proname = 'has_role'[\s\S]*cycle_id is null/i);
    expect(SQL).toMatch(/responses_cycle_id_qm_result_id_question_id_key/);
  });

  it("(e) does NOT change the memberships schema / RLS / has_role", () => {
    expect(SQL).not.toMatch(/alter table memberships/i);
    expect(SQL).not.toMatch(/create policy|drop policy/i);
    expect(SQL).not.toMatch(/create or replace function app\.has_role/i);
    expect(SQL).not.toMatch(/alter type member_role/i);
  });

  it("rollback restores the 0027 remove_member and the 0026 probe", () => {
    expect(ROLLBACK).toMatch(/drop function if exists public\.upsert_member_role/i);
    expect(ROLLBACK).toMatch(/you cannot remove your own membership/i); // 0027 body
    expect(ROLLBACK).toMatch(/'migration',\s*'0026'/);
  });
});
