"use client";

/**
 * Screen — CGJ (Centre Grade Judgement). Sits directly after Cut scores and
 * before Grades. Partner centres supply an Excel listing their students and the
 * grade they EXPECT in each subject; an admin uploads it here (same flow as the
 * incident log), and the screen lines the centre's expectations up against the
 * ACTUAL grades the pipeline produced — a check on the cut scores before grades
 * are confirmed.
 *
 * Lean by design: upload + side-by-side comparison only. It does NOT recompute
 * any grade — the actual levels come from the engine via `getGrades`.
 *
 * O2 (open for G12): the PLD→award alignment (Doesn't-meet ↔ No Award, Meets ↔
 * Secondary, Exceeds ↔ Advanced, Outstanding ↔ Distinction) is an ASSUMPTION,
 * not signed off. It is surfaced here as a clearly-labelled assumption and is
 * never baked into grading.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell } from "@/components/shell/CycleShell";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/infotip";
import { parseCgjFile } from "@/lib/data/parse-cgj";
import type { CgjModel, CgjMatch, CgjStudentRow } from "@/lib/data/types";

/** Short, vocabulary-agnostic label for a performance level (first word(s)). */
function shortLevel(level: string | null): string {
  if (!level) return "—";
  if (/doesn|not yet|below/i.test(level)) return "Doesn't meet";
  return level.split(/\s+/)[0] ?? level;
}

const MATCH_COLOR: Record<CgjMatch, string> = {
  match: H.good,
  above: H.slate,
  below: H.bad,
  missing: H.ink3,
};
const MATCH_LABEL: Record<CgjMatch, string> = {
  match: "Matches expectation",
  above: "Above expectation",
  below: "Below expectation",
  missing: "No comparison",
};

export default function CgjPage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const provider = useProvider();
  const model = useProviderData((p) => p.getCgj(cycleId), [cycleId]) as CgjModel | null;
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";

  const shellProps = {
    cycleId,
    cycleName,
    page: "CGJ",
    stageIndex: 9,
    primary: (
      // CGJ → Grades (step 11): CGJ is a check, not a gate — it never blocks the
      // move to Grades.
      <Link href={`/cycles/${cycleId}/grades`}>
        <Button variant="pri" title="Continue to grades">
          Continue<Icon name="arrow" color="#fff" />
        </Button>
      </Link>
    ),
  };

  if (!model) {
    return (
      <CycleShell {...shellProps}>
        <div style={{ padding: 32 }} className="hf-sub">No CGJ data for this sitting.</div>
      </CycleShell>
    );
  }

  return (
    <CycleShell {...shellProps}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {/* header */}
        <div className="hf-pad" style={{ display: "flex", alignItems: "flex-end", gap: 20, padding: "22px 28px 0", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="hf-h1">Centre grade judgement</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 660 }}>
              Compare the partner centre's <b style={{ color: H.ink }}>expected</b> grades against the{" "}
              <b style={{ color: H.ink }}>actual</b> grades from these cut scores. A check on the boundaries —
              it never changes a grade.
            </div>
          </div>
          {model.uploaded && (
            <div style={{ display: "flex", gap: 22 }}>
              <Stat n={String(model.counts.compared)} label="Compared" />
              <Stat n={String(model.counts.matched)} label="Match" tone={H.good} />
              <Stat n={String(model.counts.below)} label="Below" tone={model.counts.below > 0 ? H.bad : undefined} />
              <Stat n={String(model.counts.above)} label="Above" tone={H.slate} />
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto", borderTop: `1px solid ${H.line}`, marginTop: 16 }}>
          <div style={{ padding: "18px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
            <AssumptionCard model={model} />
            {model.uploaded ? <Comparison cycleId={cycleId} model={model} /> : <UploadPrompt cycleId={cycleId} />}
          </div>
        </div>
      </div>
    </CycleShell>
  );
}

function Stat({ n, label, tone }: { n: string; label: string; tone?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="hf-mono" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1, color: tone ?? H.ink }}>{n}</span>
      <span className="hf-lbl" style={{ marginTop: 3 }}>{label}</span>
    </div>
  );
}

// ── O2 assumption: the PLD→award alignment, clearly labelled, not signed off ──
function AssumptionCard({ model }: { model: CgjModel }) {
  return (
    <div className="hf-card" style={{ padding: "14px 16px", borderColor: H.warnSoft, background: H.warnSoft }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Mark kind="warn" size={14} />
        <span style={{ fontWeight: 700, fontSize: 12.5, color: H.ink }}>Assumed mapping — not signed off</span>
        <Badge tone="warn">O2 · OPEN FOR G12</Badge>
        <InfoTip label="About the assumed mapping">
          The alignment between performance levels (PLDs) and award levels below is the rank-for-rank pairing of
          the two confirmed vocabularies. It is an <b>assumption</b> pending G12 sign-off and is used only to
          label this comparison — it never changes how any grade or award is derived.
        </InfoTip>
      </div>
      <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 6, marginBottom: 10 }}>
        How an expected performance level is taken to imply an award. Provisional — confirm with G12 before relying on it.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {model.pldAwardMap.map((m) => (
          <div key={m.performanceLevel} className="hf-card" style={{ padding: "6px 10px", background: H.paper, display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: H.ink }}>{shortLevel(m.performanceLevel)}</span>
            <Icon name="arrow" size={11} color={H.ink3} />
            <span className="hf-mono" style={{ fontSize: 11, color: H.ink2 }}>{m.awardLevel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── empty state + upload ──────────────────────────────────────────────────────
function UploadPrompt({ cycleId }: { cycleId: string }) {
  const provider = useProvider();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await parseCgjFile(file);
      if (rows.length === 0) setError("No expectations found. Use a .xlsx with a student column and one column per subject (expected level per cell).");
      else provider.uploadCgjFile(cycleId, file.name, rows);
    } catch {
      setError("Couldn't read that file. Use a .xlsx listing students and their expected grade per subject.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "48px 30px", textAlign: "center" }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <div style={{ width: 54, height: 54, borderRadius: 999, border: `1.5px dashed ${H.line2}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="upload" color={H.ink3} />
      </div>
      <div className="hf-h2">No centre file added</div>
      <div className="hf-sub" style={{ maxWidth: 540, lineHeight: 1.5 }}>
        Upload the partner centre's Excel of expected grades (one row per student, one column per subject). We line
        each expectation up against the actual grade — or load a labelled sample to see how it works.
      </div>
      <div style={{ display: "flex", gap: 9 }}>
        <Button variant="pri" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" color="#fff" size={14} />{busy ? "Reading…" : "Upload centre file"}
        </Button>
        <Button onClick={() => provider.loadSampleCgj(cycleId)}>Load sample (labelled)</Button>
      </div>
      {error && <div className="hf-sub" style={{ fontSize: 11.5, color: H.bad, maxWidth: 520 }}>{error}</div>}
    </div>
  );
}

// ── side-by-side comparison ───────────────────────────────────────────────────
function Comparison({ cycleId, model }: { cycleId: string; model: CgjModel }) {
  const provider = useProvider();
  // Show centre-file students first (the ones with expectations), in-file rows on top.
  const rows = [...model.rows].sort((a, b) => Number(b.inCentreFile) - Number(a.inCentreFile));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* file chip */}
      <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", background: model.sample ? H.pinkSoft2 : H.tint, borderBottom: `1px solid ${H.line2}`, flexWrap: "wrap" }}>
          <Mark kind="pass" size={16} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{model.fileName}</span>
          {model.sample && <Badge tone="accent">SAMPLE</Badge>}
          <span style={{ flex: 1 }} />
          <span className="hf-sub" style={{ fontSize: 11.5 }}>
            {model.counts.studentsInFile} student{model.counts.studentsInFile === 1 ? "" : "s"} in file
            {model.counts.unmatchedStudents > 0 ? ` · ${model.counts.unmatchedStudents} unmatched` : ""}
          </span>
          <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.clearCgj(cycleId)}><Icon name="trash" size={13} />Remove</Button>
        </div>
        {model.counts.unmatchedStudents > 0 && (
          <div className="hf-sub" style={{ fontSize: 11.5, padding: "8px 14px", color: H.warn }}>
            <Mark kind="warn" size={12} /> {model.counts.unmatchedStudents} student name(s) in the file did not match a roster student — those expectations are not compared.
          </div>
        )}
      </div>

      {/* legend */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {(["match", "above", "below", "missing"] as CgjMatch[]).map((k) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: H.ink2 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: MATCH_COLOR[k] }} />
            {MATCH_LABEL[k]}
          </span>
        ))}
      </div>

      {/* matrix: students × subjects, each cell expected → actual */}
      <div className="hf-card" style={{ padding: 0, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead>
            <tr style={{ background: H.tint }}>
              <th style={{ ...thStyle, textAlign: "left", position: "sticky", left: 0, background: H.tint }}>Student</th>
              {model.assessments.map((a) => (
                <th key={a.id} style={thStyle} title={a.name}>{a.shortName}</th>
              ))}
              <th style={thStyle}>Summary</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.participantId} row={r} model={model} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row, model }: { row: CgjStudentRow; model: CgjModel }) {
  return (
    <tr style={{ borderTop: `1px solid ${H.line}`, opacity: row.inCentreFile ? 1 : 0.5 }}>
      <td style={{ ...tdStyle, textAlign: "left", position: "sticky", left: 0, background: H.paper, fontWeight: 600 }}>
        {row.name}
        {!row.inCentreFile && <span className="hf-sub" style={{ fontSize: 10, marginLeft: 6 }}>not in file</span>}
      </td>
      {model.assessments.map((a) => {
        const c = row.subjects[a.id];
        const m = c?.match ?? "missing";
        return (
          <td key={a.id} style={tdStyle} title={`${MATCH_LABEL[m]} — expected ${shortLevel(c?.expected ?? null)}, actual ${shortLevel(c?.actual ?? null)}`}>
            {m === "missing" && !c?.expected ? (
              <span style={{ color: H.ink3 }}>—</span>
            ) : (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: H.ink2 }}>{shortLevel(c?.expected ?? null)}</span>
                <Icon name="arrow" size={10} color={H.ink3} />
                <span style={{ fontWeight: 700, color: MATCH_COLOR[m] }}>{shortLevel(c?.actual ?? null)}</span>
              </div>
            )}
          </td>
        );
      })}
      <td style={tdStyle}>
        {row.summary.compared === 0 ? (
          <span style={{ color: H.ink3 }}>—</span>
        ) : (
          <span className="hf-mono" style={{ fontSize: 11 }}>
            <span style={{ color: H.good }}>{row.summary.matched}=</span>{" "}
            <span style={{ color: H.slate }}>{row.summary.above}▲</span>{" "}
            <span style={{ color: row.summary.below > 0 ? H.bad : H.ink3 }}>{row.summary.below}▼</span>
          </span>
        )}
      </td>
    </tr>
  );
}

const thStyle: React.CSSProperties = {
  padding: "9px 12px",
  textAlign: "center",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".4px",
  textTransform: "uppercase",
  color: H.ink2,
  whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: "9px 12px",
  textAlign: "center",
  whiteSpace: "nowrap",
};
