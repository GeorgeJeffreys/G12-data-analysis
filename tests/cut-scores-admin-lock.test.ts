/**
 * P3 — cut scores are locked to admins SERVER-SIDE (the real lock).
 *
 * The authorization is enforced in Postgres (migration 0010): the
 * `save_grade_scheme` SECURITY DEFINER RPC rejects a non-admin and admits an
 * admin, and the `grade_schemes` write RLS policy is gated on `app.is_admin()`
 * as a backstop for any direct-table write. There is no live database in the
 * test runner, so we assert the migration encodes that contract — a static check
 * that the server lock exists and was not weakened. The client read-only view is
 * covered separately in boundaries-readonly.render.test.ts (that guard is UX
 * only and is explicitly NOT the protection).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const sql = readFileSync(
  path.join(root, "supabase/migrations/0010_user_roles_admin.sql"),
  "utf8",
);

/** Extract the body of a `create or replace function NAME(...) ... $$;` block. */
function fnBody(name: string): string {
  const start = sql.indexOf(`function ${name}(`);
  expect(start, `function ${name} not found in migration`).toBeGreaterThan(-1);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$", open + 2);
  return sql.slice(open + 2, close);
}

describe("0010 — cut-score writes are admin-gated server-side", () => {
  it("save_grade_scheme rejects a non-admin and only proceeds for an admin", () => {
    const body = fnBody("public.save_grade_scheme");
    // The gate: not authorized unless the caller is a global admin.
    expect(body).toMatch(/if\s+not\s*\(.*app\.is_admin\(\).*\)\s*then/s);
    expect(body).toContain("raise exception 'not authorized'");
    // An admin's write still reaches the upsert + audit (the success path).
    expect(body).toContain("insert into grade_schemes");
    expect(body).toContain("boundary_change");
  });

  it("grade_schemes write RLS is gated on app.is_admin() (direct-table backstop)", () => {
    const policy = sql.slice(sql.indexOf("create policy grade_schemes_write"));
    expect(policy).toMatch(/for all\s+using \(app\.is_admin\(\)/);
    expect(policy).toMatch(/with check \(app\.is_admin\(\)/);
  });

  it("defines the admin predicate from the new profiles.role", () => {
    const body = fnBody("app.is_admin");
    expect(body).toContain("from profiles");
    expect(body).toContain("auth.uid()");
    expect(body).toContain("role = 'admin'");
  });
});

describe("0010 — roles model: read own role, only admins assign", () => {
  it("profiles RLS lets a user read their own row (or an admin read any)", () => {
    const select = sql.slice(sql.indexOf("create policy profiles_select"));
    expect(select).toMatch(/for select\s+using \(user_id = auth\.uid\(\) or app\.is_admin\(\)\)/);
  });

  it("only admins may write profiles (no self-promotion path)", () => {
    const write = sql.slice(sql.indexOf("create policy profiles_admin_write"));
    expect(write).toMatch(/for all\s+using \(app\.is_admin\(\)\)/);
    expect(write).toMatch(/with check \(app\.is_admin\(\)\)/);
  });

  it("set_user_role is admin-only and audited", () => {
    const body = fnBody("public.set_user_role");
    expect(body).toContain("if not app.is_admin() then");
    expect(body).toContain("raise exception 'not authorized'");
    expect(body).toContain("role_change");
    expect(sql).toContain("grant execute on function public.set_user_role(uuid, app_role) to authenticated");
  });

  it("ships a first-admin bootstrap snippet (admin/user roles + auth.users link)", () => {
    expect(sql).toContain("create type app_role as enum ('admin','user')");
    expect(sql).toContain("references auth.users(id)");
    expect(sql).toContain("BOOTSTRAP THE FIRST ADMIN");
    expect(sql).toContain("set role = 'admin'");
  });
});
