/**
 * Build the canonical fixed essay template used by prompt 03.
 *
 * Emits TWO artifacts from ONE definition so their structure can never drift:
 *   1. tests/fixtures/essays/G12_Essay_Marks_FIXED_TEMPLATE.xlsx — the MARKED
 *      reference file (English marked with the acceptance Finals; Arabic pre-filled
 *      but awaiting marks). Test-only; never served.
 *   2. public/templates/G12_Essay_Marks_FIXED_TEMPLATE.xlsx — the BLANK structural
 *      asset the "Download template" generator clones (identity + marks cleared,
 *      the per-student block + formulas intact). Safe to serve — carries no marks.
 *
 * Both sheets (`English Essay master`, `Arabic Essay master`) share an IDENTICAL
 * rich structure that mimics the team's real working sheet: the working columns
 * (`Dim1..Dim5`, `Total score`, `Average`, `Flag`, `Moderated score`) plus two
 * decoy final columns (`Indvidual final scores (/20)`, `Individual final scores
 * (/10)`) that contain "final" and must NOT be mistaken for the canonical
 * `Final essay mark (/20)`. The app reads ONLY the tab name, `QM email`, and the
 * exact-header `Final essay mark (/20)`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "xlsx-js-style";
const XLSX = (pkg as unknown as { default?: typeof pkg }).default ?? pkg;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const HEADERS = [
  "QM email", // 0 — canonical join key
  "Student name", // 1 — identity
  "Alsama Student ID", // 2 — identity
  "Essay ID", // 3 — working
  "Marker", // 4 — working
  "Mark (/20)", // 5 — working
  "Dim1", // 6 — working
  "Dim2", // 7
  "Dim3", // 8
  "Dim4", // 9
  "Dim5", // 10
  "Total score", // 11 — working
  "Average", // 12 — working
  "Flag", // 13 — working
  "Moderated score", // 14 — working
  "Indvidual final scores (/20)", // 15 — DECOY (contains "final")
  "Individual final scores (/10)", // 16 — DECOY (contains "final")
  "Final essay mark (/20)", // 17 — THE canonical column
] as const;

const FINAL_COL = 17;

/** email → English Final (raw, pre-rounding), from prompt 03's acceptance table. */
const STUDENTS: { handle: string; name: string; email: string; alsamaId: string; enFinal: number }[] = [
  { handle: "abed", name: "Abed", email: "abed.alahmad@alsamaproject.com", alsamaId: "AL-001", enFinal: 15.5 },
  { handle: "afraa", name: "Afraa", email: "afraa.abdullah.alsama@gmail.com", alsamaId: "AL-002", enFinal: 19.5 },
  { handle: "amal", name: "Amal", email: "amal.alkhalaf.alsama@gmail.com", alsamaId: "AL-003", enFinal: 12.5 },
  { handle: "dalal", name: "Dalal", email: "dalal.hasan.alsama@gmail.com", alsamaId: "AL-004", enFinal: 19.5 },
  { handle: "elaph", name: "Elaph", email: "elaph.hawran.alsama@gmail.com", alsamaId: "AL-005", enFinal: 18 },
  { handle: "fatima.alissa", name: "Fatima Alissa", email: "fatima.alissa.alsama@gmail.com", alsamaId: "AL-006", enFinal: 15.5 },
  { handle: "fatima.aljasem", name: "Fatima Aljasem", email: "fatima.aljasem.alsama@gmail.com", alsamaId: "AL-007", enFinal: 17 },
  { handle: "hussien", name: "Hussien", email: "hussien.diab@alsamaproject.com", alsamaId: "AL-008", enFinal: 18.5 },
  { handle: "louay", name: "Louay", email: "louay.alkadro@alsamaproject.com", alsamaId: "AL-009", enFinal: 13 },
  { handle: "marah", name: "Marah", email: "marah.fadel0@gmail.com", alsamaId: "AL-010", enFinal: 17.5 },
  { handle: "maram", name: "Maram", email: "maram.alkhoder.alsama@gmail.com", alsamaId: "AL-011", enFinal: 18.5 },
  { handle: "marwa", name: "Marwa", email: "marwa.alomar@alsamaproject.com", alsamaId: "AL-012", enFinal: 17.5 },
  { handle: "nour.alissa", name: "Nour Alissa", email: "nour.alissa@alsamaproject.com", alsamaId: "AL-013", enFinal: 16.5 },
  { handle: "nour.zaqzaq", name: "Nour Zaqzaq", email: "nour.zaqzaq@alsamaproject.com", alsamaId: "AL-014", enFinal: 16.5 },
  { handle: "oula", name: "Oula", email: "oula.abed.alkhalaf.2007@gmail.com", alsamaId: "AL-015", enFinal: 17 },
  { handle: "safa", name: "Safa", email: "safa.alomarii21@gmail.com", alsamaId: "AL-016", enFinal: 17 },
  { handle: "wissal", name: "Wissal", email: "wissal.algaber.alsama@gmail.com", alsamaId: "AL-017", enFinal: 18.5 },
];

const ESSAY_IDS = ["Essay 1", "Essay 1", "Essay 2", "Essay 2"];
const MARKERS = ["M1", "M2", "M1", "M2"];
const BLOCK = 4; // rows per student (2 essays × 2 markers)

type Cell = string | number | { f: string };

/** One 4-row student block. `marked` fills the working + Final cells; else blank. */
function studentBlock(
  s: { name: string; email: string; alsamaId: string; enFinal?: number },
  startRow1: number, // 1-based sheet row of the block's first data row
  marked: boolean,
): Cell[][] {
  const rows: Cell[][] = [];
  for (let k = 0; k < BLOCK; k++) {
    const row: Cell[] = new Array(HEADERS.length).fill("");
    row[0] = s.email;
    row[1] = s.name;
    row[2] = s.alsamaId;
    row[3] = ESSAY_IDS[k]!;
    row[4] = MARKERS[k]!;
    if (marked && s.enFinal != null) {
      // A plausible per-marker Mark whose block-average lands on the Final. The app
      // ignores every one of these — only column 17 (Final) is ever read.
      row[5] = s.enFinal;
      for (let d = 6; d <= 10; d++) row[d] = Math.round(s.enFinal / 5); // Dim1..Dim5
      row[11] = s.enFinal; // Total score (working)
      row[12] = s.enFinal; // Average (working)
      row[14] = s.enFinal; // Moderated score (working)
      row[15] = s.enFinal; // decoy /20 — same magnitude, still must NOT be picked
      row[16] = s.enFinal / 2; // decoy /10 — half; a mis-pick would be obvious
    }
    rows.push(row);
  }
  // The subject Final is written ONCE, on the block's first row (column 17).
  if (marked && s.enFinal != null) rows[0]![FINAL_COL] = s.enFinal;
  return rows;
}

/** Blank prototype block carrying the Final FORMULA (auto-averages the block Marks). */
function protoBlock(startRow1: number): Cell[][] {
  const rows: Cell[][] = [];
  for (let k = 0; k < BLOCK; k++) {
    const row: Cell[] = new Array(HEADERS.length).fill("");
    row[3] = ESSAY_IDS[k]!;
    row[4] = MARKERS[k]!;
    rows.push(row);
  }
  // Formulas intact (relative refs) so a cloned block re-bases them per student.
  rows[0]![FINAL_COL] = { f: `IFERROR(AVERAGE(F${startRow1}:F${startRow1 + BLOCK - 1}),"")` };
  rows[0]![15] = { f: `IFERROR(AVERAGE(F${startRow1}:F${startRow1 + BLOCK - 1}),"")` };
  rows[0]![16] = { f: `IFERROR(AVERAGE(F${startRow1}:F${startRow1 + BLOCK - 1})/2,"")` };
  return rows;
}

function toSheet(aoa: Cell[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([]);
  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < aoa[r]!.length; c++) {
      const v = aoa[r]![c]!;
      const addr = XLSX.utils.encode_cell({ r, c });
      if (typeof v === "object" && "f" in v) ws[addr] = { t: "n", f: v.f };
      else if (typeof v === "number") ws[addr] = { t: "n", v };
      else ws[addr] = { t: "s", v: String(v) };
    }
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: HEADERS.length - 1 } });
  return ws;
}

/** MARKED reference: English filled with the acceptance Finals, Arabic left blank. */
function buildMarked(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, marked] of [
    ["English Essay master", true],
    ["Arabic Essay master", false],
  ] as const) {
    const aoa: Cell[][] = [[...HEADERS]];
    STUDENTS.forEach((s, i) => {
      aoa.push(...studentBlock(s, 2 + i * BLOCK, marked));
    });
    XLSX.utils.book_append_sheet(wb, toSheet(aoa), sheetName);
  }
  return wb;
}

/** BLANK asset: header + a single blank prototype block (formulas intact), per sheet. */
function buildBlankAsset(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const sheetName of ["English Essay master", "Arabic Essay master"]) {
    const aoa: Cell[][] = [[...HEADERS], ...protoBlock(2)];
    XLSX.utils.book_append_sheet(wb, toSheet(aoa), sheetName);
  }
  return wb;
}

function write(wb: XLSX.WorkBook, rel: string) {
  const out = join(ROOT, rel);
  mkdirSync(dirname(out), { recursive: true });
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  writeFileSync(out, buf);
  console.log("wrote", rel, `(${buf.length} bytes)`);
}

write(buildMarked(), "tests/fixtures/essays/G12_Essay_Marks_FIXED_TEMPLATE.xlsx");
write(buildBlankAsset(), "public/templates/G12_Essay_Marks_FIXED_TEMPLATE.xlsx");
