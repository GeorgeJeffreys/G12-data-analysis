/**
 * Migration 0016_override_role_hierarchy.sql — structural safety guard.
 *
 * The SQL is applied by a human in the Supabase editor, so it can't run in CI.
 * This test locks the properties that make prompt 06 correct server-side: the
 * override RPCs gate on the STRICTLY-HIGHER `app.can_override(actor, subject)`
 * rule (not a flat lead_admin check), the subject is the role that took the
 * original decision (resolved via `app.role_of`), and everything else 0012
 * guaranteed — the SAME state mutation (no engine shortcut), the required reason,
 * and the `app.audit_override` provenance — is preserved. The rollback restores
 * the 0012 flat lead_admin gate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0016_override_role_hierarchy.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0016_override_role_hierarchy.rollback.sql"), "utf8");

const itemFn = SQL.slice(SQL.search(/function public\.override_item_exclusion/i), SQL.search(/function public\.override_mark_adjustment/i));
const adjFn = SQL.slice(SQL.search(/function public\.override_mark_adjustment/i));

describe("0016_override_role_hierarchy.sql — strictly-higher override gate", () => {
  it("adds app.role_of — the effective (highest-rank) role of a user in a cycle", () => {
    expect(SQL).toMatch(/create or replace function app\.role_of\(p_cycle uuid, p_user uuid\)/i);
    // Highest rank across the user's global + cycle memberships.
    expect(SQL).toMatch(/order by app\.role_rank\(m\.role\) desc/i);
    expect(SQL).toMatch(/m\.cycle_id is null or m\.cycle_id = p_cycle/i);
  });

  it("gates BOTH override RPCs on app.can_override(actor, subject), not a flat lead_admin check", () => {
    for (const fn of [itemFn, adjFn]) {
      expect(fn).toMatch(/app\.can_override\(/i);
      expect(fn).toMatch(/raise exception 'not authorized'/i);
      expect(fn).toMatch(/raise exception 'an override requires a reason'/i);
      // The flat lead_admin gate is GONE from the new definitions.
      expect(fn).not.toMatch(/app\.has_role\([^)]*array\['lead_admin'\]/i);
    }
  });

  it("uses the role that took the original decision as the override SUBJECT", () => {
    // Item: subject = the reviewer of record; actor = auth.uid().
    expect(itemFn).toMatch(/r\.reviewer_id into v_before, v_prior/i);
    expect(itemFn).toMatch(/app\.role_of\(v_cycle, auth\.uid\(\)\)/i);
    expect(itemFn).toMatch(/app\.role_of\(v_cycle, v_prior\)/i);
    // Mark: subject = the most recent adjuster (alterations.decided_by).
    expect(adjFn).toMatch(/decided_by into v_prior/i);
    expect(adjFn).toMatch(/app\.role_of\(p_cycle, v_actor\)/i);
    expect(adjFn).toMatch(/app\.role_of\(p_cycle, v_prior\)/i);
  });

  it("re-uses the SAME state mutation as the original action (no engine shortcut)", () => {
    expect(itemFn).toMatch(/insert into item_reviews/i);
    expect(itemFn).toMatch(/update items set status/i);
    expect(itemFn).not.toMatch(/item_stats|participant_scores|grade_schemes/i);
    expect(adjFn).toMatch(/insert into alterations/i);
    expect(adjFn).toMatch(/delete from alterations/i);
    expect(adjFn).not.toMatch(/update participant_scores|insert into participant_scores|insert into item_stats/i);
  });

  it("records override provenance (prior actor + reason) via app.audit_override", () => {
    expect(SQL).toMatch(/perform app\.audit_override\([\s\S]*override_item_exclusion/i);
    expect(SQL).toMatch(/perform app\.audit_override\([\s\S]*override_mark_adjustment/i);
  });

  it("keeps the RPC signatures + grants unchanged (subject resolved server-side)", () => {
    expect(SQL).toMatch(/function public\.override_item_exclusion\(\s*p_item uuid, p_exclude boolean, p_reason text\)/i);
    expect(SQL).toMatch(/function public\.override_mark_adjustment\(\s*p_cycle uuid, p_participant uuid, p_assessment uuid,\s*p_new_mark numeric, p_reason text\)/i);
    expect(SQL).toMatch(/grant execute on function[\s\S]*public\.override_item_exclusion\(uuid, boolean, text\)[\s\S]*public\.override_mark_adjustment\(uuid, uuid, uuid, numeric, text\)[\s\S]*to authenticated/i);
  });

  it("does NOT weaken audit_log or score column security", () => {
    expect(SQL).not.toMatch(/grant\s+(insert|update)[^;]*on audit_log to authenticated/i);
    expect(SQL).not.toMatch(/grant\s+update[^;]*on items to authenticated/i);
    expect(SQL).not.toMatch(/grant\s+(insert|update)[^;]*on participant_scores to authenticated/i);
  });
});

describe("0016_override_role_hierarchy.rollback.sql — reversibility", () => {
  it("restores the 0012 flat lead_admin gate and drops app.role_of", () => {
    expect(ROLLBACK).toMatch(/create or replace function public\.override_item_exclusion/i);
    expect(ROLLBACK).toMatch(/create or replace function public\.override_mark_adjustment/i);
    // Both restored bodies check lead_admin via app.has_role, and no can_override.
    expect(ROLLBACK).toMatch(/app\.has_role\([^)]*array\['lead_admin'\]/i);
    expect(ROLLBACK).not.toMatch(/app\.can_override\(/i);
    expect(ROLLBACK).toMatch(/drop function if exists app\.role_of\(uuid, uuid\)/i);
  });
});
