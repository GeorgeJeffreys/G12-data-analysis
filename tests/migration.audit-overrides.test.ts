/**
 * Migration 0012_audit_overrides.sql — structural safety guard.
 *
 * The SQL is applied by a human in the Supabase editor, so it can't run in CI.
 * This test locks the critical properties so a careless edit can't silently drop
 * them: the audit_log extension, the override-flavoured writer, the admin-only
 * override RPCs that REUSE the existing state mutations (no engine shortcut),
 * the server-side authorization, the append-only/definer-only guarantees, and
 * the admin full-read RLS — without weakening items.status / score security.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0012_audit_overrides.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0012_audit_overrides.rollback.sql"), "utf8");

describe("0012_audit_overrides.sql — structure", () => {
  it("extends audit_log with reason, prior_actor_id and is_override", () => {
    expect(SQL).toMatch(/alter table audit_log add column if not exists reason\s+text/i);
    expect(SQL).toMatch(/alter table audit_log add column if not exists prior_actor_id uuid references auth\.users\(id\)/i);
    expect(SQL).toMatch(/alter table audit_log add column if not exists is_override\s+boolean not null default false/i);
  });

  it("keeps audit_log append-only and never client-written", () => {
    expect(SQL).toMatch(/revoke insert, update, delete on audit_log from authenticated, anon/i);
    // No INSERT/UPDATE policy or column GRANT is added for clients.
    expect(SQL).not.toMatch(/grant\s+(insert|update)[^;]*on audit_log to authenticated/i);
  });

  it("adds the override-flavoured audit writer that flags is_override", () => {
    expect(SQL).toMatch(/create or replace function app\.audit_override/i);
    expect(SQL).toMatch(/insert into audit_log[\s\S]*is_override/i);
    // It is a SECURITY DEFINER function in the private app schema (clients can't call it).
    expect(SQL).toMatch(/function app\.audit_override[\s\S]*security definer/i);
  });

  it("exposes both override RPCs and grants them to authenticated", () => {
    expect(SQL).toMatch(/create or replace function public\.override_item_exclusion\(\s*p_item uuid, p_exclude boolean, p_reason text\)/i);
    expect(SQL).toMatch(/create or replace function public\.override_mark_adjustment\(/i);
    expect(SQL).toMatch(/grant execute on function[\s\S]*public\.override_item_exclusion\(uuid, boolean, text\)[\s\S]*public\.override_mark_adjustment\(uuid, uuid, uuid, numeric, text\)[\s\S]*to authenticated/i);
  });

  it("gates overrides to lead_admin server-side and requires a reason", () => {
    // Both RPCs check lead_admin and raise 'not authorized', and require a reason.
    const itemFn = SQL.slice(SQL.search(/function public\.override_item_exclusion/i), SQL.search(/function public\.override_mark_adjustment/i));
    expect(itemFn).toMatch(/app\.has_role\([^)]*array\['lead_admin'\]/i);
    expect(itemFn).toMatch(/raise exception 'not authorized'/i);
    expect(itemFn).toMatch(/raise exception 'an override requires a reason'/i);
    const adjFn = SQL.slice(SQL.search(/function public\.override_mark_adjustment/i));
    expect(adjFn).toMatch(/app\.has_role\([^)]*array\['lead_admin'\]/i);
    expect(adjFn).toMatch(/raise exception 'not authorized'/i);
    expect(adjFn).toMatch(/raise exception 'an override requires a reason'/i);
  });

  it("re-uses the SAME state mutation as the original action (no engine shortcut)", () => {
    // The exclusion override flips item_reviews + items.status exactly like
    // decide_item_exclusion — it does NOT write item_stats/participant_scores.
    const itemFn = SQL.slice(SQL.search(/function public\.override_item_exclusion/i), SQL.search(/function public\.override_mark_adjustment/i));
    expect(itemFn).toMatch(/insert into item_reviews/i);
    expect(itemFn).toMatch(/update items set status/i);
    expect(itemFn).not.toMatch(/item_stats|participant_scores|grade_schemes/i);
    // The mark override rides the existing alterations engine input only.
    const adjFn = SQL.slice(SQL.search(/function public\.override_mark_adjustment/i));
    expect(adjFn).toMatch(/insert into alterations/i);
    expect(adjFn).toMatch(/delete from alterations/i);
    expect(adjFn).not.toMatch(/update participant_scores|insert into participant_scores|insert into item_stats/i);
  });

  it("records override provenance (prior actor + reason) via app.audit_override", () => {
    expect(SQL).toMatch(/perform app\.audit_override\([\s\S]*override_item_exclusion/i);
    expect(SQL).toMatch(/perform app\.audit_override\([\s\S]*override_mark_adjustment/i);
    // The prior actor is resolved from the existing decision (item_reviews / alterations).
    expect(SQL).toMatch(/r\.reviewer_id into v_before, v_prior/i);
    expect(SQL).toMatch(/decided_by into v_prior/i);
  });

  it("adds an admin full-read RLS path without widening reads for regular users", () => {
    expect(SQL).toMatch(/create or replace function app\.is_global_admin/i);
    expect(SQL).toMatch(/create policy audit_admin_select on audit_log for select\s*\n?\s*using \(app\.is_global_admin\(\)\)/i);
    // The existing member-scoped audit_select policy is NOT dropped/redefined here.
    expect(SQL).not.toMatch(/drop policy if exists audit_select/i);
    expect(SQL).not.toMatch(/create policy audit_select/i);
  });

  it("does NOT weaken items.status / score column security", () => {
    expect(SQL).not.toMatch(/grant\s+update[^;]*on items to authenticated/i);
    expect(SQL).not.toMatch(/grant\s+(insert|update)[^;]*on participant_scores to authenticated/i);
  });
});

describe("0012_audit_overrides.rollback.sql — reversibility", () => {
  it("drops the override RPCs, writer, policy, helper and the added columns", () => {
    expect(ROLLBACK).toMatch(/drop function if exists public\.override_item_exclusion/i);
    expect(ROLLBACK).toMatch(/drop function if exists public\.override_mark_adjustment/i);
    expect(ROLLBACK).toMatch(/drop policy if exists audit_admin_select on audit_log/i);
    expect(ROLLBACK).toMatch(/drop function if exists app\.audit_override/i);
    expect(ROLLBACK).toMatch(/drop function if exists app\.is_global_admin/i);
    expect(ROLLBACK).toMatch(/alter table audit_log drop column if exists is_override/i);
    expect(ROLLBACK).toMatch(/alter table audit_log drop column if exists prior_actor_id/i);
    expect(ROLLBACK).toMatch(/alter table audit_log drop column if exists reason/i);
  });
});
