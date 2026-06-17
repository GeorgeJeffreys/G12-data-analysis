import { describe, it, expect, vi } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { Seed } from "@/lib/data/seed-types";
import type { DataProvider } from "@/lib/data/provider";

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

const provider: DataProvider = new InMemoryDataProvider(emptySeed());

// The Import page reads provider state through the context hooks; point those at
// our empty-cycle provider so we render the genuine page for a brand-new cycle.
vi.mock("@/lib/data/context", () => ({
  useProvider: () => provider,
  useProviderData: <T,>(selector: (p: DataProvider) => T) => selector(provider),
}));

describe("Import/Upload page renders for an empty cycle", () => {
  it("renders the upload empty-state without crashing (no error boundary)", async () => {
    const { default: ImportPage } = await import("@/app/cycles/[cycleId]/import/page");
    const html = renderToStaticMarkup(e(ImportPage, { params: { cycleId: "new-cycle" } }));
    expect(html).toContain("Upload exam data");
    // The raw-export card shows its (now-wired) upload prompt — an enabled
    // upload button — not a (meaningless) all-zero validation report.
    expect(html).toContain("Upload exam export");
    // The button must be live now that ingest is wired (no `disabled` attribute).
    expect(html).not.toContain("Raw-export ingest to Supabase is not yet wired");
  });
});
