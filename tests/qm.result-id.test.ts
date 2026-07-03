/**
 * normalizeResultId — the canonical sitting-key join key (task 19).
 *
 * The three QM exports (Items / Assessments / Topics) are joined on `ResultId` and
 * the value is persisted as `qm_result_id` (the sitting grain). CSV/spreadsheet
 * tooling can render the SAME large integer differently across the exports — a
 * trailing `.0`, wrapping quotes, padded whitespace, or exponential form — so a bare
 * string join drops the mismatched rows and a whole sitting orphans. This locks the
 * canonicalisation that removes those skews while never merging two distinct ids.
 */
import { describe, it, expect } from "vitest";
import { normalizeResultId } from "@/lib/ingest/qm/result-id";

describe("normalizeResultId — canonical sitting key", () => {
  it("passes a plain integer id through unchanged", () => {
    expect(normalizeResultId("1572504488")).toBe("1572504488");
    expect(normalizeResultId("1032381502")).toBe("1032381502");
  });

  it("strips a spreadsheet trailing decimal on an integer id", () => {
    expect(normalizeResultId("1572504488.0")).toBe("1572504488");
    expect(normalizeResultId("1572504488.00")).toBe("1572504488");
  });

  it("trims surrounding whitespace and wrapping quotes", () => {
    expect(normalizeResultId("  1572504488 ")).toBe("1572504488");
    expect(normalizeResultId('"1572504488"')).toBe("1572504488");
    expect(normalizeResultId("'1572504488'")).toBe("1572504488");
    expect(normalizeResultId('" 1572504488.0 "')).toBe("1572504488");
  });

  it("normalises an integer written in exponential form", () => {
    expect(normalizeResultId("1.572504488E9")).toBe("1572504488");
    expect(normalizeResultId("1.032381502e9")).toBe("1032381502");
    expect(normalizeResultId("1E9")).toBe("1000000000");
  });

  it("is injective over distinct ids — two different sittings never collapse", () => {
    const a = normalizeResultId("1572504488.0");
    const b = normalizeResultId("1032381502");
    expect(a).not.toBe(b);
    // The same id in three representations collapses to ONE key…
    const forms = ["1572504488", "1572504488.0", '"1572504488"', "1.572504488E9"].map(normalizeResultId);
    expect(new Set(forms).size).toBe(1);
    // …but a genuinely different id stays separate.
    expect(new Set([...forms, normalizeResultId("1572504489")]).size).toBe(2);
  });

  it("leaves an unrecognised / non-numeric id trimmed but otherwise intact", () => {
    expect(normalizeResultId("  R-abc-01 ")).toBe("R-abc-01");
    expect(normalizeResultId("")).toBe("");
    expect(normalizeResultId("  ")).toBe("");
  });
});
