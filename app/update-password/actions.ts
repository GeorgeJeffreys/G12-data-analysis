"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Set the signed-in user's password via the recovery session.
 *
 * On success: clears the `pwreset-marker` cookie (so the page can't be reused
 * as a general change-password surface), then signs out all sessions so the old
 * password can't be replayed from another device. Returns {error: null}.
 *
 * On failure: returns {error: message} — marker and session are untouched so the
 * user can try again.
 */
export async function updatePassword(password: string): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  const cookieStore = cookies();
  cookieStore.delete("pwreset-marker");

  await supabase.auth.signOut({ scope: "global" });
  return { error: null };
}
