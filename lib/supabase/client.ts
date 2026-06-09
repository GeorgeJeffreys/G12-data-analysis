import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";

/**
 * Browser Supabase client. Uses the public anon key; all access is gated by
 * Row Level Security (Section 3 of the spec). Status / computed / decision
 * columns are never writable through this client — those transitions go
 * through SECURITY DEFINER functions (see supabase/migrations/0001_init.sql).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and fill in your Supabase project keys.",
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
