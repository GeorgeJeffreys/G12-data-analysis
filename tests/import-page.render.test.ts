import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { parseExport, ingestAndClean } from "@/lib/ingest";
import type { Seed } from "@/lib/data/seed-types";
import type { DataProvider } from "@/lib/data/provider";
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
      assessments: [
        { id: "a1", name: "Applicable Mathematics", shortName: "AM", rtl: false, stageIndex: 0, items: [], responses: [] },
        { id: "a2", name: "Scientific Thinking", shortName: "ST", rtl: false, stageIndex: 0, items: [], responses: [] },
      ],
      diagnostics: [],
    },
    priorCycles: [],
  };
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/cycles/new-cycle/import",
  useSearchParams: () => new URLSearchParams(),
}));

// The Import page reads provider state through the context hooks; point those at
// whichever provider the current test installs (empty cycle vs. ingested cycle)
// so we render the genuine page against real provider read-models.
let active: DataProvider = new InMemoryDataProvider(emptySeed());
vi.mock("@/lib/data/context", () => ({
  useProvider: () => active,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(active),
}));

async function renderImport() {
  const { default: ImportPage } = await import("@/app/cycles/[cycleId]/import/page");
  return renderToStaticMarkup(e(ImportPage, { params: { cycleId: "new-cycle" } }));
}

describe("Import/Upload page renders", () => {
  it("renders the upload empty-state for an empty cycle without crashing (no error boundary)", async () => {
    active = new InMemoryDataProvider(emptySeed());
    const html = await renderImport();
    expect(html).toContain("Upload exam data");
    // The raw-export card shows its (now-wired) upload prompt — an enabled
    // upload button for the three QM CSVs — not a (meaningless) all-zero report.
    expect(html).toContain("Upload the three QM CSVs");
    // The button must be live now that ingest is wired (no `disabled` attribute).
    expect(html).not.toContain("Raw-export ingest to Supabase is not yet wired");
  });

  // Regression guard for the data-present path: the validation report renders,
  // including the "MCQ-only rows after cleaning" line that reads
  // `model.report.stats.mcqRows` — the exact access that threw "Cannot read
  // properties of undefined" before the empty-cycle fix. Don't regress it.
  it("renders the validation report + detected subjects once a raw export is ingested", async () => {
    const p = new InMemoryDataProvider(emptySeed());
    const { rows } = parseExport(readFileSync(sampleExportPath()));
    const { cleanedResponses, validationReport } = ingestAndClean(rows);
    await p.ingestRawExport("new-cycle", { name: "export.xlsx", sizeMB: 1.3 }, cleanedResponses, validationReport);
    active = p;

    const html = await renderImport();
    expect(html).toContain("Upload exam data");
    expect(html).toContain("Validation report");
    expect(html).toContain("MCQ-only rows after cleaning");
    expect(html).toContain("Detected"); // combined-split panel summarises the subjects
    expect(html).not.toContain("Upload exam export"); // not the empty-state prompt
  });
});
