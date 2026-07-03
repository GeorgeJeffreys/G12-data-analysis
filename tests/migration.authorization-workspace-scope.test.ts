/**
 * Migration 0024_authorization_workspace_scope.sql — structural safety guard.
 *
 * 0024 restores WORKSPACE-scope authorization (task 20): the "forbidden" that broke
 * BOTH delete and replace together was a single regression — the membership helpers
 * `app.is_member` / `app.has_role` had drifted to the strict, cycle-scoped 0001
 * bodies, so a workspace admin (`memberships.cycle_id IS NULL`) authorized nothing.
 * The migration must:
 *   (a) re-affirm both helpers at the 0002 GLOBAL-aware definition
 *       (`m.cycle_id is null or m.cycle_id = p_cycle`);
 *   (b) correct `memberships_select` so a user can always read their OWN rows
 *       (`user_id = auth.uid()` present in the policy);
 *   (c) harden schema_health to probe the workspace-aware helpers + the self-read
 *       policy, and report '0024';
 *   (d) make NO table / column / constraint / DATA change, and never touch the engine.
 * The rollback restores the plain member-scoped select policy and the 0023 probe,
 * while KEEPING the global-aware helpers (never re-introduce the strict bug).
 * (Text assertions — the build environment has no DB, per the RUNBOOK.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0024_authorization_workspace_scope.sql"), "utf8");
const ROLLBACK = readFileSync(
  resolve(__dirname, "../supabase/migrations/0024_authorization_workspace_scope.rollback.sql"),
  "utf8",
);

describe("0024 — restore workspace-scope authorization", () => {
  it("re-affirms app.is_member with the global (cycle_id IS NULL) clause", () => {
    const fn = SQL.slice(SQL.search(/function app\.is_member/i));
    expect(fn).toMatch(/m\.cycle_id is null or m\.cycle_id = p_cycle/i);
  });

  it("re-affirms app.has_role with the global clause AND the role match", () => {
    const fn = SQL.slice(SQL.search(/function app\.has_role/i));
    expect(fn).toMatch(/m\.cycle_id is null or m\.cycle_id = p_cycle/i);
    expect(fn).toMatch(/m\.role = any\(p_roles\)/i);
  });

  it("corrects memberships_select so a user can read their OWN rows", () => {
    expect(SQL).toMatch(/drop policy if exists memberships_select on memberships/i);
    expect(SQL).toMatch(
      /create policy memberships_select on memberships[\s\S]*using \(user_id = auth\.uid\(\) or app\.is_member\(cycle_id\)\)/i,
    );
  });

  it("hardens schema_health: probes the workspace-aware helpers + self-read policy, reports '0024'", () => {
    expect(SQL).toMatch(/'migration',\s*'0024'/);
    // Probes the helper bodies carry the global clause…
    expect(SQL).toMatch(/proname = 'is_member'[\s\S]*cycle_id is null/i);
    expect(SQL).toMatch(/proname = 'has_role'[\s\S]*cycle_id is null/i);
    // …and that the memberships self-read policy exists.
    expect(SQL).toMatch(/tablename = 'memberships'[\s\S]*auth\.uid\(\)/i);
    // Retains the 0022/0023 delete-lifecycle + sitting-grain probes.
    expect(SQL).toMatch(/delete_sitting'\s*\n?\s*and p\.prorettype = 'bigint'/i);
    expect(SQL).toMatch(/responses_item_id_qm_result_id_key/);
  });

  it("makes NO destructive schema change and does not touch the scoring engine", () => {
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).not.toMatch(/alter table .*drop column/i);
    expect(SQL).not.toMatch(/truncate/i);
    expect(SQL).not.toMatch(/participant_scores|item_stats|score_runs/i);
  });

  it("splits the helpers and the memberships-table policy into SEPARATE transactions (deadlock-safe)", () => {
    // app.is_member/has_role read memberships, so a single txn that both replaces
    // them and locks the memberships table deadlocks against live readers. The fix:
    // functions in one transaction, the policy swap in another.
    const begins = SQL.match(/^\s*begin;/gim) ?? [];
    const commits = SQL.match(/^\s*commit;/gim) ?? [];
    expect(begins.length).toBe(2);
    expect(commits.length).toBe(2);

    // The policy swap must NOT sit in the same transaction as the function
    // replacements: the last function `create or replace` is followed by a COMMIT
    // before the `create policy memberships_select`.
    const lastFnAt = SQL.search(/create or replace function public\.schema_health/i);
    const policyAt = SQL.search(/create policy memberships_select/i);
    const commitBetween = SQL.slice(lastFnAt, policyAt).search(/\bcommit;/i);
    expect(policyAt).toBeGreaterThan(lastFnAt);
    expect(commitBetween).toBeGreaterThan(-1);

    // No `lock table memberships` in the function transaction (that's what deadlocks).
    const fnTxn = SQL.slice(0, SQL.slice(lastFnAt).search(/\bcommit;/i) + lastFnAt);
    expect(fnTxn).not.toMatch(/lock table memberships/i);

    // Both transactions fail fast rather than hang.
    expect((SQL.match(/set local lock_timeout/gi) ?? []).length).toBe(2);
  });

  it("rollback restores the plain member-scoped policy + 0023 probe, keeping global helpers", () => {
    // Plain member-scoped select policy is restored…
    expect(ROLLBACK).toMatch(/create policy memberships_select on memberships[\s\S]*using \(app\.is_member\(cycle_id\)\)/i);
    // …the probe reports 0023 again…
    expect(ROLLBACK).toMatch(/'migration',\s*'0023'/);
    // …but the helpers stay global-aware (rollback must NOT re-introduce the strict bug).
    const fn = ROLLBACK.slice(ROLLBACK.search(/function app\.has_role/i));
    expect(fn).toMatch(/m\.cycle_id is null or m\.cycle_id = p_cycle/i);
  });
});
