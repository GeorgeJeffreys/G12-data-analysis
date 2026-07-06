/**
 * POST /api/members/invite — invite a person and grant them a real membership.
 *
 * The Supabase invite flow (`auth.admin.inviteUserByEmail`) creates the auth.users
 * row and emails an invite; we then upsert the initial `memberships` row with the
 * chosen role/scope, so on acceptance the user has real, working permissions. If the
 * account already exists we skip the invite and just grant/refresh the membership.
 *
 * Authorized like every other privileged write: the CALLER must be an admin of the
 * target scope (workspace, or the specific cycle), checked with the same C1 rule the
 * DB enforces (canManageCycle mirrors app.has_role). The service-role admin client is
 * used only AFTER that check — it is the sanctioned writer for auth.admin + the
 * not-client-writable membership grant.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageCycle, type Membership } from "@/lib/auth/membership-access";
import { storageRoleForTier, type RoleTier } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InviteBody {
  email?: string;
  role?: RoleTier;
  cycleId?: string | null;
}

/** Find an existing auth user id by email (case-insensitive), paging the admin list. */
async function findUserIdByEmail(admin: ReturnType<typeof createAdminClient>, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const caller = auth.user;
  if (!caller) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  let body: InviteBody;
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const tier = body.role;
  const cycleId = body.cycleId ?? null;
  if (!email || !tier) return NextResponse.json({ error: "email and role are required" }, { status: 400 });

  const admin = createAdminClient();

  // Authorize the CALLER as an admin of the target scope (mirrors app.has_role).
  const { data: rows, error: memErr } = await admin
    .from("memberships")
    .select("role,cycle_id")
    .eq("user_id", caller.id);
  if (memErr) return NextResponse.json({ error: `Couldn’t verify your access: ${memErr.message}` }, { status: 500 });
  if (!canManageCycle((rows ?? []) as unknown as Membership[], cycleId)) {
    return NextResponse.json({ error: "Not authorized: only an admin may invite members" }, { status: 403 });
  }

  const role = storageRoleForTier(tier);

  // Find or invite the auth user.
  let userId = await findUserIdByEmail(admin, email);
  let invited = false;
  if (!userId) {
    const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(email);
    if (invErr || !inv?.user) {
      return NextResponse.json({ error: `Invite failed: ${invErr?.message ?? "unknown error"}` }, { status: 500 });
    }
    userId = inv.user.id;
    invited = true;
  }

  // Upsert the membership grant (service role bypasses RLS — the caller is authorized above).
  const mem = admin.from("memberships") as unknown as {
    select(c: string): { eq(k: string, v: string): { is(k: string, v: null): Promise<{ data: { id: string }[] | null }>; eq(k: string, v: string): Promise<{ data: { id: string }[] | null }> } };
    update(v: unknown): { eq(k: string, v: string): Promise<{ error: { message: string } | null }> };
    insert(v: unknown): Promise<{ error: { message: string } | null }>;
  };
  const q = mem.select("id").eq("user_id", userId);
  const { data: existing } = await (cycleId === null ? q.is("cycle_id", null) : q.eq("cycle_id", cycleId));
  let writeErr: { message: string } | null = null;
  if (existing && existing.length > 0) {
    ({ error: writeErr } = await mem.update({ role }).eq("id", existing[0]!.id));
  } else {
    ({ error: writeErr } = await mem.insert({ user_id: userId, cycle_id: cycleId, role }));
  }
  if (writeErr) return NextResponse.json({ error: `Grant failed: ${writeErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, status: invited ? "invited" : "granted" });
}
