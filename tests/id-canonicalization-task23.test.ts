/**
 * Task 23 — one canonical ID per entity, carried Upload → Grades and across routing.
 *
 * These lock the ID pattern the app kept re-breaking:
 *   1. QuestionId is canonicalised the SAME way as ResultId (numeric-skew safe), so
 *      a padded / `.0` / quoted QuestionId can't miss the item join or escape dedup.
 *   2. Routing keys on the real exam_years id, NEVER the year label — a null / blank
 *      / "Unknown" year name still resolves and loads, and two years whose names both
 *      parse to "Unknown" never collapse into one route.
 *   3. Count preservation: on the 700435 fixture, `responses` distinct sittings ==
 *      the roster's distinct sittings, per subject (Math 15 / English 12 /
 *      Scientific 12 / Arabic 9 / Life 11 at ingest) — the score matrix never
 *      collapses.
 *   4. The client integrity guard rejects a deliberately-collapsed write, including
 *      the string-vs-number ResultId case that was the historical root cause.
 *   5. The demo slug centre (`tc-shatila-1`) never leaks into a centre-less live
 *      workspace (the `invalid input syntax for type uuid` create-sitting failure).
 *   6. Delete cycle is admin-gated and refuses to remove the last remaining cycle.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeResultId, normalizeQuestionId } from "@/lib/ingest/qm/result-id";
import { ingestThreeExports, type NamedInput } from "@/lib/ingest/qm";
import { assertResponsesCoverSittings } from "@/lib/server/ingest-write";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { Seed } from "@/lib/data/seed-types";
import type { CurrentUser } from "@/lib/data/types";

vi.mock("server-only", () => ({}));

const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const read = (name: string) => readFileSync(path.join(qmDir, `${name}.csv`));
const qmFiles = (): NamedInput[] => [
  { name: "Items.csv", data: read("Items") },
  { name: "Assessments.csv", data: read("Assessments") },
  { name: "Topics.csv", data: read("Topics") },
];

const EMPTY_VALIDATION = {
  passed: true,
  checks: [],
  stats: { rawRows: 0, mcqRows: 0, droppedSurveyRows: 0, droppedNonMcqRows: 0, assessments: 0, participants: 0, items: 0 },
} as unknown as Seed["liveCycle"]["validation"];

/** A minimal seed with an optional list of extra (prior) cycles + centres. */
function seedWith(opts: {
  centres?: Seed["testCentres"];
  live: { id: string; name: string; testCentreId?: string; yearId?: string };
  priors?: Seed["priorCycles"];
}): Seed {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    engineVersion: "test",
    testCentres: opts.centres,
    liveCycle: {
      id: opts.live.id, name: opts.live.name, region: "eu-west",
      testCentreId: opts.live.testCentreId, yearId: opts.live.yearId,
      startedAt: "today", lastActivity: "today", stageIndex: 0, fileName: "", fileSizeMB: 0, uploadedAgo: "",
      validation: EMPTY_VALIDATION, preview: { headers: [], rows: [] }, duplicates: 0,
      participants: [], assessments: [], diagnostics: [],
    },
    priorCycles: opts.priors ?? [],
  };
}

const CENTRES: Seed["testCentres"] = [
  { id: "tc-a", name: "Shatila 1", code: "SHA1", slug: "shatila-1", active: true },
];

// ── 1. QuestionId canonicalisation (numeric-skew parity with ResultId) ────────
describe("normalizeQuestionId — canonical Question key (task 23)", () => {
  it("collapses the same representational skew ResultId is hardened against", () => {
    // A clean integer id is unchanged.
    expect(normalizeQuestionId("40123")).toBe("40123");
    // Padded whitespace, wrapping quotes, spreadsheet trailing .0, exponential form.
    expect(normalizeQuestionId("  40123 ")).toBe("40123");
    expect(normalizeQuestionId('"40123"')).toBe("40123");
    expect(normalizeQuestionId("40123.0")).toBe("40123");
    expect(normalizeQuestionId("40123.00")).toBe("40123");
    // Two skins of ONE id collapse together; two distinct ids never merge.
    expect(normalizeQuestionId(" 40123.0 ")).toBe(normalizeQuestionId("40123"));
    expect(normalizeQuestionId("40123")).not.toBe(normalizeQuestionId("40124"));
  });

  it("uses the identical canonicalisation as ResultId (one numeric-id rule)", () => {
    for (const raw of ["1572504488.0", '"999000001"', "  35300000001 ", "1.572504488E9"]) {
      expect(normalizeQuestionId(raw)).toBe(normalizeResultId(raw));
    }
  });
});

// ── 2. Routing keys on the real year id, never the label ──────────────────────
describe("year routing keys on the real exam_years id, not the name (task 23)", () => {
  const Y1 = "11111111-1111-1111-1111-111111111111";
  const Y2 = "22222222-2222-2222-2222-222222222222";

  it("a null/blank-named year still resolves and routes on its UUID (no year-Unknown)", () => {
    // Blank name → the label parser yields "Unknown"; the ROUTE must still be the
    // real exam_years UUID and getYear must resolve it.
    const p = new InMemoryDataProvider(seedWith({ centres: CENTRES, live: { id: "live", name: "", testCentreId: "tc-a", yearId: Y1 } }));
    const years = p.listYears();
    const y = years.find((yr) => yr.examYearId === Y1)!;
    expect(y).toBeDefined();
    expect(y.id).toBe(Y1);                 // routes on the UUID …
    expect(y.id).not.toMatch(/^year-/);    // … never the derived label id
    expect(p.getYear(Y1)).not.toBeNull();  // the route loads
    // The stale label route no longer resolves (identity is the id, not the name).
    expect(p.getYear("year-Unknown")).toBeNull();
  });

  it("two years whose names both parse to 'Unknown' stay distinct (grouped by id)", () => {
    const p = new InMemoryDataProvider(
      seedWith({
        centres: CENTRES,
        live: { id: "live", name: "", testCentreId: "tc-a", yearId: Y1 },
        priors: [
          { id: "prior", name: "", testCentreId: "tc-a", yearId: Y2, stageIndex: 7, stepsDone: 8, participants: 0, assessments: 0, lastActivity: "x", locked: true, mock: true },
        ],
      }),
    );
    const ids = p.listYears().map((y) => y.id).sort();
    expect(ids).toEqual([Y1, Y2].sort());        // two distinct routes, no collapse
    expect(p.getYear(Y1)).not.toBeNull();
    expect(p.getYear(Y2)).not.toBeNull();
  });
});

// ── 3. Count preservation on the 700435 fixture ───────────────────────────────
describe("responses distinct sittings == roster sittings, per subject (task 23)", () => {
  it("keeps every sitting at ingest (Math 15 / English 12 / Scientific 12 / Arabic 9 / Life 11)", () => {
    const { cleanedResponses } = ingestThreeExports(qmFiles());
    // Distinct sittings (qmResultId) per subject in the RESPONSES (score-matrix) set.
    const bySubject = new Map<string, Set<string>>();
    for (const r of cleanedResponses) {
      if (!r.qmResultId) continue;
      (bySubject.get(r.assessmentName) ?? bySubject.set(r.assessmentName, new Set()).get(r.assessmentName)!).add(r.qmResultId);
    }
    const count = (re: RegExp) => {
      const entry = [...bySubject.entries()].find(([name]) => re.test(name));
      return entry ? entry[1].size : 0;
    };
    expect(count(/Applicable Math$/)).toBe(15);
    expect(count(/Scientific/)).toBe(12);
    expect(count(/English/)).toBe(12);
    expect(count(/Life/)).toBe(11);
    expect(count(/العربيّة/)).toBe(9);
  });

  it("the roster ↔ responses guard passes on the fixture (no whole-sitting drop)", async () => {
    const { canonical, cleanedResponses } = ingestThreeExports(qmFiles());
    const { assertAllGradedSittingsPersisted } = await import("@/lib/ingest/qm");
    expect(() => assertAllGradedSittingsPersisted(canonical, cleanedResponses)).not.toThrow();
  });
});

// ── 4. The integrity guard rejects a collapsed write (string-vs-number case) ──
describe("assertResponsesCoverSittings rejects a collapsed write (task 23)", () => {
  it("throws when responses hold fewer distinct sittings than the roster", () => {
    // 15 ResultIds whose STRING order differs from their NUMBER order.
    const ids = [
      "1000000001", "1000000002", "1000000003", "1000000004", "1000000005",
      "35300000001", "35300000002", "35300000003", "35300000004", "35300000005",
      "999000001", "999000002", "999000003", "999000004", "999000005",
    ];
    const sittings = ids.map((rid) => ({ assessment_id: "A", qm_result_id: rid }));
    // A collapsed responses set keeps only the 10 string-first ids (the "999…" tail
    // dropped) — the exact string-sort collapse signature.
    const kept = ids.filter((id) => !id.startsWith("999"));
    const responses = kept.map((rid) => ({ assessment_id: "A", qm_result_id: rid, question_id: "Q1" }));
    expect(() => assertResponsesCoverSittings(responses, sittings)).toThrow(/whole-sitting collapse|responses 10 vs sittings 15/i);
  });

  it("accepts the write when every distinct sitting survives", () => {
    const ids = ["1000000001", "35300000001", "999000001"];
    const sittings = ids.map((rid) => ({ assessment_id: "A", qm_result_id: rid }));
    const responses = ids.map((rid) => ({ assessment_id: "A", qm_result_id: rid, question_id: "Q1" }));
    expect(() => assertResponsesCoverSittings(responses, sittings)).not.toThrow();
  });
});

// ── 5. The demo slug centre never leaks into a centre-less live workspace ─────
describe("centre dropdown never offers the demo slug centre in live mode (task 23)", () => {
  it("with demoFallbackCentre:false and no centres, the list is empty (no tc-shatila-1)", () => {
    const p = new InMemoryDataProvider(seedWith({ live: { id: "live", name: "May 2026" } }), undefined, { demoFallbackCentre: false });
    expect(p.listTestCentres()).toEqual([]);
    const model = p.getNewCycle();
    expect(model.testCentres).toEqual([]);
    expect(model.defaultTestCentreId).toBeNull();
    // The one id a live create-sitting could never satisfy is absent.
    expect(p.listTestCentres().some((c) => c.id === "tc-shatila-1")).toBe(false);
  });

  it("the standalone demo (default) still injects a centre so its pickers are non-empty", () => {
    const p = new InMemoryDataProvider(seedWith({ live: { id: "live", name: "May 2026" } }));
    expect(p.listTestCentres().length).toBeGreaterThanOrEqual(1);
  });
});

// ── 6. Delete cycle — admin-gated + last-cycle guard ──────────────────────────
describe("deleteCycle — admin-gated cascade with a last-cycle guard (task 23)", () => {
  const VIEWER: CurrentUser = { id: "u-v", name: "Vera Viewer", initials: "VV", role: "viewer" };

  it("refuses to delete the last remaining cycle", async () => {
    const p = new InMemoryDataProvider(seedWith({ centres: CENTRES, live: { id: "live", name: "May 2026", testCentreId: "tc-a" } }));
    await expect(p.deleteCycle("live")).rejects.toThrow(/last remaining cycle/i);
  });

  it("deletes a cycle when others remain, and audits it", async () => {
    const p = new InMemoryDataProvider(
      seedWith({
        centres: CENTRES,
        live: { id: "live", name: "May 2026", testCentreId: "tc-a" },
        priors: [{ id: "prior", name: "May 2025", testCentreId: "tc-a", stageIndex: 7, stepsDone: 8, participants: 0, assessments: 0, lastActivity: "x", locked: true, mock: true }],
      }),
    );
    await expect(p.deleteCycle("live")).resolves.toBeUndefined();
    const audited = p.getAuditLog(null, "all", "").entries.some((e) => /deleted cycle/i.test(e.action) && !e.seeded);
    expect(audited).toBe(true);
  });

  it("is admin-only (a viewer is refused)", async () => {
    const p = new InMemoryDataProvider(
      seedWith({
        centres: CENTRES,
        live: { id: "live", name: "May 2026", testCentreId: "tc-a" },
        priors: [{ id: "prior", name: "May 2025", testCentreId: "tc-a", stageIndex: 7, stepsDone: 8, participants: 0, assessments: 0, lastActivity: "x", locked: true, mock: true }],
      }),
      VIEWER,
    );
    await expect(p.deleteCycle("live")).rejects.toThrow(/not authorized/i);
  });
});
