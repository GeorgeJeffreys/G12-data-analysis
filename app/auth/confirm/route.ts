import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Allow only internal absolute paths (no open-redirect). */
function safePath(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/update-password";
}

/**
 * Password-reset callback. Supabase sends the user here after they click the
 * link in the reset email:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/update-password
 *
 * On success: sets a short-lived `pwreset-marker` cookie (proves this session
 * arrived via the recovery flow), then redirects to `next`.
 * On failure: redirects to /auth/auth-code-error.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safePath(searchParams.get("next"));

  if (!token_hash || type !== "recovery") {
    return NextResponse.redirect(new URL("/auth/auth-code-error", origin));
  }

  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash, type: "recovery" });

  if (error) {
    return NextResponse.redirect(new URL("/auth/auth-code-error", origin));
  }

  // Mark this session as arriving via the recovery flow. /update-password checks
  // for this cookie so it can't be used as a general change-password surface by
  // any authenticated session.
  const cookieStore = cookies();
  cookieStore.set("pwreset-marker", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(new URL(next, origin));
}
