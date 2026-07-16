import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { UpdatePasswordForm } from "./UpdatePasswordForm";

/**
 * Password-update page. Only reachable after a successful /auth/confirm exchange:
 * requires both an active session AND the `pwreset-marker` cookie set by that
 * handler. This prevents any authenticated session from using the page as a
 * general change-password surface.
 */
export default async function UpdatePasswordPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/forgot-password");

  const cookieStore = cookies();
  if (!cookieStore.get("pwreset-marker")) redirect("/forgot-password");

  return <UpdatePasswordForm />;
}
