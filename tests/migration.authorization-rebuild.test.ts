/**
 * Migration 0025_authorization_rebuild.sql — structural safety guard.
 *
 * 0025 RESETS authorization to one simple, consistent model. The SQL is applied by a
 * human in the Supabase editor (no DB in CI), so these text assertions lock the
 * properties that make the model correct so a careless edit can't silently drop them:
 *   (a) ONE workspace-aware primitive `app.has_role(cycle, roles[])`
 *       (`m.cycle_id is null or m.cycle_id = p_cycle` AND `m.role = any(p_roles)`);
 *   (b) `app.is_member` DERIVED from that primitive (no second membership body);
 *   (c) `memberships` SELECT = pure self-read (`user_id = auth.uid()`) that calls NO
 *       memberships-reading function — the non-recursive shape;
 *   (d) `memberships` writes gated on `has_role`, split per-command (not FOR ALL);
 *   (e) schema_health probes the enum + primitive + policies and reports '0025';
 *   (f) NO destructive schema change, engine untouched;
 *   (g) two transactions with lock_timeout (deadlock discipline).
 * The rollback restores the 0024 surface while KEEPING the helpers workspace-aware.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0025_authorization_rebuild.sql"), "utf8");
const ROLLBACK = readFileSync(
  resolve(__dirname, "../supabase/migrations/0025_authorization_rebuild.rollback.sql"),
  "utf8",
);

describe("0025 — rebuild authorization", () => {
  it("(a) defines ONE workspace-aware has_role primitive with the role match", () => {
    const fn = SQL.slice(SQL.search(/function app\.has_role/i));
    expect(fn).toMatch(/m\.cycle_id is null or m\.cycle_id = p_cycle/i);
    expect(fn).toMatch(/m\.role = any\(p_roles\)/i);
    expect(fn).toMatch(/function app\.has_role[\s\S]*security definer/i);
  });

  it("(b) derives is_member FROM has_role (one membership definition, workspace-aware)", () => {
    const fn = SQL.slice(
      SQL.search(/create or replace function app\.is_member/i),
      SQL.search(/create or replace function public\.schema_health/i),
    );
    expect(fn).toMatch(/app\.has_role\(p_cycle, enum_range\(null::member_role\)\)/i);
  });

  it("(c) memberships SELECT is the pure self-read — auth.uid() only, no fn call", () => {
    expect(SQL).toMatch(/drop policy if exists memberships_all\s+on memberships/i);
    // The select policy statement (up to its terminating ';') uses auth.uid() and
    // calls NO memberships-reading function.
    const sel = SQL.slice(SQL.search(/create policy memberships_select on memberships/i));
    const selStmt = sel.slice(0, sel.indexOf(";") + 1);
    expect(selStmt).toMatch(/using \(user_id = auth\.uid\(\)\)/i);
    expect(selStmt).not.toMatch(/is_member/i);
    expect(selStmt).not.toMatch(/has_role/i);
  });

  it("(d) memberships writes gated on has_role, split per-command (never FOR ALL)", () => {
    expect(SQL).toMatch(/create policy memberships_insert on memberships for insert[\s\S]*has_role\(cycle_id, array\['lead_admin'\]/i);
    expect(SQL).toMatch(/create policy memberships_update on memberships for update[\s\S]*has_role\(cycle_id, array\['lead_admin'\]/i);
    expect(SQL).toMatch(/create policy memberships_delete on memberships for delete[\s\S]*has_role\(cycle_id, array\['lead_admin'\]/i);
    // No FOR ALL policy on memberships (that would leak the write guard onto SELECT).
    expect(SQL).not.toMatch(/create policy \w+ on memberships for all/i);
  });

  it("(e) schema_health probes the enum + primitive + policies and reports '0025'", () => {
    expect(SQL).toMatch(/'migration',\s*'0025'/);
    // Enum integrity (no phantom / dropped role).
    expect(SQL).toMatch(/typname = 'member_role'[\s\S]*enumlabel = 'lead_admin'/i);
    expect(SQL).toMatch(/typname = 'member_role'[\s\S]*enumlabel = 'analyst'/i);
    // Primitive workspace-aware.
    expect(SQL).toMatch(/proname = 'has_role'[\s\S]*cycle_id is null/i);
    // Self-read select policy asserted to NOT call a memberships-reading function.
    expect(SQL).toMatch(/memberships_select'[\s\S]*not ilike '%is_member%'/i);
    // A has_role-gated write policy is required.
    expect(SQL).toMatch(/tablename = 'memberships'[\s\S]*cmd in \('INSERT', 'UPDATE', 'DELETE'\)[\s\S]*has_role/i);
    // Retains the 0022/0023 delete-lifecycle + sitting-grain probes.
    expect(SQL).toMatch(/delete_sitting'\s*\n?\s*and p\.prorettype = 'bigint'/i);
    expect(SQL).toMatch(/responses_item_id_qm_result_id_key/);
  });

  it("(f) makes NO destructive schema change and does not touch the scoring engine", () => {
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).not.toMatch(/alter table .*drop column/i);
    expect(SQL).not.toMatch(/truncate/i);
    expect(SQL).not.toMatch(/rename value/i); // the enum is NOT renamed
    expect(SQL).not.toMatch(/participant_scores|item_stats|score_runs/i);
  });

  it("(g) splits functions and the memberships-table policies into SEPARATE transactions", () => {
    const begins = SQL.match(/^\s*begin;/gim) ?? [];
    const commits = SQL.match(/^\s*commit;/gim) ?? [];
    expect(begins.length).toBe(2);
    expect(commits.length).toBe(2);
    // A COMMIT sits between the last function and the first policy swap.
    const lastFnAt = SQL.search(/create or replace function public\.schema_health/i);
    const policyAt = SQL.search(/drop policy if exists memberships_select/i);
    const commitBetween = SQL.slice(lastFnAt, policyAt).search(/\bcommit;/i);
    expect(policyAt).toBeGreaterThan(lastFnAt);
    expect(commitBetween).toBeGreaterThan(-1);
    // Both transactions fail fast rather than hang.
    expect((SQL.match(/set local lock_timeout/gi) ?? []).length).toBe(2);
  });

  it("rollback restores the 0024 surface (combined select + FOR ALL), keeps global helpers", () => {
    expect(ROLLBACK).toMatch(/create policy memberships_select on memberships[\s\S]*using \(user_id = auth\.uid\(\) or app\.is_member\(cycle_id\)\)/i);
    expect(ROLLBACK).toMatch(/create policy memberships_all on memberships for all/i);
    expect(ROLLBACK).toMatch(/'migration',\s*'0024'/);
    // Helpers stay workspace-aware (rollback must NOT re-introduce the strict bug).
    const fn = ROLLBACK.slice(ROLLBACK.search(/function app\.has_role/i));
    expect(fn).toMatch(/m\.cycle_id is null or m\.cycle_id = p_cycle/i);
  });
});
