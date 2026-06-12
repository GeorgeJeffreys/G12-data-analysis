import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Privileged, server-only Supabase client using the **secret** key (sb_secret_…).
 * It bypasses Row Level Security, so it is used ONLY for genuinely privileged
 * work that has no user session: the engine write path (persisting item_stats /
 * participant_scores) and seeding the database.
 *
 * The `import "server-only"` guard makes the build fail if this module is ever
 * pulled into a client bundle, so the secret key can never reach the browser.
 * Everything user-facing must use the RLS-scoped clients in ./client and ./server.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (server-only). " +
        "Set them in .env.local — the secret key must never be a NEXT_PUBLIC_* var.",
    );
  }

  return createSupabaseClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SupabaseAdminClient = ReturnType<typeof createAdminClient>;
