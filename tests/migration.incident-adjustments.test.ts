/**
 * Migration 0016_incident_adjustments.sql — structural safety guard.
 *
 * The SQL is applied by a human in the Supabase editor, so it can't run in CI.
 * These lock the properties that matter: the new tables exist; ADD-ONLY is
 * enforced at rest (CHECK ≥ 0 + the formula validator); config writes are
 * admin-gated; parsed rows key on the P-A internal id and resolve the cohort
 * participant via qm_participant_id (never the per-ingest UUID); and the engine /
 * grade-bearing tables are not touched (parity stays 183/183).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0016_incident_adjustments.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0016_incident_adjustments.rollback.sql"), "utf8");

describe("0016 — tables + add-only constraints", () => {
  it("creates the four new tables", () => {
    for (const t of ["incident_codes", "incident_settings", "incident_import_mappings", "incident_rows"]) {
      expect(SQL).toMatch(new RegExp(`create table if not exists ${t}`, "i"));
    }
  });

  it("enforces add-only at rest (per-code cap ≥ 0, per-student cap ≥ 0, duration ≥ 0)", () => {
    expect(SQL).toMatch(/check \(per_code_cap >= 0\)/i);
    expect(SQL).toMatch(/per_student_cap is null or per_student_cap >= 0/i);
    expect(SQL).toMatch(/duration_minutes is null or duration_minutes >= 0/i);
  });

  it("validates the formula JSON is add-only via a CHECK-usable helper", () => {
    expect(SQL).toMatch(/function app\.incident_formula_add_only\(f jsonb\)/i);
    expect(SQL).toMatch(/check \(app\.incident_formula_add_only\(formula\)\)/i);
    // fixed / per_duration / pct_section all require ≥ 0 grants
    expect(SQL).toMatch(/marks'\)::numeric, -1\) >= 0/i);
    expect(SQL).toMatch(/marksPerUnit'\)::numeric, -1\) >= 0/i);
    expect(SQL).toMatch(/percent'\)::numeric, -1\) >= 0/i);
  });
});

describe("0016 — security", () => {
  it("config writes are workspace-admin only", () => {
    for (const fn of ["upsert_incident_code", "delete_incident_code", "set_incident_settings", "set_incident_mapping"]) {
      const body = SQL.slice(SQL.search(new RegExp(`function public\\.${fn}`, "i")));
      expect(body.slice(0, 600)).toMatch(/app\.is_workspace_admin\(\)/i);
    }
  });

  it("importing rows is a cycle-role action (lead/admin or reviewer)", () => {
    const body = SQL.slice(SQL.search(/function public\.import_incident_rows/i));
    expect(body.slice(0, 400)).toMatch(/app\.has_role\(p_cycle, array\['lead_admin','reviewer'\]/i);
  });

  it("enables RLS and revokes direct client writes on every new table", () => {
    for (const t of ["incident_codes", "incident_settings", "incident_import_mappings", "incident_rows"]) {
      expect(SQL).toMatch(new RegExp(`alter table ${t}\\s+enable row level security`, "i"));
      expect(SQL).toMatch(new RegExp(`revoke insert, update, delete on ${t}`, "i"));
    }
  });
});

describe("0016 — identity + parity", () => {
  it("keys incident rows on the P-A internal id and resolves via qm_participant_id", () => {
    expect(SQL).toMatch(/participant_key\s+text not null/i);
    // resolves the cohort participant on the stable internal key, within the cycle
    expect(SQL).toMatch(/p\.qm_participant_id = r->>'participant_key'/i);
    // participant_id is the RESOLVED uuid, nullable (unmatched surfaced, not dropped)
    expect(SQL).toMatch(/participant_id\s+uuid references participants\(id\)/i);
  });

  it("does not touch the engine / grade-bearing tables", () => {
    expect(SQL).not.toMatch(/\b(update|insert into|alter table)\s+(participant_scores|item_stats|score_runs|grades|alterations)\b/i);
  });
});

describe("0016 — rollback", () => {
  it("drops the functions and tables it created", () => {
    for (const t of ["incident_rows", "incident_import_mappings", "incident_settings", "incident_codes"]) {
      expect(ROLLBACK).toMatch(new RegExp(`drop table if exists ${t}`, "i"));
    }
    expect(ROLLBACK).toMatch(/drop function if exists public\.upsert_incident_code/i);
    expect(ROLLBACK).toMatch(/drop function if exists app\.incident_formula_add_only/i);
  });
});
