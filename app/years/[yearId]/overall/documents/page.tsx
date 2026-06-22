"use client";

/**
 * Overall certificates & reports — document generation from the year's Overall
 * (best-of-two) result, NOT a single sitting. Certificates issue from Overall, so
 * this page reads `getOverallDocuments(yearId)` (the rolled-up best-of-two awards)
 * and feeds the same in-browser PPTX generator the per-sitting documents screen
 * uses. Available once the Overall is signed off (both sittings locked).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { getDocumentGenerator } from "@/lib/documents/generator";
import type { DocKind, GenerateResult } from "@/lib/documents/types";
import { BatchPreview, CertificateProof, ReportProof, studentIssues } from "@/components/documents/BatchPreview";

const KINDS: DocKind[] = ["certificate", "report"];
const KIND_LABEL: Record<DocKind, string> = {
  certificate: "Certificates",
  report: "Performance reports",
  unofficial: "Unofficial reports",
};

export default function OverallDocumentsPage({ params }: { params: { yearId: string } }) {
  const yearId = params.yearId;
  const provider = useProvider();
  const year = useProviderData((p) => p.getYear(yearId), [yearId]);
  const model = useProviderData((p) => p.getOverallDocuments(yearId), [yearId]);

  const [selected, setSelected] = useState<Set<DocKind>>(() => new Set<DocKind>(["certificate"]));
  const [step, setStep] = useState<"config" | "generating" | "results">("config");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBatch, setShowBatch] = useState(false);

  const kinds: DocKind[] = useMemo(() => KINDS.filter((k) => selected.has(k)), [selected]);
  const toggleKind = (k: DocKind) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      if (next.size === 0) next.add(k);
      return next;
    });

  const crumb = [
    { label: "Years", href: "/" },
    { label: year?.name ?? "Year", href: `/years/${yearId}` },
    { label: "Overall", href: `/years/${yearId}/overall` },
    { label: "Certificates" },
  ];

  if (!model) {
    return (
      <Shell active="Cycles" crumb={crumb}>
        <div style={{ padding: 32 }} className="hf-sub">No Overall results for this year.</div>
      </Shell>
    );
  }

  // Gate: Overall must be signed off (both sittings locked).
  if (!model.locked) {
    return (
      <Shell active="Cycles" crumb={crumb}>
        <div style={{ padding: "40px 32px", maxWidth: 640 }}>
          <div className="hf-h1">Overall certificates</div>
          <Card style={{ marginTop: 18, padding: "18px 20px", display: "flex", gap: 13, alignItems: "flex-start", background: H.warnSoft }}>
            <Mark kind="warn" size={18} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>Lock both sittings first</div>
              <div className="hf-sub" style={{ marginTop: 5 }}>
                Certificates issue from the Overall best-of-two result, which is final only once both the February and May sittings are signed off. Lock each sitting’s grades, then come back here.
              </div>
              <Link href={`/years/${yearId}`} style={{ display: "inline-block", marginTop: 12 }}>
                <Button variant="pri">Back to {year?.name ?? "year"}<Icon name="arrow" color="#fff" /></Button>
              </Link>
            </div>
          </Card>
        </div>
      </Shell>
    );
  }

  const first = model.students[0];
  const flaggedCount = model.students.filter((s) => studentIssues(s, kinds).length).length;

  const doGenerate = async () => {
    setError(null);
    setStep("generating");
    try {
      const res = await getDocumentGenerator().generate({
        cycleId: model.cycleId,
        kinds,
        students: model.students,
        settings: model.settings,
        templates: {},
      });
      setResult(res);
      setStep("results");
      if (res.zipUrl) {
        const a = document.createElement("a");
        a.href = res.zipUrl;
        a.download = res.zipName ?? "overall_documents.zip";
        a.click();
      }
      const total = Object.values(res.kinds).reduce((s, k) => s + (k?.complete ?? 0), 0);
      provider.recordDocuments(model.cycleId, `${total} Overall .pptx across ${kinds.join(" + ")} (zip)`);
    } catch (e) {
      setError((e as Error).message);
      setStep("config");
    }
  };

  return (
    <Shell active="Cycles" crumb={crumb}>
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 32px", gap: 20, flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="hf-h1">{model.settings.cycleName} · Certificates</div>
          <Badge tone="good"><Mark kind="pass" size={12} /> Overall signed off</Badge>
        </div>
        <div className="hf-sub" style={{ maxWidth: 720 }}>
          Generated from the <strong>Overall best-of-two awards</strong> ({model.students.length} students) — each student’s certificate carries the higher award across the two sittings, not a single sitting’s result. Fills the built-in PowerPoint templates and downloads one .pptx per student in a .zip.
        </div>

        {error && (
          <Card style={{ padding: "12px 15px", background: H.badSoft, borderColor: H.bad, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Mark kind="fail" size={16} />
            <span style={{ fontSize: 12.5, color: H.bad, wordBreak: "break-word" }}>{error}</span>
          </Card>
        )}

        {step === "results" && result ? (
          <ResultsView result={result} total={model.students.length} onBack={() => setStep("config")} />
        ) : (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: "1 1 360px", minWidth: 320 }}>
              <div>
                <div className="hf-lbl" style={{ marginBottom: 10 }}>Document type</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {KINDS.map((k) => (
                    <button
                      key={k}
                      onClick={() => toggleKind(k)}
                      style={{
                        padding: "8px 16px", borderRadius: 8,
                        border: `1px solid ${selected.has(k) ? H.pink : H.line2}`,
                        background: selected.has(k) ? H.pinkSoft : H.paper,
                        color: selected.has(k) ? H.pink : H.ink2,
                        fontWeight: selected.has(k) ? 700 : 600, fontSize: 12.5, cursor: "pointer",
                        display: "inline-flex", alignItems: "center", gap: 6,
                      }}
                    >
                      {selected.has(k) && <Mark kind="pass" size={12} />}
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>

              {flaggedCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: H.warn, fontWeight: 700 }}>
                  <Mark kind="warn" size={13} /> {flaggedCount} student{flaggedCount === 1 ? "" : "s"} with content issues — check before generating
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <Button variant="pri" disabled={step === "generating"} onClick={doGenerate}>
                  <Icon name="award" color="#fff" />
                  {step === "generating" ? "Generating…" : `Generate ${model.students.length} document${model.students.length === 1 ? "" : "s"}`}
                </Button>
                <Button onClick={() => setShowBatch(true)} disabled={!model.students.length}>
                  <Icon name="search" />
                  Preview &amp; verify
                </Button>
              </div>
            </div>

            <Card style={{ flex: "0 1 320px", minWidth: 280, padding: 16, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              <span className="hf-lbl" style={{ alignSelf: "flex-start" }}>Preview · first student</span>
              {first && kinds.includes("certificate") && <CertificateProof student={first} settings={model.settings} scale={300 / 1122} />}
              {first && kinds.includes("report") && <ReportProof student={first} settings={model.settings} scale={232 / 1080} />}
              <div className="hf-sub" style={{ fontSize: 11, textAlign: "center" }}>
                {first ? `${first.name} · ${first.award}` : "No students"}
              </div>
            </Card>
          </div>
        )}

        <div>
          <Link href={`/years/${yearId}/overall`} style={{ color: H.pink, fontSize: 13 }}>
            ‹ Back to Overall
          </Link>
        </div>
      </div>

      {showBatch && (
        <BatchPreview students={model.students} settings={model.settings} kinds={kinds} onClose={() => setShowBatch(false)} />
      )}
    </Shell>
  );
}

function ResultsView({ result, total, onBack }: { result: GenerateResult; total: number; onBack: () => void }) {
  const kinds = Object.keys(result.kinds) as DocKind[];
  const statusOf = (s: (typeof result.perStudent)[number]) =>
    kinds.some((k) => s.results[k]?.status === "error") ? "failed" : "complete";
  const complete = result.perStudent.filter((s) => statusOf(s) === "complete").length;
  const failed = result.perStudent.length - complete;
  return (
    <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Generated {complete} of {total}</div>
        {failed > 0 && <span style={{ color: H.bad, fontWeight: 700 }}>{failed} failed</span>}
        <div style={{ flex: 1 }} />
        {result.zipUrl && (
          <a href={result.zipUrl} download={result.zipName ?? "overall_documents.zip"}>
            <Button variant="pri"><Icon name="download" color="#fff" />Download .zip</Button>
          </a>
        )}
        <Button onClick={onBack}>Start over</Button>
      </div>
      <div className="hf-sub" style={{ fontSize: 12 }}>
        One .pptx per student per type, bundled in the .zip — open and export to PDF to finalise.
      </div>
    </Card>
  );
}
