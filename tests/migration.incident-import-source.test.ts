/**
 * Migration 0018_incident_import_source.sql — structural safety guard.
 *
 * The imported-source table is pure provenance (file name + is_sample per cycle):
 * it stores no marks, is cycle-role gated (not admin-broadened), follows the 0016
 * RLS + write-revoke pattern, and never touches a grade-bearing table (183/183
 * parity unchanged). These lock those invariants.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0018_incident_import_source.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0018_incident_import_source.rollback.sql"), "utf8");

describe("0018 — incident import source provenance", () => {
  it("creates the incident_import_source table keyed per cycle", () => {
    expect(SQL).toMatch(/create table if not exists incident_import_source/i);
    expect(SQL).toMatch(/cycle_id\s+uuid primary key references exam_cycles\(id\)/i);
    expect(SQL).toMatch(/file_name\s+text not null/i);
    expect(SQL).toMatch(/is_sample\s+boolean not null default false/i);
  });

  it("set + clear are gated on the same cycle role as importing rows", () => {
    for (const fn of ["set_incident_import_source", "clear_incident_import_source"]) {
      const body = SQL.slice(SQL.search(new RegExp(`function public\\.${fn}`, "i")));
      expect(body.slice(0, 400)).toMatch(/app\.has_role\(p_cycle, array\['lead_admin','reviewer'\]/i);
    }
  });

  it("enables RLS and revokes direct client writes", () => {
    expect(SQL).toMatch(/alter table incident_import_source enable row level security/i);
    expect(SQL).toMatch(/revoke insert, update, delete on incident_import_source/i);
  });

  it("does not touch grade-bearing tables (base reconciles 1:1)", () => {
    expect(SQL).not.toMatch(/\b(update|insert into|alter table)\s+(participant_scores|item_stats|score_runs|grades|alterations|incident_rows)\b/i);
  });

  it("rollback drops what it created", () => {
    expect(ROLLBACK).toMatch(/drop table if exists incident_import_source/i);
    expect(ROLLBACK).toMatch(/drop function if exists public\.set_incident_import_source/i);
    expect(ROLLBACK).toMatch(/drop function if exists public\.clear_incident_import_source/i);
  });
});
