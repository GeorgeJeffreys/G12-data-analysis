"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** /settings → the first settings tab (Users & access). */
export default function SettingsIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/users");
  }, [router]);
  return null;
}
