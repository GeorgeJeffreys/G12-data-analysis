/**
 * Migration 0040_dynamic_roles.sql — structural safety guard.
 *
 * The SQL is applied by a human in the Supabase editor, so it can't run in CI. This
 * locks the properties that make the dynamic-roles spine correct server-side: the
 * roles + role_actions tables and their access-reproducing seed, memberships.role_id
 * with the enum backfill, app.can_do (replacing app.has_capability), the role-admin
 * RPCs with all four lockout guards, and set_member_role moving onto role_id.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(resolve(__dirname, "../supabase/migrations/0040_dynamic_roles.sql"), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../supabase/migrations/0040_dynamic_roles.rollback.sql"), "utf8");

function fnBody(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function (public|app)\\.${name}\\b`, "i"));
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end);
}

describe("0040 — tables, seed, spine", () => {
  it("creates roles + role_actions with the cascade and seeds the three roles", () => {
    expect(SQL).toMatch(/create table if not exists public\.roles/);
    expect(SQL).toMatch(/create table if not exists public\.role_actions/);
    expect(SQL).toMatch(/references public\.roles\(id\) on delete cascade/);
    expect(SQL).toMatch(/\('G12 team member', false, 0\)/);
    expect(SQL).toMatch(/\('Data analyst',\s+false, 1\)/);
    expect(SQL).toMatch(/\('Admin',\s+true,\s+2\)/);
  });

  it("seeds the grid to reproduce today's effective access per role", () => {
    // team member holds clean.rows + review.exclude, NOT cuts.set / signoff.
    expect(SQL).toMatch(/\('G12 team member','clean\.rows'\)/);
    expect(SQL).toMatch(/\('G12 team member','review\.exclude'\)/);
    expect(SQL).not.toMatch(/\('G12 team member','cuts\.set'\)/);
    expect(SQL).not.toMatch(/\('G12 team member','general\.signoff'\)/);
    // analyst adds cuts.set + general.audit + upload.ingest.
    expect(SQL).toMatch(/\('Data analyst','cuts\.set'\)/);
    expect(SQL).toMatch(/\('Data analyst','general\.audit'\)/);
    expect(SQL).toMatch(/\('Data analyst','upload\.ingest'\)/);
    expect(SQL).not.toMatch(/\('Data analyst','general\.signoff'\)/);
    // admin holds the exclusive actions, incl. the new awards.generate + manage_roles.
    expect(SQL).toMatch(/\('Admin','general\.manage_roles'\)/);
    expect(SQL).toMatch(/\('Admin','awards\.generate'\)/);
    expect(SQL).toMatch(/\('Admin','general\.delete'\)/);
  });

  it("adds memberships.role_id, relaxes the enum, and backfills from it", () => {
    expect(SQL).toMatch(/alter table public\.memberships add column if not exists role_id uuid references public\.roles\(id\)/);
    expect(SQL).toMatch(/alter table public\.memberships alter column role drop not null/);
    expect(SQL).toMatch(/when 'lead_admin' then 'Admin'/);
    expect(SQL).toMatch(/when 'analyst'\s+then 'Data analyst'/);
  });

  it("adds app.can_do (role_id → granted action, workspace-aware) and retires has_permission", () => {
    const body = fnBody(SQL, "can_do");
    expect(body).toMatch(/create or replace function app\.can_do\(p_cycle uuid, p_action text\)/);
    expect(body).toMatch(/join role_actions ra\s*\n\s*on ra\.role_id = m\.role_id and ra\.action = p_action and ra\.granted/);
    expect(body).toMatch(/m\.cycle_id is null or m\.cycle_id = p_cycle/);
    expect(SQL).toMatch(/drop function if exists app\.has_permission\(uuid, text\)/);
  });

  it("RLS: roles + role_actions readable by members; direct writes revoked", () => {
    expect(SQL).toMatch(/create policy roles_select\s+on public\.roles\s+for select using \(auth\.uid\(\) is not null\)/);
    expect(SQL).toMatch(/create policy role_actions_select on public\.role_actions for select using \(auth\.uid\(\) is not null\)/);
    expect(SQL).toMatch(/revoke insert, update, delete on public\.role_actions from authenticated, anon/);
  });
});

describe("0040 — role-admin RPCs, all gated on general.manage_roles + lockout-guarded", () => {
  for (const fn of ["create_role", "rename_role", "delete_role", "set_role_action"]) {
    it(`${fn} → can_do(null, 'general.manage_roles')`, () => {
      expect(fnBody(SQL, fn)).toMatch(/app\.can_do\(null, 'general\.manage_roles'\)/);
    });
  }

  it("delete_role enforces the Admin-undeletable + has-members + orphan guards", () => {
    const body = fnBody(SQL, "delete_role");
    expect(body).toMatch(/the Admin role cannot be deleted/);
    expect(body).toMatch(/cannot delete a role that still has members/);
    expect(body).toMatch(/cannot delete the last role that can manage roles/);
  });

  it("set_role_action locks the Admin manage_roles/manage_users cells + the orphan guard", () => {
    const body = fnBody(SQL, "set_role_action");
    expect(body).toMatch(/general\.manage_roles', 'general\.manage_users'/);
    expect(body).toMatch(/at least one role must keep general\.manage_roles/);
  });
});

describe("0040 — member RPCs move onto role_id + general.manage_users", () => {
  it("set_member_role(p_role_id) is gated on manage_users and the old signature is dropped", () => {
    const body = fnBody(SQL, "set_member_role");
    expect(body).toMatch(/set_member_role\(p_user uuid, p_cycle uuid, p_role_id uuid\)/);
    expect(body).toMatch(/app\.can_do\(p_cycle, 'general\.manage_users'\)/);
    expect(body).toMatch(/set role_id = p_role_id/);
    expect(SQL).toMatch(/drop function if exists public\.set_member_role\(uuid, uuid, member_role\)/);
  });

  it("invite_member(p_role_id) is gated on manage_users and drops the enum signature", () => {
    const body = fnBody(SQL, "invite_member");
    expect(body).toMatch(/invite_member\(p_email text, p_role_id uuid/);
    expect(body).toMatch(/app\.can_do\(p_cycle, 'general\.manage_users'\)/);
    expect(SQL).toMatch(/drop function if exists public\.invite_member\(text, member_role, uuid\)/);
  });
});

describe("0040 rollback restores the enum-only spine", () => {
  it("drops the new objects and restores the member_role-typed member RPCs", () => {
    expect(ROLLBACK).toMatch(/drop function if exists app\.can_do\(uuid, text\)/);
    expect(ROLLBACK).toMatch(/drop table if exists public\.role_actions/);
    expect(ROLLBACK).toMatch(/drop table if exists public\.roles/);
    expect(ROLLBACK).toMatch(/set_member_role\(p_user uuid, p_cycle uuid, p_role member_role\)/);
  });
});
