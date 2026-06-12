import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";

/**
 * Server-side Supabase client bound to the request cookies. Use this in Server
 * Components, Route Handlers and Server Actions. Still operates as the signed-in
 * user with the **publishable** key (RLS applies); it does NOT use the secret key.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
        "Copy .env.example to .env.local and fill in your Supabase project keys.",
    );
  }

  const cookieStore = cookies();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // `setAll` called from a Server Component — safe to ignore when
          // middleware is responsible for refreshing the session.
        }
      },
    },
  });
}
