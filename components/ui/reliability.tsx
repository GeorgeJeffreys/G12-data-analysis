"use client";

/**
 * Read-only Cronbach's-α (reliability) surfaces, shared by the Review tab and
 * Diagnostics. Every α is shown with its item count (k) and participant count (n)
 * and an instability caution where k or n is small; α is never shown as a bare
 * authoritative number. Undefined α (k<2 etc.) renders as "n/a — …"; negative α
 * is shown as-is.
 */
import type { ReactNode } from "react";
import { H } from "@/lib/ui/tokens";
import type { ReliabilityModel, ReliabilityRow } from "@/lib/data/types";

/** Colour for an α value band (neutral when n/a). */
function alphaColor(a: number | null): string {
  if (a === null) return H.ink3;
  if (a >= 0.7) return H.good;
  if (a >= 0.5) return H.warn;
  return H.bad; // includes negative
}

/** The α value (or its n/a note), coloured, with a fixed 3-dp format. */
export function AlphaValue({ row, size = 13 }: { row: ReliabilityRow; size?: number }) {
  if (row.alpha === null) {
    return <span className="hf-sub" style={{ fontSize: size - 1, color: H.ink3 }}>{row.note ?? "n/a"}</span>;
  }
  return (
    <span className="hf-mono" style={{ fontSize: size, fontWeight: 700, color: alphaColor(row.alpha) }}>
      {row.alpha.toFixed(3)}
    </span>
  );
}

/** k / n with a caution chip where the estimate is fragile. */
function KnCell({ row }: { row: ReliabilityRow }) {
  return (
    <span style={{ display: "inline-flex", gap: 7, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
      <span className="hf-mono" style={{ fontSize: 11.5, color: H.ink2 }} title="items in the group">
        k={row.k}
      </span>
      <span className="hf-mono" style={{ fontSize: 11.5, color: H.ink2 }} title="participants used (complete cases)">
        n={row.n}
      </span>
      {row.lowItems && row.alpha !== null && (
        <span title="Too few items — α is fragile here" style={{ fontSize: 9, fontWeight: 700, color: H.bad, background: H.badSoft, padding: "1px 5px", borderRadius: 4, letterSpacing: 0.3 }}>
          few items
        </span>
      )}
      {row.smallSample && !row.lowItems && row.alpha !== null && (
        <span title="Small cohort — α is unstable" style={{ fontSize: 9, fontWeight: 700, color: H.warn, background: H.warnSoft, padding: "1px 5px", borderRadius: 4, letterSpacing: 0.3 }}>
          small n
        </span>
      )}
    </span>
  );
}

function Row({ label, row }: { label: string; row: ReliabilityRow }) {
  return (
    <tr className="hf-hover">
      <td className="hf-td" style={{ fontSize: 12, maxWidth: 260, whiteSpace: "normal", lineHeight: 1.25, paddingLeft: 26 }}>{label}</td>
      <td className="hf-td" style={{ textAlign: "right" }}><AlphaValue row={row} /></td>
      <td className="hf-td" style={{ textAlign: "right" }}><KnCell row={row} /></td>
    </tr>
  );
}

function SectionHead({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={3} style={{ padding: "7px 12px", background: H.tint, borderTop: `1px solid ${H.line2}`, borderBottom: `1px solid ${H.line2}` }}>
        <span className="hf-lbl">{children}</span>
      </td>
    </tr>
  );
}

const demandOrder = (a: ReliabilityRow, b: ReliabilityRow) => a.label.localeCompare(b.label);

/**
 * Full reliability panel for ONE subject (assessmentId): subject α + the overall
 * exam α for reference, then α per major element, sub-element, demand level and
 * context (each section shown only when it has groups).
 */
export function ReliabilityPanel({ model, assessmentId }: { model: ReliabilityModel; assessmentId: string }) {
  const forSubject = (level: ReliabilityRow["level"]) =>
    model.rows.filter((r) => r.level === level && r.assessmentId === assessmentId);
  const subject = forSubject("subject")[0];
  const majors = forSubject("majorElement");
  const subs = forSubject("subElement");
  const demands = [...forSubject("demandLevel")].sort(demandOrder);
  const contexts = forSubject("context");

  return (
    <div className="hf-card" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${H.line2}`, gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <span className="hf-h2">Internal consistency — Cronbach&rsquo;s α</span>
          <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>
            How consistently the items in each group measure the same thing. Read with the item (k) and participant (n)
            counts — α is fragile at this cohort size.
          </div>
        </div>
        {subject && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <AlphaValue row={subject} size={22} />
            <span className="hf-sub" style={{ fontSize: 10.5 }}>this subject · k={subject.k} · n={subject.n}</span>
          </div>
        )}
      </div>

      {/* small-sample caution */}
      <div style={{ display: "flex", gap: 9, alignItems: "center", padding: "9px 18px", background: H.warnSoft, borderBottom: `1px solid ${H.warn}33` }}>
        <span style={{ fontSize: 11.5, color: H.ink }}>
          Reliability is unstable with only {model.participants} students; α over a handful of items (k &lt; {model.lowItemsThreshold})
          is essentially noise. Treat sub-element and demand α as indicative, not authoritative.
        </span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th className="hf-th">Group</th>
            <th className="hf-th" style={{ textAlign: "right", width: 90 }}>Cronbach&rsquo;s α</th>
            <th className="hf-th" style={{ textAlign: "right", width: 180 }}>items · participants</th>
          </tr>
        </thead>
        <tbody>
          {/* overall reference + subject */}
          <tr style={{ background: H.canvas }}>
            <td className="hf-td" style={{ fontWeight: 700, fontSize: 12.5, paddingLeft: 12 }}>Overall exam <span className="hf-sub" style={{ fontWeight: 500 }}>(all subjects)</span></td>
            <td className="hf-td" style={{ textAlign: "right" }}><AlphaValue row={model.overall} /></td>
            <td className="hf-td" style={{ textAlign: "right" }}><KnCell row={model.overall} /></td>
          </tr>
          {subject && (
            <tr style={{ background: H.canvas }}>
              <td className="hf-td" style={{ fontWeight: 700, fontSize: 12.5, paddingLeft: 12 }}>This subject</td>
              <td className="hf-td" style={{ textAlign: "right" }}><AlphaValue row={subject} /></td>
              <td className="hf-td" style={{ textAlign: "right" }}><KnCell row={subject} /></td>
            </tr>
          )}

          {majors.length > 0 && <SectionHead>By major element</SectionHead>}
          {majors.map((r) => <Row key={r.key} label={r.label} row={r} />)}

          {subs.length > 0 && <SectionHead>By sub-element</SectionHead>}
          {subs.map((r) => <Row key={r.key} label={r.label} row={r} />)}

          {demands.length > 0 && <SectionHead>By demand level</SectionHead>}
          {demands.map((r) => <Row key={r.key} label={r.label} row={r} />)}

          {contexts.length > 0 && <SectionHead>By context</SectionHead>}
          {contexts.map((r) => <Row key={r.key} label={r.label} row={r} />)}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Compact one-line α summary (subject α + overall), for tight spaces like the
 * Review screen's stats strip. Links the reader to the fuller panel.
 */
export function ReliabilityInline({ model, assessmentId }: { model: ReliabilityModel; assessmentId: string }) {
  const subject = model.rows.find((r) => r.level === "subject" && r.assessmentId === assessmentId);
  if (!subject) return null;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }} title={`Cronbach's α (internal consistency) — k=${subject.k} items, n=${subject.n} students`}>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>Reliability α</span>
      <AlphaValue row={subject} size={15} />
      <span className="hf-sub" style={{ fontSize: 10 }}>k={subject.k}·n={subject.n}{subject.lowItems || subject.smallSample ? " ⚠" : ""}</span>
    </span>
  );
}
