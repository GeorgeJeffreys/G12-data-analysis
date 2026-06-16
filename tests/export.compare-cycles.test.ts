/**
 * Compare-cycles export. Builds the workbook from the live provider model and
 * checks the three sheets, the cycle column headers (with mock flagging), and
 * that the confirmed award vocabulary — not the mockup placeholders — appears.
 */
import { describe, it, expect } from "vitest";
import * as XLSXR from "xlsx";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import { buildCompareCyclesWorkbook, COMPARE_CYCLES_SHEETS, workbookToBuffer } from "@/lib/export";

describe("compare-cycles workbook", () => {
  const provider = new InMemoryDataProvider();
  const model = provider.getCompareCycles();
  const wb = buildCompareCyclesWorkbook(model);

  it("has the three expected sheets", () => {
    expect(wb.SheetNames).toEqual([...COMPARE_CYCLES_SHEETS]);
  });

  it("round-trips to a readable xlsx with the award vocabulary and mock flags", () => {
    const buf = workbookToBuffer(wb);
    const round = XLSXR.read(buf, { type: "buffer" });
    const award = XLSXR.utils.sheet_to_json<string[]>(round.Sheets["Award distribution"]!, { header: 1 });
    const flat = award.flat().map(String);
    expect(flat).toContain("Distinction award");
    expect(flat).toContain("No Award");
    // header row carries each cycle name; mock cycles are flagged
    const header = (award[0] ?? []).join(" | ");
    for (const c of model.cycles) expect(header).toContain(c.name);
    expect(header.includes("(mock)")).toBe(model.cycles.some((c) => c.mock));
    // none of the mockup placeholders leak in
    for (const p of ["Emerging", "Developing"]) expect(flat).not.toContain(p);
  });

  it("includes a By subject sheet with one row per subject metric", () => {
    const buf = workbookToBuffer(wb);
    const round = XLSXR.read(buf, { type: "buffer" });
    const rows = XLSXR.utils.sheet_to_json<string[]>(round.Sheets["By subject"]!, { header: 1 });
    const flat = rows.flat().map(String);
    expect(flat).toContain("Cronbach's α");
    expect(flat).toContain(model.subjects[0]!.full);
  });
});
