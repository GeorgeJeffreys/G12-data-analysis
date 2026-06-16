"use client";

/**
 * Inline certificate & performance-report preview.
 *
 * IMPORTANT — what this is and isn't:
 *  - This is a CONTENT & LAYOUT preview, *not* a print-exact proof. A pixel
 *    rendering of the .pptx would need LibreOffice (a separate deployment),
 *    which is out of scope. Instead we reproduce each template in HTML/CSS,
 *    positioned from the real slide coordinates, and fill it with the *same*
 *    merge data + token mapping that the PPTX generator uses. So the text you
 *    see here is exactly the text that lands in the file — it catches a wrong
 *    name, wrong award, mis-mapped token or blank field — and the layout is a
 *    faithful approximation good enough to spot text overflow and obvious
 *    layout problems before the final batch is generated.
 *  - Fonts: Barlow (report body) is open and loaded in-browser, so report
 *    overflow is accurate. Georgia Pro Condensed (certificate name line) is
 *    proprietary and usually can't load in-browser, so the name renders in a
 *    close serif fallback and certificate-name overflow is *approximate* — we
 *    say so in the UI rather than pretending the fallback is exact.
 *
 * Nothing here persists or exports PII: it renders the same in-memory
 * `StudentSummary[]` the rest of the live screen already holds.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { H } from "@/lib/ui/tokens";
import { Button } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import type { DocKind } from "@/lib/documents/types";
import type { DocSettings, StudentSummary } from "@/lib/data/types";

// ── fidelity constants, lifted from the real .pptx templates ────────────────
// Slide sizes (EMU → CSS px at 96ppi) and shape positions are percentages of
// the slide, read straight from the template XML so the layout matches.
const PT = 96 / 72; // pt → css px
const CERT = { W: 1122, H: 793 }; // 11.69in × 8.26in landscape (A4)
const REPORT = { W: 1080, H: 1350 }; // 11.25in × 14.06in portrait

// Name-overflow thresholds (reference px, independent of on-screen scale).
// Certificate: the name runs off the page if it exceeds the visible width.
const CERT_NAME_PX = 46.2 * PT;
const CERT_NAME_MAX = CERT.W * 0.96;
// Report: the name box is a real, narrow constraint (≈38% of the page).
const REPORT_NAME_PX = 36 * PT;
const REPORT_NAME_MAX = REPORT.W * 0.382;

// Georgia Pro Condensed is commercial; this is the in-browser fallback stack.
const GEORGIA_STACK = `"Georgia Pro Condensed", Georgia, "Times New Roman", "Noto Serif", serif`;
const BARLOW_STACK = `var(--font-barlow), "Barlow", "Helvetica Neue", Arial, sans-serif`;

// Subject labels are baked into the report template (not tokens), so these are
// literally what prints; stars + level are merged per slot S1..S5.
const REPORT_SUBJECTS: { slot: string; label: string }[] = [
  { slot: "S1", label: "Applicable Math" },
  { slot: "S2", label: "Scientific Thinking" },
  { slot: "S3", label: "Arabic as 1st Language" },
  { slot: "S4", label: "English as 2nd Language" },
  { slot: "S5", label: "Life Success Skills" },
];

const INK = "#47535A";
const PINK_T = "#AD1059";

// ── issue detection ─────────────────────────────────────────────────────────
export type IssueSev = "error" | "warn";
export interface Issue {
  sev: IssueSev;
  label: string;
}
export interface OverflowFlags {
  cert: boolean;
  report: boolean;
}

function levelFor(student: StudentSummary, slot: string): string {
  return (student.subjects.find((s) => s.slot === slot)?.level ?? "").trim();
}
function starsFor(student: StudentSummary, slot: string): string {
  return (student.subjects.find((s) => s.slot === slot)?.stars ?? "").trim();
}

/** Per-student issues the preview can detect, before the batch is generated. */
export function studentIssues(
  student: StudentSummary,
  kinds: DocKind[],
  overflow?: OverflowFlags,
): Issue[] {
  const issues: Issue[] = [];
  if (!student.name.trim()) issues.push({ sev: "error", label: "Name is blank — required field" });
  if (kinds.includes("certificate")) {
    if (!student.award.trim()) issues.push({ sev: "error", label: "Award missing" });
    if (overflow?.cert) issues.push({ sev: "warn", label: "Name may overflow the certificate" });
  }
  if (kinds.includes("report")) {
    const missing = REPORT_SUBJECTS.filter((s) => !levelFor(student, s.slot)).length;
    if (missing > 0)
      issues.push({ sev: "warn", label: `${missing} subject level${missing > 1 ? "s" : ""} missing` });
    if (overflow?.report) issues.push({ sev: "warn", label: "Name may overflow the report" });
  }
  if (kinds.includes("unofficial")) {
    if (!student.unofficial || student.unofficial.length === 0)
      issues.push({ sev: "warn", label: "No element breakdown data" });
  }
  return issues;
}

function worstSev(issues: Issue[]): IssueSev | null {
  if (issues.some((i) => i.sev === "error")) return "error";
  if (issues.some((i) => i.sev === "warn")) return "warn";
  return null;
}

// ── overflow measurement layer ──────────────────────────────────────────────
// Renders every student's name once, off-screen, in the certificate (fallback
// serif) and report (Barlow) name styles, and flags those wider than their box.
// Re-measures once web fonts are ready so the result reflects the real metrics.
function useOverflowMap(students: StudentSummary[]) {
  const [map, setMap] = useState<Record<string, OverflowFlags>>({});
  const certRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const reportRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  const measure = useCallback(() => {
    const next: Record<string, OverflowFlags> = {};
    for (const s of students) {
      const c = certRefs.current[s.participantId];
      const r = reportRefs.current[s.participantId];
      next[s.participantId] = {
        cert: c ? c.getBoundingClientRect().width > CERT_NAME_MAX : false,
        report: r ? r.getBoundingClientRect().width > REPORT_NAME_MAX : false,
      };
    }
    setMap(next);
  }, [students]);

  useLayoutEffect(() => {
    measure();
    let alive = true;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(() => alive && measure());
    return () => {
      alive = false;
    };
  }, [measure]);

  const layer = (
    <div
      aria-hidden
      style={{ position: "absolute", top: -99999, left: 0, visibility: "hidden", height: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      {students.map((s) => (
        <div key={s.participantId} style={{ whiteSpace: "nowrap" }}>
          <span
            ref={(el) => {
              certRefs.current[s.participantId] = el;
            }}
            style={{ fontFamily: GEORGIA_STACK, fontSize: CERT_NAME_PX, fontWeight: 400, whiteSpace: "nowrap", display: "inline-block" }}
          >
            {s.name}
          </span>
          <span
            ref={(el) => {
              reportRefs.current[s.participantId] = el;
            }}
            style={{ fontFamily: BARLOW_STACK, fontSize: REPORT_NAME_PX, fontWeight: 700, whiteSpace: "nowrap", display: "inline-block" }}
          >
            {s.name}
          </span>
        </div>
      ))}
    </div>
  );

  return { map, layer };
}

// ── proof primitives ────────────────────────────────────────────────────────
function ProofFrame({ W, Ht, scale, children }: { W: number; Ht: number; scale: number; children: React.ReactNode }) {
  return (
    <div style={{ width: W * scale, height: Ht * scale, position: "relative", flex: "0 0 auto", background: "#fff", boxShadow: "0 6px 26px rgba(31,42,49,.16)", border: `1px solid ${H.line2}` }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: W, height: Ht, transformOrigin: "top left", transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

function TBox({ l, t, w, align = "center", size, bold, color = INK, font = BARLOW_STACK, children, style }: {
  l: number; t: number; w: number; align?: "center" | "left"; size: number; bold?: boolean; color?: string; font?: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={{ position: "absolute", left: `${l}%`, top: `${t}%`, width: `${w}%`, textAlign: align, fontFamily: font, fontSize: size * PT, fontWeight: bold ? 700 : 400, color, lineHeight: 1.15, ...style }}>
      {children}
    </div>
  );
}

/** A merged data value — lightly highlighted so staff can tell data from template. */
function Merge({ value, blankLabel }: { value: string; blankLabel?: string }) {
  if (!value.trim())
    return (
      <span style={{ display: "inline-block", padding: "0 8px", borderRadius: 4, border: `1.5px dashed ${H.bad}`, color: H.bad, fontSize: "0.7em", fontWeight: 700, verticalAlign: "middle" }}>
        {blankLabel ?? "⟨ blank ⟩"}
      </span>
    );
  return <span style={{ background: "rgba(193,44,104,.10)", borderRadius: 3, padding: "0 .15em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>{value}</span>;
}

// ── certificate proof ───────────────────────────────────────────────────────
export function CertificateProof({ student, settings, scale = 1, overflow }: { student: StudentSummary; settings: DocSettings; scale?: number; overflow?: boolean }) {
  return (
    <ProofFrame W={CERT.W} Ht={CERT.H} scale={scale}>
      {/* page inner rule, as in the template */}
      <div style={{ position: "absolute", inset: 14, border: `2px solid ${H.pink}`, opacity: 0.4, pointerEvents: "none" }} />

      {/* NAME — Georgia Pro Condensed (fallback in preview). Overflow runs off the page. */}
      <div style={{ position: "absolute", left: 0, top: "0.6%", width: "100%", height: "12.4%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: "100%", whiteSpace: "nowrap", overflow: "visible", fontFamily: GEORGIA_STACK, fontSize: 46.2 * PT, color: INK, padding: "0 .15em", outline: overflow ? `2px solid ${H.bad}` : "none", background: student.name.trim() ? "rgba(193,44,104,.10)" : "none" }}>
          {student.name.trim() ? student.name : <Merge value="" blankLabel="⟨ name blank ⟩" />}
        </div>
      </div>

      <TBox l={18.5} t={13.4} w={63} size={26.16} bold color={PINK_T}>G12++ CERTIFICATE</TBox>
      <TBox l={16.5} t={21.1} w={67} size={18.04}>This certifies that</TBox>
      <TBox l={13.7} t={39.1} w={72.3} size={15.99}>has satisfied requirements of the</TBox>
      <TBox l={11.7} t={44.7} w={78.7} size={24.47} bold>G12++</TBox>
      <TBox l={12.7} t={52.2} w={76.7} size={15.99}>
        and has been preliminary awarded the{" "}
        <strong style={{ fontWeight: 700 }}><Merge value={student.award} blankLabel="⟨ award missing ⟩" /></strong>
      </TBox>
      <TBox l={11.7} t={57.8} w={76.7} size={15.99}>
        Issued by <strong style={{ fontWeight: 700 }}>Alsama Project</strong> on: {settings.issueDate || "—"}
      </TBox>
      <TBox l={11.7} t={63.5} w={76.7} size={15.99}>
        <strong style={{ fontWeight: 700 }}>Result ID:</strong> <Merge value={student.participantId} />
      </TBox>
      <TBox l={12.7} t={69.1} w={76.7} size={15.99}>
        <strong style={{ fontWeight: 700 }}>Test centre: </strong>{settings.testCentre || "—"}
      </TBox>
      <TBox l={13.7} t={89.9} w={76.7} size={10}>Performance report for each exam subject is provided separately.</TBox>
    </ProofFrame>
  );
}

// ── performance report proof ────────────────────────────────────────────────
export function ReportProof({ student, settings, scale = 1, overflow }: { student: StudentSummary; settings: DocSettings; scale?: number; overflow?: boolean }) {
  return (
    <ProofFrame W={REPORT.W} Ht={REPORT.H} scale={scale}>
      <TBox l={41.1} t={5.5} w={15.5} size={44} bold color="#AD0E58">G12++</TBox>
      <TBox l={26.3} t={10.9} w={45.2} size={30} bold color="#AD0E58">Exam Performance Report</TBox>

      {/* NAME — Barlow Bold, real narrow box; overflow is accurate here. */}
      <div style={{ position: "absolute", left: "28.6%", top: "17.8%", width: "38.2%" }}>
        <div style={{ display: "inline-block", maxWidth: "100%", whiteSpace: "nowrap", overflow: "visible", fontFamily: BARLOW_STACK, fontSize: 35.99 * PT, fontWeight: 700, color: INK, padding: "0 .12em", outline: overflow ? `2px solid ${H.bad}` : "none", background: student.name.trim() ? "rgba(193,44,104,.10)" : "none" }}>
          {student.name.trim() ? student.name : <Merge value="" blankLabel="⟨ name blank ⟩" />}
        </div>
      </div>

      <TBox l={11.5} t={24.2} w={76.7} size={17.96}>has achieved the following performance level in each subject of the G12++ Exam:</TBox>

      {/* subject table */}
      <div style={{ position: "absolute", left: "10%", top: "29.2%", width: "82.8%", fontFamily: BARLOW_STACK, color: INK }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "31%" }} />
            <col style={{ width: "30.2%" }} />
            <col style={{ width: "38.9%" }} />
          </colgroup>
          <thead>
            <tr>
              {["Subject", "Performance", "Level"].map((h) => (
                <th key={h} style={{ fontSize: 19.99 * PT, fontWeight: 700, textAlign: "center", padding: "10px 8px", borderBottom: `2px solid ${INK}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {REPORT_SUBJECTS.map(({ slot, label }) => {
              const lvl = levelFor(student, slot);
              const stars = starsFor(student, slot);
              return (
                <tr key={slot}>
                  <td style={{ fontSize: 15.99 * PT, padding: "9px 8px", borderBottom: `1px solid ${H.line2}` }}>{label}</td>
                  <td style={{ fontSize: 15.99 * PT, padding: "9px 8px", textAlign: "center", borderBottom: `1px solid ${H.line2}`, color: H.pink, letterSpacing: 2, fontWeight: 700 }}>
                    {stars || <span style={{ color: H.ink3, letterSpacing: 0 }}>—</span>}
                  </td>
                  <td style={{ fontSize: 15.99 * PT, padding: "9px 8px", textAlign: "center", borderBottom: `1px solid ${H.line2}`, fontWeight: 600 }}>
                    <Merge value={lvl} blankLabel="⟨ level missing ⟩" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <TBox l={10} t={78.3} w={40} align="left" size={18} color="#48545B">
        Exams conducted on <strong style={{ fontWeight: 700 }}>{settings.examDate || "—"}</strong>
      </TBox>
      <TBox l={60.5} t={78.6} w={32.3} size={17.99}>
        <strong style={{ fontWeight: 700 }}>Result ID:</strong> <Merge value={student.participantId} />
      </TBox>
      <TBox l={26.5} t={81} w={46.9} align="left" size={18} color="#48545B">
        Issued by <strong style={{ fontWeight: 700 }}>Alsama Project</strong> on {settings.issueDate || "—"}
      </TBox>
      <TBox l={23.9} t={84.6} w={52.3} size={15.99}>
        <strong style={{ fontWeight: 700 }}>Test centre: </strong>{settings.testCentre || "—"}
      </TBox>
      <TBox l={10} t={95.8} w={79.7} size={10}>
        This document is an exam performance report and <em>not</em> an awarded G12++ certificate.
      </TBox>
    </ProofFrame>
  );
}

// ── unofficial diagnostic proof (element / sub-element breakdown) ────────────
// The unofficial report is a richer internal/learner breakdown. It has no fixed
// single-page slide layout, so this is rendered as a faithful *content* card —
// clearly marked UNOFFICIAL — rather than a page proof. `width` lets it serve as
// both the aside thumbnail and the full stage view.
export function UnofficialProof({ student, width = 460 }: { student: StudentSummary; width?: number }) {
  const subjects = student.unofficial ?? [];
  return (
    <div style={{ width, background: "#fff", border: `1px dashed ${H.pink}`, borderRadius: 6, boxShadow: "0 6px 26px rgba(31,42,49,.16)", padding: "20px 22px", position: "relative", fontFamily: BARLOW_STACK, color: INK }}>
      <div style={{ position: "absolute", top: 10, right: 12, fontSize: 9, fontWeight: 800, letterSpacing: 1, color: H.pink, border: `1px dashed ${H.pink}`, borderRadius: 4, padding: "2px 6px" }}>UNOFFICIAL</div>
      <div style={{ fontWeight: 800, color: H.pink, fontSize: 14 }}>Diagnostic Breakdown</div>
      <div style={{ fontWeight: 700, fontSize: 16, marginTop: 5 }}>
        {student.name.trim() ? <span style={{ background: "rgba(193,44,104,.10)", borderRadius: 3, padding: "0 .15em" }}>{student.name}</span> : <Merge value="" blankLabel="⟨ name blank ⟩" />}
      </div>
      <div className="hf-sub" style={{ fontSize: 10.5, marginTop: 5 }}>Levels at major-element and sub-element granularity · internal / learner use only</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {subjects.map((s) => (
          <div key={s.slot}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, borderBottom: `1px solid ${H.line2}`, paddingBottom: 3 }}>
              <span style={{ flex: 1 }}>{s.assessment}</span>
              <span className="hf-mono" style={{ color: H.pink, letterSpacing: 1 }}>{s.stars || "·"}</span>
            </div>
            {s.elements.map((el) => (
              <div key={el.major} style={{ marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, paddingLeft: 6 }}>
                  <span style={{ flex: 1, color: H.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={el.major}>{el.major}</span>
                  <span className="hf-mono" style={{ color: H.pink, letterSpacing: 1 }}>{el.stars || "·"}</span>
                </div>
                {el.subs.map((su) => (
                  <div key={su.sub} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, paddingLeft: 16, color: H.ink3 }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={su.sub}>{su.sub}</span>
                    <span className="hf-mono" style={{ letterSpacing: 1 }}>{su.stars || "·"}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        {subjects.length === 0 && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: H.warn, fontWeight: 700 }}>
            <Mark kind="warn" size={13} /> No element breakdown data for this student.
          </div>
        )}
      </div>
    </div>
  );
}

// ── issue badges ────────────────────────────────────────────────────────────
function IssueRow({ issues }: { issues: Issue[] }) {
  if (issues.length === 0)
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: H.good, fontWeight: 700 }}>
        <Mark kind="pass" size={14} /> No issues detected
      </span>
    );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
      {issues.map((iss, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, color: iss.sev === "error" ? H.bad : H.warn, background: iss.sev === "error" ? H.badSoft : H.warnSoft }}>
          <Mark kind={iss.sev === "error" ? "fail" : "warn"} size={12} /> {iss.label}
        </span>
      ))}
    </div>
  );
}

// ── batch preview (per-student pager over the whole cohort) ──────────────────
export function BatchPreview({ students, settings, kinds, onClose }: {
  students: StudentSummary[];
  settings: DocSettings;
  kinds: DocKind[];
  onClose: () => void;
}) {
  const { map: overflowMap, layer } = useOverflowMap(students);
  const [idx, setIdx] = useState(0);
  const [search, setSearch] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const issuesById = useMemo(() => {
    const m: Record<string, Issue[]> = {};
    for (const s of students) m[s.participantId] = studentIssues(s, kinds, overflowMap[s.participantId]);
    return m;
  }, [students, kinds, overflowMap]);

  const flaggedCount = useMemo(
    () => students.filter((s) => issuesById[s.participantId]?.length).length,
    [students, issuesById],
  );

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => (!q || `${s.name} ${s.participantId}`.toLowerCase().includes(q)))
      .filter(({ s }) => (!onlyFlagged || issuesById[s.participantId]?.length));
  }, [students, search, onlyFlagged, issuesById]);

  const safeIdx = Math.min(idx, students.length - 1);
  const current = students[safeIdx];
  const currentIssues = current ? issuesById[current.participantId] ?? [] : [];

  const go = (d: number) => setIdx((p) => Math.max(0, Math.min(students.length - 1, p + d)));
  const nextFlagged = () => {
    for (let k = 1; k <= students.length; k++) {
      const j = (safeIdx + k) % students.length;
      const s = students[j];
      if (s && issuesById[s.participantId]?.length) {
        setIdx(j);
        return;
      }
    }
  };

  // a scale that fits the proof within the available column
  const certScale = kinds.includes("report") ? 0.46 : 0.6;
  const reportScale = 0.42;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(31,42,49,.55)", zIndex: 200, display: "flex", flexDirection: "column" }} onKeyDown={(e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    }} tabIndex={-1}>
      {layer}
      <div style={{ background: H.paper, margin: "auto", width: "min(1180px, 96vw)", height: "min(92vh, 920px)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,.4)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: `1px solid ${H.line}`, background: H.paper }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Verify documents before generating</div>
            <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 2 }}>
              Content &amp; layout preview — not a print-exact proof. {students.length} students · {kinds.join(" + ")}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: flaggedCount ? H.warn : H.good, background: flaggedCount ? H.warnSoft : H.goodSoft, padding: "6px 12px", borderRadius: 999 }}>
            <Mark kind={flaggedCount ? "warn" : "pass"} size={14} />
            {flaggedCount ? `${flaggedCount} of ${students.length} flagged` : "No issues detected"}
          </span>
          {flaggedCount > 0 && <Button variant="ghost" onClick={nextFlagged}>Next flagged<Icon name="arrow" /></Button>}
          <Button variant="ghost" onClick={onClose}><Icon name="x" />Close</Button>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* roster */}
          <div style={{ width: 246, flex: "0 0 auto", borderRight: `1px solid ${H.line}`, display: "flex", flexDirection: "column", background: H.canvas }}>
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, borderBottom: `1px solid ${H.line}` }}>
              <label className="hf-field" style={{ width: "100%" }}>
                <Icon name="search" color={H.ink3} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or ID" style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: H.ink2, cursor: "pointer" }}>
                <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
                Only flagged ({flaggedCount})
              </label>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {list.map(({ s, i }) => {
                const sev = worstSev(issuesById[s.participantId] ?? []);
                const on = i === safeIdx;
                return (
                  <button key={s.participantId} onClick={() => setIdx(i)} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "none", borderLeft: `3px solid ${on ? H.pink : "transparent"}`, background: on ? H.pinkSoft2 : "transparent", cursor: "pointer" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, flex: "0 0 auto", background: sev === "error" ? H.bad : sev === "warn" ? H.warn : H.good }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: on ? 700 : 600, color: H.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name || "⟨ no name ⟩"}</span>
                      <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink3 }}>{s.participantId}</span>
                    </span>
                  </button>
                );
              })}
              {list.length === 0 && <div className="hf-sub" style={{ padding: 16, fontSize: 12 }}>No students match.</div>}
            </div>
          </div>

          {/* stage */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {/* pager */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderBottom: `1px solid ${H.line}`, background: H.paper }}>
              <Button variant="ghost" onClick={() => go(-1)} disabled={safeIdx === 0}><Icon name="chev" />Prev</Button>
              <div style={{ textAlign: "center", minWidth: 150 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{current?.name || "⟨ no name ⟩"}</div>
                <div className="hf-mono" style={{ fontSize: 11, color: H.ink3 }}>{current?.participantId} · {safeIdx + 1} of {students.length}</div>
              </div>
              <Button variant="ghost" onClick={() => go(1)} disabled={safeIdx === students.length - 1}>Next<Icon name="chev" /></Button>
              <div style={{ flex: 1 }} />
              <div style={{ maxWidth: "55%" }}><IssueRow issues={currentIssues} /></div>
            </div>

            {/* proofs */}
            <div style={{ flex: 1, overflow: "auto", background: H.tint, padding: 22 }}>
              {current && (
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center", alignItems: "flex-start" }}>
                  {kinds.includes("certificate") && (
                    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                      <CertificateProof student={current} settings={settings} scale={certScale} overflow={overflowMap[current.participantId]?.cert} />
                      <figcaption className="hf-lbl" style={{ fontSize: 10.5 }}>Certificate</figcaption>
                    </figure>
                  )}
                  {kinds.includes("report") && (
                    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                      <ReportProof student={current} settings={settings} scale={reportScale} overflow={overflowMap[current.participantId]?.report} />
                      <figcaption className="hf-lbl" style={{ fontSize: 10.5 }}>Performance report</figcaption>
                    </figure>
                  )}
                  {kinds.includes("unofficial") && (
                    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                      <UnofficialProof student={current} width={460} />
                      <figcaption className="hf-lbl" style={{ fontSize: 10.5 }}>Unofficial diagnostic report</figcaption>
                    </figure>
                  )}
                </div>
              )}
            </div>

            {/* fidelity note */}
            <div style={{ padding: "9px 18px", borderTop: `1px solid ${H.line}`, background: H.paper, display: "flex", gap: 9, alignItems: "flex-start" }}>
              <Mark kind="warn" size={14} />
              <span className="hf-sub" style={{ fontSize: 11 }}>
                Highlighted text is merged from the locked grades — the exact content that lands in the file. Layout is a faithful HTML/CSS approximation for spotting overflow, not a pixel proof. Report text uses <strong>Barlow</strong> (loaded), so report overflow is accurate; the certificate name uses a <strong>fallback for Georgia Pro Condensed</strong> (proprietary), so certificate-name overflow is approximate.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
