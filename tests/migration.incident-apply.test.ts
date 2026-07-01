/**
 * Migration 0017_incident_apply.sql — structural safety guard.
 *
 * The apply/commit state is a bounded layer ON TOP of base scores: this migration
 * records only the admin decision to apply (per cycle), never writes incident
 * marks into the grade-bearing tables, and does not touch the parity-locked engine
 * (183/183 unchanged). These lock: the table exists; commit is admin-only; RLS +
 * write revokes follow the 0016 pattern; and no grade-bearing table is written.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0017_incident_apply.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0017_incident_apply.rollback.sql"), "utf8");

describe("0017 — apply/commit state", () => {
  it("creates the incident_applications table keyed per cycle", () => {
    expect(SQL).toMatch(/create table if not exists incident_applications/i);
    expect(SQL).toMatch(/cycle_id\s+uuid primary key references exam_cycles\(id\)/i);
    expect(SQL).toMatch(/applied\s+boolean not null default false/i);
  });

  it("commit + revert are workspace-admin only", () => {
    for (const fn of ["apply_incident_adjustments", "unapply_incident_adjustments"]) {
      const body = SQL.slice(SQL.search(new RegExp(`function public\\.${fn}`, "i")));
      expect(body.slice(0, 400)).toMatch(/app\.is_workspace_admin\(\)/i);
    }
  });

  it("enables RLS and revokes direct client writes", () => {
    expect(SQL).toMatch(/alter table incident_applications\s+enable row level security/i);
    expect(SQL).toMatch(/revoke insert, update, delete on incident_applications/i);
  });

  it("does not touch the engine / grade-bearing tables (base reconciles 1:1)", () => {
    expect(SQL).not.toMatch(/\b(update|insert into|alter table)\s+(participant_scores|item_stats|score_runs|grades|alterations)\b/i);
  });

  it("rollback drops what it created", () => {
    expect(ROLLBACK).toMatch(/drop table if exists incident_applications/i);
    expect(ROLLBACK).toMatch(/drop function if exists public\.apply_incident_adjustments/i);
    expect(ROLLBACK).toMatch(/drop function if exists public\.unapply_incident_adjustments/i);
  });
});
