/**
 * Destructive sitting controls (migration 0007) — provider wiring + audit.
 *
 * The live behaviour (cycle-scoped DELETEs, all-or-nothing) lives in the SQL
 * functions `clear_sitting_data` / `delete_sitting`, which the Supabase provider
 * invokes; those enforce `where cycle_id = p_cycle`, so they never touch another
 * cycle. Here we cover the demo provider's side of the contract: both actions are
 * audited (so the Audit-log tab records them) and resolve through the async
 * interface the UI awaits.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import seedJson from "@/lib/data/seed.generated.json";

const seed = seedJson as unknown as { liveCycle: { id: string } };
const CYCLE = seed.liveCycle.id;

describe("sitting controls — clear / delete", () => {
  it("clearSittingData audits a cycle-scoped clear and resolves", async () => {
    const p = new InMemoryDataProvider();
    await p.clearSittingData(CYCLE);
    const entries = p.getAuditLog(CYCLE, "all", "").entries;
    const cleared = entries.find((e) => /clear/i.test(e.action) && !e.seeded);
    expect(cleared).toBeDefined();
    expect(cleared!.cycleId).toBe(CYCLE);
  });

  it("deleteSitting audits the deletion at the workspace level and resolves", async () => {
    const p = new InMemoryDataProvider();
    await p.deleteSitting(CYCLE);
    // Recorded with cycleId = null so the record survives the cycle's removal —
    // surfaced under the workspace (null) audit view.
    const deleted = p.getAuditLog(null, "all", "").entries.find((e) => /delet/i.test(e.action) && !e.seeded);
    expect(deleted).toBeDefined();
    expect(deleted!.cycleId).toBeNull();
  });
});
