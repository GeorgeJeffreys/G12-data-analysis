import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Root middleware: keep the Supabase auth session fresh (cookie rotation) on
 * every navigation. No-op when Supabase isn't configured.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on everything except static assets and image optimisation.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
