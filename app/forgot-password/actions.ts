"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Request a password-reset email.
 *
 * Always resolves without error regardless of whether the address exists —
 * identical response for known and unknown addresses (enumeration guard). Errors
 * from Supabase are swallowed here; the caller should show the same "check your
 * email" message unconditionally.
 *
 * Called with no options object so `redirectTo` is absent. The reset link's host
 * comes from the Supabase dashboard Site URL (set once, never from a request
 * header), making host-poisoning structurally impossible.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;

  try {
    const supabase = createClient();
    // One argument only — no options, no redirectTo.
    await supabase.auth.resetPasswordForEmail(email);
  } catch {
    // Swallow: byte-identical response is the guarantee.
  }
}
