/**
 * Migration 0044_exam_incidents.sql — structural safety guard (the SQL is applied
 * by a human in the Supabase editor, so it can't run in CI). Locks the properties
 * that matter: the staging table exists with the natural key + repo-correct types;
 * RLS + cycle-role security follow the incident pattern; STAGING ONLY (the upsert
 * never writes adjustment_* / the engine is untouched); and the rollback drops it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0044_exam_incidents.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0044_exam_incidents.rollback.sql"), "utf8");

describe("0044 — table + keys + repo-correct types", () => {
  it("creates the exam_incidents staging table", () => {
    expect(SQL).toMatch(/create table if not exists exam_incidents/i);
  });

  it("keys the upsert on the unique natural key `reference`", () => {
    expect(SQL).toMatch(/reference\s+text\s+not null/i);
    expect(SQL).toMatch(/unique \(reference\)/i);
    expect(SQL).toMatch(/on conflict \(reference\) do update/i);
  });

  it("stores the sitting id as TEXT (qm_result_id is text, not bigint)", () => {
    expect(SQL).toMatch(/matched_qm_result_id\s+text/i);
    expect(SQL).not.toMatch(/matched_qm_result_id\s+bigint/i);
  });

  it("stores the email NOT NULL + the STU-… id as an informational column", () => {
    expect(SQL).toMatch(/student_email\s+text not null/i);
    expect(SQL).toMatch(/student_id_external\s+text/i);
  });

  it("constrains match_status to the reconciliation buckets and duration ≥ 0", () => {
    expect(SQL).toMatch(/match_status in \('matched','out_of_scope_cycle','staff_excluded','unmatched_email','unmatched_subject','duplicate'\)/i);
    expect(SQL).toMatch(/duration_min is null or duration_min >= 0/i);
  });

  it("indexes (exam_cycle, subject_key) and student_email", () => {
    expect(SQL).toMatch(/on exam_incidents \(exam_cycle, subject_key\)/i);
    expect(SQL).toMatch(/on exam_incidents \(student_email\)/i);
  });
});

describe("0044 — security follows the incident pattern", () => {
  it("enables RLS, a member SELECT policy, and revokes direct client writes", () => {
    expect(SQL).toMatch(/alter table exam_incidents enable row level security/i);
    expect(SQL).toMatch(/for select using \(app\.is_member\(cycle_id\)\)/i);
    expect(SQL).toMatch(/revoke insert, update, delete on exam_incidents from authenticated, anon/i);
  });

  it("the upsert is a cycle-role SECURITY DEFINER function that audits", () => {
    const body = SQL.slice(SQL.search(/function public\.upsert_exam_incidents/i));
    expect(body.slice(0, 900)).toMatch(/app\.has_role\(p_cycle, array\['lead_admin','reviewer'\]::member_role\[\]\)/i);
    expect(body).toMatch(/security definer set search_path = public, app/i);
    expect(SQL).toMatch(/perform app\.audit\(p_cycle, 'upsert_exam_incidents'/i);
  });
});

describe("0044 — STAGING ONLY (no marks adjusted)", () => {
  it("never writes the adjustment_* columns in the upsert", () => {
    const body = SQL.slice(SQL.search(/function public\.upsert_exam_incidents/i));
    const upsert = body.slice(0, body.indexOf("end $$"));
    // adjustment columns are declared nullable but the upsert must not set them.
    expect(upsert).not.toMatch(/adjustment_type\s*=/i);
    expect(upsert).not.toMatch(/adjustment_magnitude\s*=/i);
  });

  it("declares the adjustment columns nullable + does not touch the engine seams", () => {
    expect(SQL).toMatch(/adjustment_type\s+text,/i);
    expect(SQL).toMatch(/adjustment_magnitude\s+numeric,/i);
    // no writes to participant_scores / alterations from this migration
    expect(SQL).not.toMatch(/insert into alterations/i);
    expect(SQL).not.toMatch(/participant_scores/i);
  });
});

describe("0044 — rollback", () => {
  it("drops the table and both functions", () => {
    expect(ROLLBACK).toMatch(/drop table if exists exam_incidents/i);
    expect(ROLLBACK).toMatch(/drop function if exists public\.upsert_exam_incidents/i);
    expect(ROLLBACK).toMatch(/drop function if exists public\.clear_exam_incidents/i);
  });
});
