/**
 * Cycle lifecycle: create under a real centre, delete with a full cascade (task 23).
 *
 * Two label/mistyped-id fixes on the create/delete path:
 *  1. The "Start a sitting" centre picker must offer the centre's REAL id (a DB
 *     UUID), never a mock slug id (`tc-shatila-1`) — that slug is what broke the
 *     create insert with `invalid input syntax for type uuid`. A DEFINED (even
 *     empty) test-centre list is live data and is used verbatim; only the demo seed
 *     (field absent) falls back to a single labelling centre.
 *  2. `deleteCycle` removes the cycle and everything keyed to it, with no last-cycle
 *     restriction: an admin may delete every cycle, leaving an empty workspace.
 */
import { describe, it, expect } from "vitest";
import seedJson from "@/lib/data/seed.generated.json";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { Seed } from "@/lib/data/seed-types";
import type { TestCentreSummary } from "@/lib/data/types";

const REAL_CENTRES: TestCentreSummary[] = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Shatila 1", code: "SHA1", slug: "shatila-1", active: true },
  { id: "bbbbbbbb-0000-0000-0000-000000000002", name: "Shatila 2", code: "SHA2", slug: "shatila-2", active: true },
];

function clone(): Seed {
  return JSON.parse(JSON.stringify(seedJson)) as Seed;
}

describe("create-sitting centre picker submits a real centre UUID", () => {
  it("offers the real centre ids (never the mock tc-shatila-1) when live centres are present", () => {
    const seed = clone();
    seed.testCentres = REAL_CENTRES;
    const p = new InMemoryDataProvider(seed);

    const model = p.getNewCycle();
    const ids = model.testCentres.map((c) => c.id);
    expect(ids).toEqual(REAL_CENTRES.map((c) => c.id));
    expect(ids).not.toContain("tc-shatila-1");
    // The default selection is a real UUID — the value the create insert receives.
    expect(model.defaultTestCentreId).toBe(REAL_CENTRES[0]!.id);
  });

  it("a live workspace with zero centres shows an empty picker (no mock leak)", () => {
    const seed = clone();
    seed.testCentres = []; // DEFINED but empty = live, none yet
    const p = new InMemoryDataProvider(seed);

    expect(p.getNewCycle().testCentres).toHaveLength(0);
    expect(p.listTestCentres()).toHaveLength(0);
  });

  it("the demo seed (no test-centre field) still falls back to a single labelling centre", () => {
    const seed = clone();
    delete (seed as { testCentres?: unknown }).testCentres; // absent = demo
    const p = new InMemoryDataProvider(seed);
    expect(p.listTestCentres().length).toBeGreaterThan(0);
  });
});

describe("deleteCycle — full removal, no last-cycle restriction", () => {
  it("deletes the only remaining cycle without refusing (zero cycles is allowed)", async () => {
    const seed = clone();
    seed.priorCycles = []; // exactly one cycle (the live one)
    const p = new InMemoryDataProvider(seed);
    expect(p.listCycles()).toHaveLength(1);

    const cycleId = p.listCycles()[0]!.id;
    await expect(p.deleteCycle(cycleId)).resolves.toBeUndefined();
    // Demo caveat: with no DB the sole seeded cycle is emptied to the Upload baseline
    // rather than removed as a row (the live Supabase path deletes for real to zero).
    expect(p.getCycle(cycleId)!.participants).toBe(0);
    expect(p.getCycle(cycleId)!.assessmentCount).toBe(0);
  });

  it("deletes a cycle when others remain", async () => {
    const p = new InMemoryDataProvider(); // default seed carries prior cycles too
    expect(p.listCycles().length).toBeGreaterThan(1);
    const cycleId = p.listCycles()[0]!.id;

    await expect(p.deleteCycle(cycleId)).resolves.toBeUndefined();
    // The deleted (live) cycle is emptied to the Upload baseline — its data is gone.
    expect(p.getCycle(cycleId)!.participants).toBe(0);
    expect(p.getCycle(cycleId)!.assessmentCount).toBe(0);
  });
});
