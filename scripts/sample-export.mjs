/**
 * One-off: produce a SAMPLE draft certificate export so the P4 PR can show what
 * the issuance UI hands back. Uses the real built-in certificate template and the
 * same token set + DRAFT naming the in-app generator uses (pizzip + docxtemplater
 * + jszip), so the sample matches a real "Export draft proofs" run.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const DRAFT_WATERMARK = "DRAFT — NOT FOR ISSUE";
const settings = {
  cycleName: "2026 · Overall",
  testCentre: "Alsama Test Centre",
  examDate: "May 2026",
  issueDate: "1 June 2026",
};
const students = [
  { participantId: "G12-0001", name: "Sample Student A", award: "Distinction" },
  { participantId: "G12-0002", name: "Sample Student B", award: "Advanced" },
  { participantId: "G12-0003", name: "Sample Student C", award: "Secondary" },
];

function tokensFor(s) {
  return {
    NAME: s.name,
    AWARD: s.award,
    RESULTID: s.participantId,
    TESTCENTRE: settings.testCentre,
    EXAMDATE: settings.examDate,
    ISSUEDATE: settings.issueDate,
    CYCLE: settings.cycleName,
    WATERMARK: DRAFT_WATERMARK,
  };
}

function renderPptx(template, data) {
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

const template = fs.readFileSync(path.join(root, "public/templates/certificate_template.pptx"));
const archive = new JSZip();
for (const s of students) {
  const bytes = renderPptx(template, tokensFor(s));
  archive.file(`DRAFT - Certificate - ${s.name}.pptx`, bytes);
}
const out = path.resolve(process.argv[2] ?? path.join(root, "2026_Overall_DRAFT_documents.zip"));
const buf = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
fs.writeFileSync(out, buf);
console.log(`Wrote ${out} (${students.length} draft certificates, ${(buf.length / 1024).toFixed(0)} KB)`);
