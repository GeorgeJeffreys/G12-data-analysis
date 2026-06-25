/**
 * Test Centre scoping dimension (migration 0010) — provider read/write contract.
 *
 * Centre sits ABOVE the year → sitting structure: each centre owns its own exam
 * years and sittings, and every year keeps its comparable period (its name, e.g.
 * "2026") so the same year can be aligned across centres. Centre is a partition /
 * labelling key only — it never touches scoring, so the non-centre paths must
 * behave exactly as before (parity).
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { Seed } from "@/lib/data/seed-types";
import type { CurrentUser } from "@/lib/data/types";

const VIEWER: CurrentUser = { id: "u-viewer", name: "Vera Viewer", initials: "VV", role: "viewer" };

const EMPTY_VALIDATION = {
  passed: true,
  checks: [],
  stats: { rawRows: 0, mcqRows: 0, droppedSurveyRows: 0, droppedNonMcqRows: 0, assessments: 0, participants: 0, items: 0 },
} as unknown as Seed["liveCycle"]["validation"];

/** A minimal two-centre seed: a live 2026 sitting under A, a prior 2025 under B. */
function twoCentreSeed(): Seed {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    engineVersion: "test",
    testCentres: [
      { id: "tc-a", name: "Shatila 1", code: "SHA1", slug: "shatila-1", active: true },
      { id: "tc-b", name: "Shatila 2", code: "SHA2", slug: "shatila-2", active: true },
    ],
    liveCycle: {
      id: "live", name: "May 2026", region: "eu-west", testCentreId: "tc-a",
      startedAt: "today", lastActivity: "today", stageIndex: 0, fileName: "", fileSizeMB: 0, uploadedAgo: "",
      validation: EMPTY_VALIDATION, preview: { headers: [], rows: [] }, duplicates: 0,
      participants: [], assessments: [], diagnostics: [],
    },
    priorCycles: [
      { id: "prior-b", name: "May 2025", testCentreId: "tc-b", stageIndex: 7, stepsDone: 8, participants: 0, assessments: 0, lastActivity: "2025", locked: true, mock: true },
    ],
  };
}

describe("test centres — default + CRUD", () => {
  it("the demo seeds one active centre that every year belongs to", () => {
    const p = new InMemoryDataProvider();
    const centres = p.listTestCentres();
    expect(centres.length).toBeGreaterThanOrEqual(1);
    expect(centres.some((c) => c.active)).toBe(true);
    // Every listed year carries the centre.
    for (const y of p.listYears()) {
      expect(y.testCentreId).toBeTruthy();
      expect(y.testCentreName).toBeTruthy();
    }
  });

  it("createTestCentre adds an active centre with a derived slug", () => {
    const p = new InMemoryDataProvider();
    const before = p.listTestCentres().length;
    p.createTestCentre({ name: "Shatila 2", code: "SHA2" });
    const centres = p.listTestCentres();
    expect(centres.length).toBe(before + 1);
    const created = centres.find((c) => c.code === "SHA2")!;
    expect(created).toBeDefined();
    expect(created.active).toBe(true);
    expect(created.slug).toBe("shatila-2");
  });

  it("slugs are de-duplicated when two centres share a name", () => {
    const p = new InMemoryDataProvider();
    p.createTestCentre({ name: "Shatila 1", code: "DUP" }); // collides with the seeded default
    const slugs = p.listTestCentres().map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // all unique
  });

  it("updateTestCentre renames + re-codes; setTestCentreActive toggles", () => {
    const p = new InMemoryDataProvider();
    p.createTestCentre({ name: "Beirut", code: "BEY" });
    const id = p.listTestCentres().find((c) => c.code === "BEY")!.id;
    p.updateTestCentre(id, { name: "Beirut Central", code: "BEYC" });
    let c = p.listTestCentres().find((x) => x.id === id)!;
    expect(c.name).toBe("Beirut Central");
    expect(c.code).toBe("BEYC");
    p.setTestCentreActive(id, false);
    c = p.listTestCentres().find((x) => x.id === id)!;
    expect(c.active).toBe(false);
  });

  it("centre management is Lead/Admin only (a viewer cannot mutate)", () => {
    const p = new InMemoryDataProvider(undefined, VIEWER);
    const before = p.listTestCentres().length;
    p.createTestCentre({ name: "Nope", code: "NOPE" });
    expect(p.listTestCentres().length).toBe(before);
  });
});

describe("test centres — scoping & labelling", () => {
  it("two centres can run the same year as distinct rows sharing the period", () => {
    const p = new InMemoryDataProvider(twoCentreSeed());
    const years = p.listYears();
    const a = years.find((y) => y.testCentreId === "tc-a")!;
    const b = years.find((y) => y.testCentreId === "tc-b")!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.testCentreName).toBe("Shatila 1");
    expect(b.testCentreName).toBe("Shatila 2");
    // The non-primary centre's year id is qualified so the ids never collide.
    expect(a.id).not.toBe(b.id);
  });

  it("the new-sitting model offers active centres and pre-selects one", () => {
    const p = new InMemoryDataProvider(twoCentreSeed());
    const m = p.getNewCycle();
    expect(m.testCentres.map((c) => c.id)).toEqual(["tc-a", "tc-b"]);
    expect(m.defaultTestCentreId).toBe("tc-a");
  });

  it("createCycle records the chosen centre in the audit trail", () => {
    const p = new InMemoryDataProvider(twoCentreSeed());
    return p.createCycle({ name: "May 2026", sittingDate: "14 May 2026", assessmentIds: [], testCentreId: "tc-b" }).then(() => {
      const entry = p.getAuditLog(null, "all", "").entries.find((e) => /created cycle/i.test(e.action) && !e.seeded);
      expect(entry).toBeDefined();
      expect(entry!.detail).toContain("Shatila 2");
    });
  });
});

describe("test centres — parity for non-centre paths", () => {
  it("the seeded demo year keeps its stable `year-2026` id (route + rollup parity)", () => {
    const p = new InMemoryDataProvider();
    const ids = p.listYears().map((y) => y.id);
    expect(ids).toContain("year-2026");
    // The Overall rollup still resolves by that id (unchanged behaviour).
    expect(p.getYear("year-2026")).not.toBeNull();
  });
});
