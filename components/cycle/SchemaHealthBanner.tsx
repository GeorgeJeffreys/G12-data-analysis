"use client";

/**
 * Schema drift banner (task 18). Probes the live DB on mount and, when it is
 * behind the code (a required column/function is missing), shows an explicit
 * "run migration NNNN in Supabase" banner on the Upload screen — so the answer
 * to "did you run the migration?" comes from the app, not from a failed import.
 *
 * Silent when healthy (the common case) and silent in the demo provider (no DB,
 * always ok). Non-blocking: it never prevents an upload attempt, it just warns.
 */
import { useEffect, useState } from "react";
import { useProvider } from "@/lib/data/context";
import type { SchemaHealth } from "@/lib/data/provider";
import { H } from "@/lib/ui/tokens";
import { Mark } from "@/components/ui/icons";

export function SchemaHealthBanner() {
  const provider = useProvider();
  const [health, setHealth] = useState<SchemaHealth | null>(null);

  useEffect(() => {
    let live = true;
    provider
      .getSchemaHealth()
      .then((h) => { if (live) setHealth(h); })
      .catch(() => { /* probe unavailable — stay silent, ingest is the backstop */ });
    return () => { live = false; };
  }, [provider]);

  if (!health || health.ok) return null;

  const missing = [...health.missingColumns, ...health.missingFunctions];
  return (
    <div
      role="alert"
      className="hf-card"
      style={{ padding: "14px 16px", background: H.badSoft, borderColor: H.bad, display: "flex", gap: 12, alignItems: "flex-start" }}
    >
      <Mark kind="fail" size={17} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: H.bad, fontSize: 13 }}>
          Database schema is out of date — imports will fail.
        </div>
        <div className="hf-sub" style={{ marginTop: 5 }}>
          Run migration <span className="hf-mono">{health.migration}</span> in the Supabase SQL editor, then reload.
          {missing.length > 0 && (
            <>
              {" "}Missing: <span className="hf-mono">{missing.join(", ")}</span>.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
