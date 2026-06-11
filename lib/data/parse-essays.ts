/**
 * Client-side parser for the OPTIONAL essay-marks spreadsheet uploaded at Ingest.
 *
 * The file has one sheet per subject — AFL → Arabic 1st Language, ESL → English
 * 2nd Language — keyed by ParticipantID (e.g. `A-A-260506`). A student may have
 * several essay rows (e.g. two essays), each carrying a final mark out of 20 in a
 * `TotalScore` column. This parser emits ONE row per essay; the provider averages
 * the `TotalScore`s into a single per-student per-subject mark.
 *
 * The D1–D5 rubric-dimension columns are intentionally NOT read — `TotalScore`
 * (or a single provided final mark) is the essay mark.
 */
import type { EssayUploadRow } from "./provider";

function pickColumn(headers: string[], aliases: string[]): number {
  const lower = headers.map((h) => String(h ?? "").trim().toLowerCase());
  for (const a of aliases) {
    const i = lower.indexOf(a);
    if (i >= 0) return i;
  }
  for (let i = 0; i < lower.length; i++) {
    if (aliases.some((a) => lower[i]!.includes(a))) return i;
  }
  return -1;
}

/** Map a sheet name to the canonical essay subject code (AFL / ESL), or null. */
export function essaySubjectCode(sheetName: string): "AFL" | "ESL" | null {
  const s = sheetName.toLowerCase();
  if (s.includes("afl") || s.includes("arabic")) return "AFL";
  if (s.includes("esl") || s.includes("english")) return "ESL";
  return null;
}

export async function parseEssayMarks(file: File): Promise<EssayUploadRow[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const out: EssayUploadRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const code = essaySubjectCode(sheetName);
    if (!code) continue; // only the AFL / ESL subject sheets carry essays
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, blankrows: false });
    if (matrix.length === 0) continue;

    const headers = (matrix[0] ?? []).map((h) => String(h ?? ""));
    const idCol = pickColumn(headers, ["participantid", "participant", "resultid", "id"]);
    // TotalScore is the essay mark; never the D1–D5 rubric dimensions.
    const scoreCol = pickColumn(headers, ["totalscore", "total score", "total", "final", "score"]);
    if (idCol < 0 || scoreCol < 0) continue;

    for (const r of matrix.slice(1)) {
      const participantId = String(r[idCol] ?? "").trim();
      const raw = r[scoreCol];
      if (!participantId || raw == null || raw === "") continue;
      const totalScore = Number(String(raw).replace(/[^0-9.\-]/g, ""));
      if (Number.isNaN(totalScore)) continue;
      out.push({ participantId, subjectCode: code, totalScore });
    }
  }
  return out;
}
