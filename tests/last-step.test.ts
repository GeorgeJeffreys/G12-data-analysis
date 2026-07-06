/**
 * Bug 3 — step-aware Critical Path memory. The Critical Path entry routes to the
 * step the user last had open (per cycle), not the first-incomplete step (Clean).
 * This locks the persistence primitive + the entry-page target rule.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { stageRoute } from "@/lib/data/pipeline-route";

// Minimal localStorage stub (the test env is node — no window/DOM).
function installLocalStorage() {
  const map = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  vi.stubGlobal("window", { localStorage: ls });
  return map;
}

describe("cycle step memory (Bug 3)", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("records and reads back the last-open step, per cycle", async () => {
    installLocalStorage();
    const { recordCycleStep, readCycleStep } = await import("@/lib/ui/last-step");
    expect(readCycleStep("cyc-1")).toBeNull(); // nothing yet → fall back to doNext
    recordCycleStep("cyc-1", 7); // user opened Cut scores
    recordCycleStep("cyc-2", 3);
    expect(readCycleStep("cyc-1")).toBe(7);
    expect(readCycleStep("cyc-2")).toBe(3);
  });

  it("is SSR-safe — no window means no memory, never a throw", async () => {
    vi.unstubAllGlobals(); // no window
    const { recordCycleStep, readCycleStep } = await import("@/lib/ui/last-step");
    expect(() => recordCycleStep("cyc-1", 5)).not.toThrow();
    expect(readCycleStep("cyc-1")).toBeNull();
  });

  it("the remembered step maps to that step's route (not Clean)", async () => {
    installLocalStorage();
    const { recordCycleStep, readCycleStep } = await import("@/lib/ui/last-step");
    recordCycleStep("cyc-9", 7);
    const remembered = readCycleStep("cyc-9")!;
    expect(stageRoute("cyc-9", remembered)).toBe("/cycles/cyc-9/boundaries"); // Cut scores
    expect(stageRoute("cyc-9", remembered)).not.toBe("/cycles/cyc-9/clean");
    // An out-of-range value maps to the base path → the entry treats it as "no
    // memory" and falls back to doNext.
    expect(stageRoute("cyc-9", 999)).toBe("/cycles/cyc-9");
  });
});
