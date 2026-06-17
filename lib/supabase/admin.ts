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
  const rawSecret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !rawSecret) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (server-only). " +
        "Set them in .env.local — the secret key must never be a NEXT_PUBLIC_* var.",
    );
  }

  // Defensive guard: a stray space/newline in the Vercel env var would otherwise
  // make `Headers.set` throw an opaque `TypeError` deep in the request layer —
  // and that TypeError embeds the key value, so it must never reach the client.
  // Trim and validate the shape here so a bad value fails fast with a clear,
  // server-side config error that NEVER contains the key itself.
  const secret = rawSecret.trim();
  if (!secret.startsWith("sb_secret_") || /\s/.test(secret)) {
    throw new Error(
      "SUPABASE_SECRET_KEY is malformed — check the Vercel env var for stray whitespace.",
    );
  }

  return createSupabaseClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SupabaseAdminClient = ReturnType<typeof createAdminClient>;
