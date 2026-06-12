import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";

/**
 * Browser Supabase client. Uses the public **publishable** key (sb_publishable_…);
 * all access is gated by Row Level Security (Section 3 of the spec). Status /
 * computed / decision columns are never writable through this client — those
 * transitions go through SECURITY DEFINER functions (see supabase/migrations).
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

  return createBrowserClient<Database>(url, key);
}
