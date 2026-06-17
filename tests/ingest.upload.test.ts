/**
 * Raw-export ingest into the provider (the wired Upload step). Proves that an
 * empty cycle, once `ingestRawExport` runs over the REAL sample export, becomes
 * "uploaded" and that the downstream read models (combined split + raw data)
 * serve the freshly-ingested data — the same path the live Supabase provider
 * drives after persisting + re-hydrating.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseExport, ingestAndClean } from "@/lib/ingest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { buildLiveCycleData } from "@/lib/data/build-live-cycle";
import type { Seed } from "@/lib/data/seed-types";
import { sampleExportPath } from "./fixtures";

const EMPTY_VALIDATION = {
  passed: true,
  checks: [],
  stats: { rawRows: 0, mcqRows: 0, droppedSurveyRows: 0, droppedNonMcqRows: 0, assessments: 0, participants: 0, items: 0 },
} as unknown as Seed["liveCycle"]["validation"];

function emptySeed(): Seed {
  return {
    generatedAt: new Date().toISOString(),
    engineVersion: "test",
    liveCycle: {
      id: "new-cycle",
      name: "Fresh cycle",
      region: "eu-west",
      startedAt: "today",
      lastActivity: "today",
      stageIndex: 0,
      fileName: "",
      fileSizeMB: 0,
      uploadedAgo: "",
      validation: EMPTY_VALIDATION,
      preview: { headers: [], rows: [] },
      duplicates: 0,
      participants: [],
      assessments: [],
      diagnostics: [],
    },
    priorCycles: [],
  };
}

function load() {
  const { rows } = parseExport(readFileSync(sampleExportPath()));
  return ingestAndClean(rows);
}

describe("raw-export ingest → provider read path", () => {
  it("an empty cycle is not uploaded until a raw export is ingested", () => {
    const p = new InMemoryDataProvider(emptySeed());
    expect(p.getIngest("new-cycle")?.uploaded).toBe(false);
    expect(p.getCombinedSplit("new-cycle")).toBeNull();
  });

  it("ingesting the combined export makes the cycle uploaded with split subjects", async () => {
    const p = new InMemoryDataProvider(emptySeed());
    const { cleanedResponses, validationReport } = load();

    await p.ingestRawExport("new-cycle", { name: "export.xlsx", sizeMB: 1.3 }, cleanedResponses, validationReport);

    const ingest = p.getIngest("new-cycle");
    expect(ingest?.uploaded).toBe(true);
    expect(ingest?.fileName).toBe("export.xlsx");
    expect(ingest?.report.passed).toBe(validationReport.passed);

    const split = p.getCombinedSplit("new-cycle");
    expect(split).not.toBeNull();
    expect(split!.subjects.length).toBe(5); // the five sample subjects
    expect(split!.totalItems).toBe(193); // matches the split test's item total
  });

  it("the raw-data read model serves the ingested matrix for a subject", async () => {
    const p = new InMemoryDataProvider(emptySeed());
    const { cleanedResponses, validationReport } = load();
    await p.ingestRawExport("new-cycle", { name: "export.xlsx", sizeMB: 1.3 }, cleanedResponses, validationReport);

    const split = p.getCombinedSplit("new-cycle")!;
    const first = split.subjects[0]!;
    const raw = p.getRawData("new-cycle", first.id);
    expect(raw).not.toBeNull();
    expect(raw!.items).toBe(first.items);
    expect(raw!.columns.length).toBe(first.items);
    expect(raw!.rows.length).toBe(first.participants);
  });

  it("buildLiveCycleData groups every cleaned response into a subject (no loss)", () => {
    const { cleanedResponses } = load();
    const built = buildLiveCycleData(cleanedResponses);
    const totalResponses = built.assessments.reduce((n, a) => n + a.responses.length, 0);
    expect(totalResponses).toBe(cleanedResponses.length);
  });
});
