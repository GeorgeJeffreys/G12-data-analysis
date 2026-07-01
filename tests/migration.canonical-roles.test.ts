/**
 * Migration 0015_canonical_roles.sql — structural safety guard.
 *
 * The SQL is applied by a human in the Supabase editor, so it can't run in CI.
 * This test locks the properties that matter so a careless edit can't silently
 * drop them: the additive enum change, the rank/at-least/override primitives that
 * express the canonical ordering, the rank-based membership check, and the
 * behaviour-identical fold of the admin lock onto the primitive.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0015_canonical_roles.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0015_canonical_roles.rollback.sql"), "utf8");

describe("0015_canonical_roles.sql — structure", () => {
  it("adds `analyst` to member_role idempotently, without renaming/dropping others", () => {
    expect(SQL).toMatch(/alter type member_role add value if not exists 'analyst'/i);
    // Additive only — never drops or renames the existing values.
    expect(SQL).not.toMatch(/drop type member_role/i);
    expect(SQL).not.toMatch(/rename value/i);
  });

  it("defines role_rank with the canonical ordering (admin 3 > analyst 2 > team 1)", () => {
    expect(SQL).toMatch(/create or replace function app\.role_rank\(p_role member_role\)/i);
    expect(SQL).toMatch(/when 'lead_admin' then 3/i);
    expect(SQL).toMatch(/when 'analyst'\s+then 2/i);
    // reviewer/viewer fall through to the team-member tier.
    expect(SQL).toMatch(/else 1/i);
    // Ranked via ::text so the migration never uses the new enum value as a literal.
    expect(SQL).toMatch(/p_role::text/i);
  });

  it("exposes role_at_least ('at least') and can_override (strictly higher)", () => {
    expect(SQL).toMatch(/create or replace function app\.role_at_least\(p_role member_role, p_min member_role\)/i);
    expect(SQL).toMatch(/app\.role_rank\(p_role\) >= app\.role_rank\(p_min\)/i);
    expect(SQL).toMatch(/create or replace function app\.can_override\(p_actor member_role, p_subject member_role\)/i);
    expect(SQL).toMatch(/app\.role_rank\(p_actor\) > app\.role_rank\(p_subject\)/i);
  });

  it("adds a rank-based, cycle-scoped membership check (DB mirror of hasRole)", () => {
    expect(SQL).toMatch(/create or replace function app\.has_min_role\(p_cycle uuid, p_min member_role\)/i);
    expect(SQL).toMatch(/app\.role_rank\(m\.role\) >= app\.role_rank\(p_min\)/i);
    expect(SQL).toMatch(/function app\.has_min_role[\s\S]*security definer/i);
  });

  it("folds the admin lock onto the primitive, behaviour-identical (still null-cycle lead_admin)", () => {
    const wsFn = SQL.slice(SQL.search(/function app\.is_workspace_admin/i), SQL.search(/function app\.is_global_admin/i));
    expect(wsFn).toMatch(/app\.role_at_least\(m\.role, 'lead_admin'\)/i);
    expect(wsFn).toMatch(/m\.cycle_id is null/i);
    expect(wsFn).not.toMatch(/m\.role = 'lead_admin'/i);
    const gaFn = SQL.slice(SQL.search(/function app\.is_global_admin/i));
    expect(gaFn).toMatch(/app\.role_at_least\(m\.role, 'lead_admin'\)/i);
    expect(gaFn).toMatch(/m\.cycle_id is null/i);
  });

  it("does no grade-bearing DDL (foundation only)", () => {
    expect(SQL).not.toMatch(/\bcreate table\b/i);
    expect(SQL).not.toMatch(/\bupdate\s+(grades|participant_scores|item_stats|score_runs)\b/i);
  });
});

describe("0015_canonical_roles.rollback.sql — structure", () => {
  it("restores the direct lead_admin admin-lock bodies and drops the rank helpers", () => {
    expect(ROLLBACK).toMatch(/create or replace function app\.is_workspace_admin/i);
    expect(ROLLBACK).toMatch(/m\.role = 'lead_admin'/i);
    expect(ROLLBACK).toMatch(/drop function if exists app\.role_rank\(member_role\)/i);
    expect(ROLLBACK).toMatch(/drop function if exists app\.can_override\(member_role, member_role\)/i);
    expect(ROLLBACK).toMatch(/drop function if exists app\.has_min_role\(uuid, member_role\)/i);
  });
});
