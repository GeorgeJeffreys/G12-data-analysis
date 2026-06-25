/**
 * Ingest + validation tests against the de-identified sample Questionmark
 * export (`data/sample_qm_export.xlsx`, `in` sheet).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseExport,
  ingestAndClean,
  normalizeRemoveColumnHeader,
  parseDemandLevel,
  parseItemSet,
  deriveElements,
  isSurveyAssessment,
  repairText,
  looksLikeMojibake,
} from "@/lib/ingest";
import { sampleExportPath } from "./fixtures";

const file = readFileSync(sampleExportPath());
const { rows, sheetName } = parseExport(file);
const { cleanedResponses, validationReport } = ingestAndClean(rows);

describe("parseExport", () => {
  it("reads the `in` sheet with all rows", () => {
    expect(sheetName).toBe("in");
    expect(rows.length).toBeGreaterThan(1000);
  });
});

describe("normalisation", () => {
  it("keeps only Multiple Choice rows", () => {
    expect(cleanedResponses.length).toBeGreaterThan(0);
    for (const r of cleanedResponses) {
      expect(r.questionType).toBe("Multiple Choice");
    }
  });

  it("drops survey assessments", () => {
    for (const r of cleanedResponses) {
      expect(isSurveyAssessment(r.assessmentName)).toBe(false);
    }
  });

  it("repairs Arabic mojibake (no residual mojibake in clean text)", () => {
    const arabic = cleanedResponses.find((r) => /[؀-ۿ]/.test(r.assessmentName));
    expect(arabic, "expected at least one Arabic assessment").toBeDefined();
    expect(arabic!.assessmentName).toContain("العرب");
    for (const r of cleanedResponses) {
      expect(looksLikeMojibake(r.assessmentName)).toBe(false);
    }
  });

  it("derives major/sub element from the topic path", () => {
    const withElements = cleanedResponses.filter((r) => r.majorElement);
    expect(withElements.length).toBeGreaterThan(0);
    const math = cleanedResponses.find((r) =>
      r.assessmentName.includes("Applicable Math") && r.subElement,
    );
    expect(math?.majorElement).toBeTruthy();
    expect(math?.subElement).toBeTruthy();
  });

  it("parses demand level for most items", () => {
    const tagged = cleanedResponses.filter((r) => r.demandLevel).length;
    expect(tagged).toBeGreaterThan(0);
    for (const r of cleanedResponses) {
      if (r.demandLevel) expect(["D1", "D2", "D3"]).toContain(r.demandLevel);
    }
  });
});

describe("validation report (Section 10 gates)", () => {
  const ids = validationReport.checks.map((c) => c.id);

  it("runs every gate", () => {
    expect(ids).toEqual(
      expect.arrayContaining([
        "schema",
        "encoding",
        "no_leak",
        "demand_tag",
        "result_status",
        "duplicates",
        "reconciliation",
      ]),
    );
  });

  it("passes schema, encoding and no-leak gates on the sample", () => {
    const byId = new Map(validationReport.checks.map((c) => [c.id, c]));
    expect(byId.get("schema")!.status).toBe("pass");
    expect(byId.get("encoding")!.status).toBe("pass");
    expect(byId.get("no_leak")!.status).toBe("pass");
  });

  it("treats missing demand tags as a non-blocking warning", () => {
    const demand = validationReport.checks.find((c) => c.id === "demand_tag")!;
    expect(["pass", "warn"]).toContain(demand.status);
    // No hard-fail on the sample → progression is allowed.
    expect(validationReport.passed).toBe(true);
  });

  it("reports sensible stats", () => {
    expect(validationReport.stats.mcqRows).toBe(cleanedResponses.length);
    expect(validationReport.stats.assessments).toBeGreaterThanOrEqual(5);
    expect(validationReport.stats.droppedSurveyRows).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it("normalises historical Remove column variants to one key", () => {
    for (const v of ["Remove Item?", "Remove item?", "Remove?", "Column1", "remove"]) {
      expect(normalizeRemoveColumnHeader(v)).toBe("remove");
    }
    expect(normalizeRemoveColumnHeader("Reason")).toBe("Reason");
  });

  it("parses demand level from MetaTags", () => {
    expect(parseDemandLevel("AM Context==Academic||Demand Level==D2||x==y")).toBe("D2");
    expect(parseDemandLevel("Demand Level==Essay")).toBeNull();
    expect(parseDemandLevel(null)).toBeNull();
  });

  it("parses the item set (shared stimulus) from MetaTags, treating None/absent as null", () => {
    expect(parseItemSet("Demand Level==D1||ESL Item Sets==Calm your mind book review||May exam 2026==MAY2026")).toBe("Calm your mind book review");
    expect(parseItemSet("Demand Level==D2||ST Item Sets==Koch-curve")).toBe("Koch-curve");
    expect(parseItemSet("Demand Level==D1||ESL Item Sets==None||x==y")).toBeNull();
    expect(parseItemSet("Demand Level==D1")).toBeNull();
    expect(parseItemSet(null)).toBeNull();
  });

  it("derives elements from a backslash path", () => {
    const { major, sub } = deriveElements("Applicable Math\\Major thing\\Sub thing");
    expect(major).toBe("Major thing");
    expect(sub).toBe("Sub thing");
  });

  it("repairs a known mojibake string", () => {
    // UTF-8 for "اللغة" decoded as CP1252.
    const broken = "Ø§Ù„Ù„ØºØ©";
    expect(repairText(broken)).toContain("غة");
    expect(repairText("Plain ASCII")).toBe("Plain ASCII");
  });
});
