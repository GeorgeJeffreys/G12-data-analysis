/**
 * One-off: produce a SAMPLE draft export for the P5 PR — a draft certificate + a
 * performance report for ONE real Overall student, showing the best-of-two
 * (Feb/May) provenance. Pulls real data from the in-memory provider's Overall
 * best-of-two rollup, then fills the real built-in templates with the SAME token
 * set the in-app generator uses (incl. the Sx_SOURCE provenance token) via
 * pizzip + docxtemplater. Watermarked + DRAFT-prefixed, exactly like an in-app
 * "Export draft proofs" run.
 *
 * Run with:  npx tsx scripts/sample-export.mts [outfile.zip]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import JSZip from "jszip";
import { InMemoryDataProvider } from "../lib/data/in-memory-provider";
import { DRAFT_WATERMARK } from "../lib/documents/generator";
import type { StudentSummary, DocSettings, OverallSource } from "../lib/data/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const YEAR = "year-2026";

const provider = new InMemoryDataProvider();
provider.lockCycle("may-2026"); // lock May so the Overall is final (Feb is the mock baseline)

const docs = provider.getOverallDocuments(YEAR)!;
const overall = provider.getOverallGrades(YEAR)!;

// Pick a student whose best-of-two genuinely mixes the two sittings, so the
// provenance is visible in the sample.
const student =
  docs.students.find((s) => {
    const sources = new Set(s.subjects.map((x) => x.source).filter(Boolean));
    return sources.has("february") && sources.has("may");
  }) ?? docs.students[0]!;
const row = overall.rows.find((r) => r.id === student.participantId)!;

const SOURCE_LABEL: Record<OverallSource, string> = { february: "Feb", may: "May" };

/** The full token set, mirroring lib/documents/generator.ts (draft run). */
function tokensFor(s: StudentSummary, settings: DocSettings): Record<string, string> {
  const data: Record<string, string> = {
    NAME: s.name,
    AWARD: s.award,
    RESULTID: s.participantId,
    TESTCENTRE: settings.testCentre,
    EXAMDATE: settings.examDate,
    ISSUEDATE: settings.issueDate,
    CYCLE: settings.cycleName,
    WATERMARK: DRAFT_WATERMARK,
  };
  for (const sub of s.subjects) {
    data[`${sub.slot}_STARS`] = sub.stars;
    data[`${sub.slot}_LEVEL`] = sub.level;
    data[`${sub.slot}_SOURCE`] = sub.source ? SOURCE_LABEL[sub.source] : "";
  }
  return data;
}

function renderPptx(template: Buffer, data: Record<string, string>): Buffer {
  const zip = new PizZip(template);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer" });
}

const certTpl = readFileSync(path.join(root, "public/templates/certificate_template.pptx"));
const reportTpl = readFileSync(path.join(root, "public/templates/report_template.pptx"));
const tokens = tokensFor(student, docs.settings);

const archive = new JSZip();
archive.file(`DRAFT - Certificate - ${student.name}.pptx`, renderPptx(certTpl, tokens));
archive.file(`DRAFT - Performance Report - ${student.name}.pptx`, renderPptx(reportTpl, tokens));

// A human-readable provenance summary so the best-of-two is explicit even where a
// stock template carries no Sx_SOURCE token.
const lines: string[] = [
  `SAMPLE DRAFT EXPORT — ${DRAFT_WATERMARK}`,
  ``,
  `${docs.settings.cycleName}`,
  `Student: ${student.name}  (Result ID ${student.participantId})`,
  `Overall award (best-of-two): ${student.award}`,
  ``,
  `Per-subject best-of-two provenance:`,
];
for (const subj of student.subjects) {
  const cell = row.grades[overall.assessments.find((a) => a.name === subj.assessment)?.id ?? ""];
  const chosen = subj.level || "—";
  const src = subj.source ? SOURCE_LABEL[subj.source] : "—";
  const feb = cell?.februaryLevel ?? "no result";
  const may = cell?.mayLevel ?? "no result";
  lines.push(`  ${subj.assessment.padEnd(22)} ${chosen.padEnd(22)} chosen ${src}   (Feb: ${feb} · May: ${may})`);
}
lines.push(``, `Draft proof only — official issuance is gated on scores reconciled, both sittings locked, O1/O2 signed off, and real (non-synthetic) data.`);
archive.file(`PROVENANCE - ${student.name}.txt`, lines.join("\n"));

const out = path.resolve(process.argv[2] ?? path.join(root, "Overall_DRAFT_sample.zip"));
const buf = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
writeFileSync(out, buf);
console.log(`Wrote ${out} — draft cert + report + provenance for ${student.name} (${(buf.length / 1024).toFixed(0)} KB)`);
