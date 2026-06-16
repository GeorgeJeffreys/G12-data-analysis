/**
 * Compare-cycles workbook (Analytics › Compare cycles export). A read-only
 * snapshot of the side-by-side comparison the screen shows, in the same
 * xlsx-js-style idiom as the other exports. Three sheets:
 *   1. Overview          — headline metrics per cycle + delta (oldest → newest).
 *   2. By subject        — every per-subject metric, one column per cycle.
 *   3. Award distribution — overall award counts per cycle (confirmed vocab).
 *
 * Mock cycles are flagged in their column header so the export stays as honest
 * as the UI. Built from the provider's CompareCyclesModel — no recompute.
 */

import { XLSX, HEADER_STYLE, TITLE_STYLE, META_STYLE, styleCell } from "./sheet-utils";
import type { CompareCyclesModel, CompareCycleData } from "@/lib/data/types";

export const COMPARE_CYCLES_SHEETS = ["Overview", "By subject", "Award distribution"] as const;

const cycleHeader = (c: CompareCycleData) => `${c.name}${c.mock ? " (mock)" : ""}`;
const cell = (v: number | null | undefined, suffix = "") =>
  v == null || !Number.isFinite(v) ? "—" : `${v}${suffix}`;

function styleHeaderRow(ws: XLSX.WorkSheet, row: number, cols: number): void {
  for (let c = 0; c < cols; c++) styleCell(ws, row, c, HEADER_STYLE);
}

export function buildCompareCyclesWorkbook(model: CompareCyclesModel): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const cycles = model.cycles;
  const last = cycles[cycles.length - 1];
  const prev = cycles[cycles.length - 2];
  const delta = (a: number | null | undefined, b: number | null | undefined) =>
    a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)
      ? "—"
      : `${a - b >= 0 ? "+" : ""}${Math.round((a - b) * 100) / 100}`;

  // ── Overview ───────────────────────────────────────────────────────────────
  {
    const header = ["Metric", ...cycles.map(cycleHeader), `Δ (latest vs prior)`];
    const rows: (string | number)[][] = [
      ["G12++ — Compare cycles"],
      [`Cycles: ${cycles.map((c) => c.name).join(" · ")}`],
      [],
      header,
      ["Total participants", ...cycles.map((c) => cell(c.participantsTotal)), delta(last?.participantsTotal, prev?.participantsTotal)],
      ["Avg score (all subjects)", ...cycles.map((c) => cell(c.avgScoreAllSubjects, "%")), delta(last?.avgScoreAllSubjects, prev?.avgScoreAllSubjects)],
      ["Pass or above (awarded)", ...cycles.map((c) => cell(c.passOrAboveCount)), delta(last?.passOrAboveCount, prev?.passOrAboveCount)],
      ["Avg difficulty (p-value)", ...cycles.map((c) => cell(c.avgPValue)), delta(last?.avgPValue, prev?.avgPValue)],
      ["Avg reliability (α)", ...cycles.map((c) => cell(c.avgAlpha)), delta(last?.avgAlpha, prev?.avgAlpha)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    styleCell(ws, 0, 0, TITLE_STYLE);
    styleCell(ws, 1, 0, META_STYLE);
    styleHeaderRow(ws, 3, header.length);
    ws["!cols"] = [{ wch: 26 }, ...cycles.map(() => ({ wch: 18 })), { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, "Overview");
  }

  // ── By subject ─────────────────────────────────────────────────────────────
  {
    const header = ["Subject", "Metric", ...cycles.map(cycleHeader)];
    const rows: (string | number)[][] = [header];
    const metric = (
      label: string,
      pick: (s: CompareCycleData["subjects"][string] | undefined) => string,
      subjectId: string,
    ) => [label, ...cycles.map((c) => pick(c.subjects[subjectId]))];
    for (const s of model.subjects) {
      rows.push([s.full]);
      rows.push(["", ...metric("Participants", (m) => cell(m?.participants), s.id)]);
      rows.push(["", ...metric("Mean score", (m) => cell(m?.scoreMean, "%"), s.id)]);
      rows.push(["", ...metric("Median score", (m) => cell(m?.scoreMedian, "%"), s.id)]);
      rows.push(["", ...metric("Pass-or-above rate", (m) => cell(m?.passOrAbove, "%"), s.id)]);
      rows.push(["", ...metric("Avg p-value (difficulty)", (m) => cell(m?.avgPValue), s.id)]);
      rows.push(["", ...metric("Avg point-biserial", (m) => cell(m?.avgPointBiserial), s.id)]);
      rows.push(["", ...metric("Cronbach's α", (m) => cell(m?.alpha), s.id)]);
      rows.push(["", ...metric("Items usable", (m) => cell(m?.itemsUsable), s.id)]);
      rows.push(["", ...metric("Items removed", (m) => cell(m?.itemsRemoved), s.id)]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    styleHeaderRow(ws, 0, header.length);
    ws["!cols"] = [{ wch: 22 }, { wch: 22 }, ...cycles.map(() => ({ wch: 16 }))];
    XLSX.utils.book_append_sheet(wb, ws, "By subject");
  }

  // ── Award distribution ─────────────────────────────────────────────────────
  {
    const header = ["Award level", ...cycles.map(cycleHeader)];
    const rows: (string | number)[][] = [header];
    for (const lvl of model.awardLevels) {
      rows.push([lvl, ...cycles.map((c) => c.awardDist[lvl] ?? 0)]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    styleHeaderRow(ws, 0, header.length);
    ws["!cols"] = [{ wch: 28 }, ...cycles.map(() => ({ wch: 16 }))];
    XLSX.utils.book_append_sheet(wb, ws, "Award distribution");
  }

  return wb;
}
