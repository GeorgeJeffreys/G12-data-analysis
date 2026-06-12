import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database";

/**
 * Refresh the Supabase auth session on every request and write the rotated
 * cookies onto the response, per the @supabase/ssr App Router guidance. Without
 * this, server components can read a stale/expired session.
 *
 * Inert when Supabase isn't configured (the in-memory demo / tests), so a
 * no-network setup is unaffected.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response; // not configured → no-op

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Touch the user to trigger a token refresh when needed. Do not gate routing
  // here — invite-only access is enforced by the provider's access-denied state.
  await supabase.auth.getUser();

  return response;
}
