"use client";

/**
 * Screen — Document generation (certificates & performance reports). Available
 * once grades are locked. Choose the document type(s), upload the PowerPoint
 * template(s), confirm the merge fields, preview a filled sample, then generate
 * one PDF per student (via the DocumentGenerator → Python + LibreOffice). The
 * Student Summary comes from the locked-grades read-model — no upload of results.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { getDocumentGenerator } from "@/lib/documents/generator";
import type { DocKind, GenerateResult } from "@/lib/documents/types";
import type { DocumentsModel, StudentSummary } from "@/lib/data/types";

type Choice = "both" | "certificate" | "report";
type Step = "config" | "generating" | "results";

const CERT_FIELDS = [
  ["{{NAME}}", "Student full name"],
  ["{{AWARD}}", "Overall award level"],
  ["{{RESULTID}}", "Participant ID"],
  ["{{TESTCENTRE}}", "Test centre (cycle setting)"],
  ["{{ISSUEDATE}}", "Issue date (cycle setting)"],
];
const REPORT_FIELDS = [
  ["{{NAME}}", "Student full name"],
  ["{{S1..S5_LEVEL}}", "Per-subject performance level"],
  ["{{S1..S5_STARS}}", "Per-subject stars (from level)"],
  ["{{RESULTID}}", "Participant ID"],
  ["{{EXAMDATE}} · {{TESTCENTRE}} · {{ISSUEDATE}}", "Cycle settings"],
];

export default function DocumentsPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const model = useProviderData((p) => p.getDocuments(cycleId), [cycleId]);
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Cycle";

  const [choice, setChoice] = useState<Choice>("both");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("config");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewBig, setPreviewBig] = useState(false);

  const kinds: DocKind[] = useMemo(
    () => (choice === "both" ? ["certificate", "report"] : [choice]),
    [choice],
  );

  if (!model) {
    return (
      <CycleShell cycleId={cycleId} cycleName={cycleName} page="Certificates" area="documents">
        <div style={{ padding: 32 }} className="hf-sub">No document data for this cycle.</div>
      </CycleShell>
    );
  }

  // Gate: locked grades required.
  if (!model.locked) {
    return (
      <CycleShell
        cycleId={cycleId}
        cycleName={cycleName}
        page="Certificates"
        area="documents"
        primary={
          <Link href={`/cycles/${cycleId}/grades`}>
            <Button variant="pri">Go to grades &amp; sign-off<Icon name="arrow" color="#fff" /></Button>
          </Link>
        }
      >
        <div style={{ padding: "40px 32px", maxWidth: 640 }}>
          <div className="hf-h1">Generate documents</div>
          <Card style={{ marginTop: 18, padding: "18px 20px", display: "flex", gap: 13, alignItems: "flex-start", background: H.warnSoft }}>
            <Mark kind="warn" size={18} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>Lock grades first</div>
              <div className="hf-sub" style={{ marginTop: 5 }}>
                Certificates and performance reports are generated from the signed-off grades. Lock the cycle on the Grades screen, then come back here.
              </div>
              <Link href={`/cycles/${cycleId}/grades`} style={{ display: "inline-block", marginTop: 12 }}>
                <Button variant="pri">Go to grades &amp; sign-off<Icon name="arrow" color="#fff" /></Button>
              </Link>
            </div>
          </Card>
        </div>
      </CycleShell>
    );
  }

  // Built-in templates ship in the repo, so generation never blocks on an
  // upload; an optional upload (below) just overrides the built-in for that kind.
  const requiredReady = true;
  const first = model.students[0];

  const doGenerate = async () => {
    setError(null);
    setStep("generating");
    try {
      const templates: Partial<Record<DocKind, ArrayBuffer>> = {};
      if (kinds.includes("certificate") && certFile) templates.certificate = await certFile.arrayBuffer();
      if (kinds.includes("report") && reportFile) templates.report = await reportFile.arrayBuffer();
      const res = await getDocumentGenerator().generate({
        cycleId,
        kinds,
        students: model.students,
        settings: model.settings,
        templates,
      });
      setResult(res);
      setStep("results");
      // Trigger the browser download of the combined .zip of .pptx files.
      if (res.zipUrl) {
        const a = document.createElement("a");
        a.href = res.zipUrl;
        a.download = res.zipName ?? "documents.zip";
        a.click();
      }
      const total = Object.values(res.kinds).reduce((s, k) => s + (k?.complete ?? 0), 0);
      provider.recordDocuments(cycleId, `${total} .pptx across ${kinds.join(" + ")} (zip)`);
    } catch (e) {
      setError((e as Error).message);
      setStep("config");
    }
  };

  if (step === "results" && result) {
    return (
      <ResultsView cycleId={cycleId} cycleName={cycleName} model={model} result={result} onBack={() => setStep("config")} onRetry={doGenerate} />
    );
  }

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Certificates"
      area="documents"
      actions={
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: H.good, fontWeight: 700, fontSize: 12 }}>
          <Mark kind="pass" size={14} /> Grades locked
        </span>
      }
      primary={
        <Button
          variant="pri"
          disabled={!requiredReady || step === "generating"}
          onClick={doGenerate}
          title={requiredReady ? undefined : "Upload the required template(s) first"}
        >
          <Icon name="award" color="#fff" />
          {step === "generating" ? "Generating…" : "Generate documents"}
        </Button>
      }
    >
      <div style={{ display: "flex", flex: 1, alignItems: "stretch", minHeight: 0, flexWrap: "wrap" }}>
        {/* left: config — the primary task (~two-thirds) */}
        <div style={{ display: "flex", flexDirection: "column", flex: "2 1 0%", padding: "26px 30px", gap: 22, minWidth: 320, overflow: "auto" }}>
          <div>
            <div className="hf-h1">Generate documents</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>
              Fills the built-in PowerPoint templates with each student’s values and downloads one <b>.pptx per student</b> in a single <b>.zip</b>. Open them and export to PDF to finalise. {model.students.length} students.
            </div>
          </div>

          {error && (
            <Card style={{ padding: "12px 15px", background: H.badSoft, borderColor: H.bad, display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Mark kind="fail" size={16} />
              <span style={{ fontSize: 12.5, color: H.bad, wordBreak: "break-word" }}>{error}</span>
            </Card>
          )}

          <Section n={1} title="Document type">
            <div style={{ display: "flex", gap: 8 }}>
              <Choice2 label="Both" on={choice === "both"} onClick={() => setChoice("both")} />
              <Choice2 label="Certificates" on={choice === "certificate"} onClick={() => setChoice("certificate")} />
              <Choice2 label="Reports" on={choice === "report"} onClick={() => setChoice("report")} />
            </div>
          </Section>

          <Section n={2} title="Template(s) — built-in (optional override)">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="hf-sub" style={{ fontSize: 12 }}>
                The repo’s certificate and report templates are used by default. Upload a .pptx only to override one.
              </div>
              {kinds.includes("certificate") && (
                <TemplateUpload label="Certificate template" file={certFile} onFile={setCertFile} />
              )}
              {kinds.includes("report") && (
                <TemplateUpload label="Performance report template" file={reportFile} onFile={setReportFile} />
              )}
            </div>
          </Section>

          <Section n={3} title="Confirm merge fields">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {kinds.includes("certificate") && <FieldList title="Certificate" fields={CERT_FIELDS} />}
              {kinds.includes("report") && <FieldList title="Performance report" fields={REPORT_FIELDS} />}
            </div>
            <div className="hf-sub" style={{ fontSize: 12, marginTop: 9 }}>
              Stars are derived from each level — never entered. The Result ID replaces the certificate’s baked-in fixed ID.
            </div>
          </Section>

          <Section n={4} title="Issue details (per-cycle settings)">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 560 }}>
              <SettingField label="Test centre" value={model.settings.testCentre} onCommit={(v) => provider.setDocumentSettings(cycleId, { testCentre: v })} />
              <SettingField label="Cycle name" value={model.settings.cycleName} onCommit={(v) => provider.setDocumentSettings(cycleId, { cycleName: v })} />
              <SettingField label="Exam date" value={model.settings.examDate} onCommit={(v) => provider.setDocumentSettings(cycleId, { examDate: v })} />
              <SettingField label="Issue date" value={model.settings.issueDate} onCommit={(v) => provider.setDocumentSettings(cycleId, { issueDate: v })} />
            </div>
          </Section>
        </div>

        {/* right: compact preview + generate (~one-third) */}
        <aside style={{ flex: "1 1 300px", minWidth: 270, maxWidth: 380, borderLeft: `1px solid ${H.line2}`, background: H.tint, padding: "22px 20px", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="hf-lbl">Preview · first student</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setPreviewBig(true)} className="hf-btn ghost" style={{ fontSize: 11, padding: "3px 7px" }} title="Expand the preview">
                Expand
              </button>
            </div>
            <div style={{ transform: "scale(0.86)", transformOrigin: "top center", display: "flex", flexDirection: "column", gap: 10 }}>
              {first && kinds.includes("certificate") && <CertPreview student={first} settings={model.settings} />}
              {first && kinds.includes("report") && <ReportPreview student={first} settings={model.settings} />}
            </div>
            <div className="hf-sub" style={{ fontSize: 11, textAlign: "center", marginTop: -10 }}>
              {first ? first.name : "First student"}’s data · highlighted fields are merged · <button onClick={() => setPreviewBig(true)} style={{ border: "none", background: "transparent", color: H.pink, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}>see closer</button>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <Card style={{ padding: "11px 13px", display: "flex", gap: 10, alignItems: "flex-start", background: H.paper }}>
            <Mark kind="warn" size={15} />
            <span className="hf-sub" style={{ fontSize: 11 }}>
              <strong>Georgia Pro Condensed</strong> (certificate name line) is proprietary and may be absent — the name line will use a substitute. Embed fonts in the template to keep the exact look.
            </span>
          </Card>

          {step === "generating" ? (
            <Card style={{ padding: "16px 18px", background: H.paper }}>
              <div style={{ display: "flex", gap: 9, alignItems: "center", marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: H.pink }} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>Generating…</span>
              </div>
              <div style={{ width: "100%", height: 7, background: H.tint2, borderRadius: 5, overflow: "hidden" }}>
                <div style={{ width: "45%", height: "100%", background: H.pink, borderRadius: 5 }} />
              </div>
              <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 10 }}>
                Filling {model.students.length} students × {kinds.length} template(s) and bundling into a .zip…
              </div>
            </Card>
          ) : (
            <Button
              variant="pri"
              style={{ justifyContent: "center", padding: 13 }}
              disabled={!requiredReady}
              onClick={doGenerate}
              title={requiredReady ? undefined : "Upload the required template(s) first"}
            >
              <Icon name="award" color="#fff" />
              Generate {model.students.length}{choice === "both" ? " × 2" : ""} document{model.students.length === 1 && choice !== "both" ? "" : "s"}
            </Button>
          )}
        </aside>
      </div>

      {/* expanded preview — a closer look without owning the viewport */}
      {previewBig && first && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(31,42,49,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={() => setPreviewBig(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxHeight: "90vh", overflow: "auto", maxWidth: 520, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>Preview · {first.name}</span>
              <div style={{ flex: 1 }} />
              <Button variant="ghost" onClick={() => setPreviewBig(false)} style={{ background: H.paper }}>Close</Button>
            </div>
            {kinds.includes("certificate") && <CertPreview student={first} settings={model.settings} />}
            {kinds.includes("report") && <ReportPreview student={first} settings={model.settings} />}
          </div>
        </div>
      )}
    </CycleShell>
  );
}

// ── results ───────────────────────────────────────────────────────────────
function ResultsView({
  cycleId,
  cycleName,
  model,
  result,
  onBack,
  onRetry,
}: {
  cycleId: string;
  cycleName: string;
  model: DocumentsModel;
  result: GenerateResult;
  onBack: () => void;
  onRetry: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "complete" | "failed">("all");

  const kinds = Object.keys(result.kinds) as DocKind[];
  const statusOf = (s: (typeof result.perStudent)[number]) =>
    kinds.some((k) => s.results[k]?.status === "error") ? "failed" : "complete";

  const rows = result.perStudent.filter((s) => {
    if (search && !`${s.name} ${s.id}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter !== "all" && statusOf(s) !== filter) return false;
    return true;
  });

  const totalComplete = result.perStudent.filter((s) => statusOf(s) === "complete").length;
  const totalFailed = result.perStudent.length - totalComplete;

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Certificates"
      area="documents"
      primary={
        result.zipUrl ? (
          <a href={result.zipUrl} download={result.zipName ?? "documents.zip"}>
            <Button variant="pri">
              <Icon name="download" color="#fff" />
              Download .zip
            </Button>
          </a>
        ) : null
      }
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", padding: "20px 30px", gap: 24, borderBottom: `1px solid ${H.line}`, background: H.paper, alignItems: "center" }}>
          <div>
            <div className="hf-h1" style={{ fontSize: 20 }}>Documents</div>
            <div className="hf-sub" style={{ marginTop: 5 }}>{model.settings.cycleName} · {kinds.join(" + ")}</div>
          </div>
          <div style={{ flex: 1 }} />
          <Stat n={String(totalComplete)} label="Complete" />
          <Stat n={String(totalFailed)} label="Failed" bad={totalFailed > 0} />
          <Button variant="ghost" onClick={onBack}>Start over</Button>
        </div>

        {result.fonts.warnings.length > 0 && (
          <div style={{ padding: "10px 30px", background: H.warnSoft, borderBottom: `1px solid ${H.line}`, display: "flex", flexDirection: "column", gap: 4 }}>
            {result.fonts.warnings.map((w, i) => (
              <span key={i} style={{ fontSize: 11.5, color: H.ink, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <Mark kind="warn" size={14} /> {w}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: "flex", padding: "11px 30px", gap: 9, borderBottom: `1px solid ${H.line}`, background: H.paper, alignItems: "center" }}>
          <label className="hf-field" style={{ width: 240 }}>
            <Icon name="search" color={H.ink3} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or ID" style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12.5 }} />
          </label>
          {(["all", "complete", "failed"] as const).map((f) => (
            <span key={f} className={`hf-chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)} style={{ textTransform: "capitalize", cursor: "pointer" }}>{f}</span>
          ))}
          <div style={{ flex: 1 }} />
          {totalFailed > 0 && <Button variant="ghost" onClick={onRetry}><Icon name="refresh" />Regenerate</Button>}
        </div>

        <div style={{ flex: 1, overflow: "auto", background: H.paper }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="hf-th">Participant</th>
                <th className="hf-th">Award</th>
                {kinds.map((k) => (
                  <th key={k} className="hf-th" style={{ textAlign: "center", width: 220, textTransform: "capitalize" }}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="hf-hover">
                  <td className="hf-td">
                    <span className="hf-mono" style={{ fontSize: 11, color: H.ink3, marginRight: 10 }}>{s.id}</span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{s.name || <em style={{ color: H.bad }}>no name</em>}</span>
                  </td>
                  <td className="hf-td"><Pill>{s.award || "—"}</Pill></td>
                  {kinds.map((k) => {
                    const d = s.results[k];
                    return (
                      <td key={k} className="hf-td" style={{ textAlign: "center" }}>
                        {d?.status === "complete" ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: H.good, fontWeight: 600 }}>
                            <Mark kind="pass" size={13} /> In&nbsp;zip
                          </span>
                        ) : (
                          <span title={d?.error} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: H.bad, fontWeight: 700 }}>
                            <Mark kind="fail" size={12} /> Failed
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hf-sub" style={{ padding: "14px 30px" }}>
            Showing {rows.length} of {result.perStudent.length} · one .pptx per student per type, bundled in the .zip — open and export to PDF to finalise
          </div>
        </div>
      </div>
    </CycleShell>
  );
}

// ── small components ──────────────────────────────────────────────────────
function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="hf-lbl" style={{ marginBottom: 10 }}>{n} · {title}</div>
      {children}
    </div>
  );
}

function Choice2({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 8,
        border: `1px solid ${on ? H.pink : H.line2}`,
        background: on ? H.pinkSoft : H.paper,
        color: on ? H.pink : H.ink2,
        fontWeight: on ? 700 : 600,
        fontSize: 12.5,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function TemplateUpload({ label, file, onFile }: { label: string; file: File | null; onFile: (f: File | null) => void }) {
  return (
    <Card style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 13 }}>
      <div style={{ width: 38, height: 38, borderRadius: 8, background: H.pinkSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="doc" size={18} color={H.pink} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
        <div className="hf-sub hf-mono" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : ".pptx with {{ }} merge tokens"}
        </div>
      </div>
      <label className="hf-btn" style={{ cursor: "pointer" }}>
        {file ? "Replace" : "Upload"}
        <input type="file" accept=".pptx" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </label>
    </Card>
  );
}

function FieldList({ title, fields }: { title: string; fields: string[][] }) {
  return (
    <Card style={{ overflow: "hidden" }}>
      <div className="hf-lbl" style={{ padding: "9px 16px", background: H.tint }}>{title}</div>
      {fields.map((f, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", padding: "9px 16px", gap: 12, borderTop: `1px solid ${H.line}` }}>
          <span className="hf-mono" style={{ fontSize: 11.5, color: H.pink, background: H.pinkSoft, padding: "2px 8px", borderRadius: 5 }}>{f[0]}</span>
          <Icon name="arrow" size={13} color={H.ink3} />
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{f[1]}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: H.good }}>
            <Mark kind="pass" size={11} /> Mapped
          </span>
        </div>
      ))}
    </Card>
  );
}

function SettingField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="hf-lbl">{label}</span>
      <input
        defaultValue={value}
        key={value}
        onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
        style={{ border: `1px solid ${H.line2}`, borderRadius: 7, padding: "7px 9px", fontSize: 12.5, outline: "none", background: H.paper, color: H.ink }}
      />
    </label>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <span style={{ background: H.pinkSoft, color: H.pink, padding: "0 6px", borderRadius: 4 }}>{children}</span>;
}

function CertPreview({ student, settings }: { student: StudentSummary; settings: DocumentsModel["settings"] }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${H.line2}`, borderRadius: 6, boxShadow: "0 4px 18px rgba(31,42,49,.12)", padding: 20, textAlign: "center", position: "relative" }}>
      <div style={{ position: "absolute", inset: 8, border: `1.5px solid ${H.pink}`, borderRadius: 4, opacity: 0.45, pointerEvents: "none" }} />
      <div style={{ fontFamily: "var(--font-script)", fontSize: 24, color: H.pink }}>Alsama</div>
      <div className="hf-lbl" style={{ fontSize: 9, marginTop: 6 }}>G12++ Certificate</div>
      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 10 }}><Field>{student.name}</Field></div>
      <div className="hf-sub" style={{ fontSize: 11, marginTop: 6 }}>has been awarded</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: H.pink, marginTop: 4 }}><Field>{student.award}</Field></div>
      <div className="hf-sub hf-mono" style={{ fontSize: 9.5, marginTop: 10 }}>
        Result ID <Field>{student.participantId}</Field> · {settings.testCentre}
      </div>
    </div>
  );
}

function ReportPreview({ student, settings }: { student: StudentSummary; settings: DocumentsModel["settings"] }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${H.line2}`, borderRadius: 6, boxShadow: "0 4px 18px rgba(31,42,49,.12)", padding: "16px 18px" }}>
      <div style={{ fontWeight: 800, color: H.pink, fontSize: 13 }}>Exam Performance Report</div>
      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4 }}><Field>{student.name}</Field></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
        {student.subjects.map((s) => (
          <div key={s.slot} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span style={{ flex: 1, color: H.ink2 }}>{s.assessment}</span>
            <span className="hf-mono" style={{ color: H.pink, fontWeight: 700, width: 28, letterSpacing: 1 }}>{s.stars || "·"}</span>
            <span style={{ width: 150, fontWeight: 600 }}><Field>{s.level || "—"}</Field></span>
          </div>
        ))}
      </div>
      <div className="hf-sub hf-mono" style={{ fontSize: 9.5, marginTop: 10 }}>
        Result ID <Field>{student.participantId}</Field> · {settings.examDate}
      </div>
    </div>
  );
}

function Stat({ n, label, bad }: { n: string; label: string; bad?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span className="hf-mono" style={{ fontSize: 25, fontWeight: 600, lineHeight: 1, color: bad ? H.bad : H.ink }}>{n}</span>
      <span className="hf-lbl" style={{ marginTop: 4 }}>{label}</span>
    </div>
  );
}
