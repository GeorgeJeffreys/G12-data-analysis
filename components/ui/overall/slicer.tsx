"use client";

/**
 * The Overall slicer (four checkbox dropdowns) + the stacked collapsible
 * accordion, ported from design/hfOverallFinal.jsx to TSX. The checkbox slice
 * (FinalSlice) is adapted, via `finalToLegacy`, into the LegacySlice the sections
 * consume. Totals (years / centres / subjects) come from the read-model, so the
 * menus and summaries reflect real data — future years appear disabled.
 */
import { Fragment, useState, type ReactNode } from "react";
import { H } from "@/lib/ui/tokens";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import type { OverallAnalytics } from "@/lib/data/types";
import { OVSpark, OVYearTrack, type CentreSel, type LegacySlice } from "./kit";
import { OV_SECTIONS, type Headline } from "./sections";

// ── the multi-select slice model (checkbox semantics) ────────────────────────
export interface FinalSlice {
  years: number[];
  exams: string[];
  centres: string[];
  subjects: string[];
}
export const EXAM_OPTIONS: [string, string][] = [
  ["February", "sitting one"],
  ["May", "sitting two"],
  ["Combined", "best-of-two award"],
];

/** The default slice: all live years, Combined, all centres, all subjects. */
export function defaultFinalSlice(a: OverallAnalytics): FinalSlice {
  return { years: [...a.years], exams: ["Combined"], centres: [...a.centres], subjects: a.subjects.map((s) => s.key) };
}

/** Reconcile a persisted slice with the current read-model (drop stale ids;
 *  guarantee ≥1 selection per dimension) so a stale localStorage never breaks. */
export function sanitizeSlice(raw: unknown, a: OverallAnalytics): FinalSlice {
  const def = defaultFinalSlice(a);
  if (!raw || typeof raw !== "object") return def;
  const r = raw as Partial<FinalSlice>;
  const years = Array.isArray(r.years) ? r.years.filter((y) => a.years.includes(y)) : [];
  const centres = Array.isArray(r.centres) ? r.centres.filter((c) => a.centres.includes(c)) : [];
  const subjectKeys = a.subjects.map((s) => s.key);
  const subjects = Array.isArray(r.subjects) ? r.subjects.filter((s) => subjectKeys.includes(s)) : [];
  const exams = Array.isArray(r.exams) ? r.exams.filter((e) => ["February", "May", "Combined"].includes(e)) : [];
  return {
    years: years.length ? [...years].sort((x, y) => x - y) : def.years,
    // Exam is single-select: keep exactly one lens.
    exams: exams.length ? [exams[0]!] : def.exams,
    centres: centres.length ? centres : def.centres,
    subjects: subjects.length ? subjects : def.subjects,
  };
}

// ── summaries ────────────────────────────────────────────────────────────────
export const yearsSummary = (y: number[]): string => (y.length === 0 ? "—" : y.length >= 2 ? `${Math.min(...y)}–${Math.max(...y)}` : String(y[0]));
export const examsSummary = (e: string[]): string => (e.length >= 3 ? "All sittings" : e.join(" + "));
export const centresSummary = (c: string[], total: number): string => (c.length >= total ? `All ${total}` : c.length === 1 ? c[0]! : `${c.length} centres`);
export function subjectsSummary(s: string[], subjects: OverallAnalytics["subjects"]): string {
  if (s.length >= subjects.length) return "All";
  if (s.length === 1) return subjects.find((x) => x.key === s[0])?.short ?? "1 subject";
  return `${s.length} subjects`;
}

/** Adapt the checkbox slice into the shape the four sections consume. Exam is a
 *  single-select (one of the three mutually-exclusive lenses); the full subject
 *  multi-select flows through as `subjects`, so the sections honour every
 *  dimension rather than collapsing to a single value. */
export function finalToLegacy(s: FinalSlice, a: OverallAnalytics): LegacySlice {
  const exam = s.exams[0] || "Combined";
  const years = [...s.years].sort((x, y) => x - y);
  const latest = a.years[a.years.length - 1] ?? 0;
  const year: number | "trend" = years.length >= 2 ? "trend" : years[0] ?? latest;
  const centre: CentreSel =
    s.centres.length >= a.centres.length
      ? { mode: "all", sel: [] }
      : s.centres.length === 1
        ? { mode: "single", sel: [...s.centres] }
        : { mode: "subset", sel: [...s.centres] };
  const subjects = s.subjects.length ? [...s.subjects] : a.subjects.map((x) => x.key);
  const subject = subjects.length === 1 ? subjects[0]! : null;
  return { exam, year, centre, subjects, subject, years };
}

/** min-1 multi-select toggle. */
export function flip<T>(arr: T[], v: T, min = 1): T[] {
  return arr.includes(v) ? (arr.length > min ? arr.filter((x) => x !== v) : arr) : [...arr, v];
}

// ── one dropdown menu (button + checkbox popover) ────────────────────────────
function OVCheckDropdown({
  label,
  summary,
  count,
  total,
  open,
  onToggle,
  children,
  width = 236,
  primary,
}: {
  label: string;
  summary: string;
  count?: number;
  total?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  width?: number;
  primary?: boolean;
}) {
  return (
    <div className="hf-col" style={{ gap: 5, position: "relative" }}>
      <span className="hf-lbl" style={{ color: primary ? H.pink : H.ink3 }}>
        {label}
        {primary && <span style={{ color: H.ink3, fontWeight: 600 }}> · primary</span>}
      </span>
      <div
        className="hf-field"
        onClick={onToggle}
        style={{ padding: "7px 11px", cursor: "pointer", minWidth: 150, borderColor: open ? H.pink : H.line2, boxShadow: open ? `0 0 0 3px ${H.pinkSoft}` : "none", transition: ".12s" }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: H.ink, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>
        {total != null && count != null && count < total && <span className="hf-mono" style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: H.pink, borderRadius: 999, padding: "1px 6px" }}>{count}</span>}
        <span style={{ transform: open ? "rotate(180deg)" : "none", transition: ".15s" }}><Icon name="chev" size={13} color={H.ink3} /></span>
      </div>
      {open && (
        <div className="hf-card" style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, width, padding: 8, zIndex: 60, boxShadow: "0 14px 38px rgba(44,55,57,.18)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function OVCheckRow({ on, label, hint, disabled, onClick }: { on: boolean; label: string; hint?: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <div
      className="hf-row"
      onClick={disabled ? undefined : onClick}
      style={{ gap: 10, padding: "7px 8px", borderRadius: 7, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1 }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = H.tint;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <OVCheck on={on} />
      <span style={{ fontSize: 12.5, color: H.ink, flex: 1 }}>{label}</span>
      {hint && <span className="hf-mono" style={{ fontSize: 9.5, color: H.ink3 }}>{hint}</span>}
    </div>
  );
}

/** Small non-interactive checkbox glyph (the row handles clicks). */
function OVCheck({ on }: { on: boolean }) {
  return (
    <span style={{ width: 18, height: 18, borderRadius: 5, flex: "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center", border: `1.5px solid ${on ? H.pink : H.line2}`, background: on ? H.pink : H.paper }}>
      {on && (
        <svg width="11" height="11" viewBox="0 0 12 12">
          <path d="M2.5 6.2l2.2 2.2L9.5 3.5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function OVMenuFooter({ onAll, onClear, allLabel = "Select all" }: { onAll: () => void; onClear: () => void; allLabel?: string }) {
  return (
    <div className="hf-row" style={{ gap: 8, marginTop: 6, paddingTop: 8, borderTop: `1px solid ${H.line}` }}>
      <span onClick={onAll} style={{ fontSize: 11, fontWeight: 700, color: H.pink, cursor: "pointer", padding: "3px 6px" }}>{allLabel}</span>
      <span onClick={onClear} style={{ fontSize: 11, fontWeight: 600, color: H.ink3, cursor: "pointer", padding: "3px 6px" }}>Clear</span>
    </div>
  );
}

// ── the slicer bar — four checkbox dropdowns ─────────────────────────────────
export function OVSlicerDropdowns({
  slice,
  setSlice,
  analytics,
  futureYears,
}: {
  slice: FinalSlice;
  setSlice: (s: FinalSlice) => void;
  analytics: OverallAnalytics;
  futureYears: number[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const set = (patch: Partial<FinalSlice>) => setSlice({ ...slice, ...patch });
  const toggle = (dim: string) => setOpen(open === dim ? null : dim);
  const years = analytics.years;
  const centres = analytics.centres;
  const subjects = analytics.subjects;
  const lastYear = years[years.length - 1];

  return (
    <div className="hf-card" style={{ padding: "13px 18px", position: "relative", zIndex: 30 }}>
      {open && <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(null)} />}
      <div className="hf-row" style={{ gap: 16, flexWrap: "wrap", position: "relative", zIndex: 50 }}>
        {/* TIME */}
        <OVCheckDropdown label="Time" primary summary={yearsSummary(slice.years)} count={slice.years.length} total={years.length} open={open === "years"} onToggle={() => toggle("years")} width={220}>
          {years.map((y) => (
            <OVCheckRow key={y} on={slice.years.includes(y)} label={String(y)} hint="live" onClick={() => set({ years: flip(slice.years, y).sort((a, b) => a - b) })} />
          ))}
          {futureYears.length > 0 && <div style={{ height: 1, background: H.line, margin: "4px 8px" }} />}
          {futureYears.map((y) => (
            <OVCheckRow key={y} on={false} disabled label={String(y)} hint="no data yet" />
          ))}
          <OVMenuFooter onAll={() => set({ years: [...years] })} onClear={() => set({ years: lastYear != null ? [lastYear] : [...years] })} allLabel="All live years" />
        </OVCheckDropdown>
        {/* live-years track — reinforces the trend framing */}
        {slice.years.length >= 2 && (
          <div style={{ paddingTop: 20 }}>
            <OVYearTrack years={[...slice.years].sort((a, b) => a - b)} ghost={futureYears.slice(0, 3)} />
          </div>
        )}

        <div style={{ width: 1, alignSelf: "stretch", background: H.line2 }} />

        {/* EXAM TYPE — single-select (three mutually-exclusive lenses) */}
        <OVCheckDropdown label="Exam type" summary={examsSummary(slice.exams)} open={open === "exams"} onToggle={() => toggle("exams")} width={230}>
          {EXAM_OPTIONS.map(([e, hint]) => (
            <OVCheckRow key={e} on={slice.exams[0] === e} label={e} hint={hint} onClick={() => set({ exams: [e] })} />
          ))}
        </OVCheckDropdown>

        <div style={{ width: 1, alignSelf: "stretch", background: H.line2 }} />

        {/* PARTNER CENTRE */}
        <OVCheckDropdown label="Partner centre" summary={centresSummary(slice.centres, centres.length)} count={slice.centres.length} total={centres.length} open={open === "centres"} onToggle={() => toggle("centres")} width={236}>
          {centres.map((c) => (
            <OVCheckRow key={c} on={slice.centres.includes(c)} label={c} onClick={() => set({ centres: flip(slice.centres, c) })} />
          ))}
          <OVMenuFooter onAll={() => set({ centres: [...centres] })} onClear={() => set({ centres: centres[0] != null ? [centres[0]] : [...centres] })} />
        </OVCheckDropdown>

        <div style={{ width: 1, alignSelf: "stretch", background: H.line2 }} />

        {/* SUBJECT */}
        <OVCheckDropdown label="Subject" summary={subjectsSummary(slice.subjects, subjects)} count={slice.subjects.length} total={subjects.length} open={open === "subjects"} onToggle={() => toggle("subjects")} width={230}>
          {subjects.map((s) => (
            <OVCheckRow key={s.key} on={slice.subjects.includes(s.key)} label={s.name} onClick={() => set({ subjects: flip(slice.subjects, s.key) })} />
          ))}
          <OVMenuFooter onAll={() => set({ subjects: subjects.map((s) => s.key) })} onClear={() => set({ subjects: subjects[0] != null ? [subjects[0].key] : subjects.map((s) => s.key) })} />
        </OVCheckDropdown>

        <div style={{ flex: 1 }} />
        <div className="hf-col" style={{ gap: 5, alignItems: "flex-end" }}>
          <span className="hf-lbl" style={{ fontSize: 9 }}>&nbsp;</span>
          <Button variant="ghost" onClick={() => setSlice(defaultFinalSlice(analytics))}>
            <Icon name="filter" size={13} />Reset
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── active-slice readout (always legible) ────────────────────────────────────
export function OVActiveSlice({ slice, analytics }: { slice: FinalSlice; analytics: OverallAnalytics }) {
  const toks: [string, string][] = [
    ["Time", yearsSummary(slice.years) + (slice.years.length >= 2 ? " · trend" : "")],
    ["Exam", examsSummary(slice.exams)],
    ["Centre", centresSummary(slice.centres, analytics.centres.length)],
    ["Subject", subjectsSummary(slice.subjects, analytics.subjects)],
  ];
  return (
    <div className="hf-row" style={{ gap: 9, flexWrap: "wrap", alignItems: "center" }}>
      <span className="hf-lbl" style={{ color: H.ink3 }}>Now viewing</span>
      {toks.map(([k, v], i) => (
        <Fragment key={k}>
          {i > 0 && <span style={{ color: H.line2 }}>·</span>}
          <span className="hf-row" style={{ gap: 5, fontSize: 12.5 }}>
            <span className="hf-lbl" style={{ fontSize: 8.5, color: H.ink3 }}>{k}</span>
            <span style={{ fontWeight: 600, color: H.ink }}>{v}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

// ── collapsed headline ───────────────────────────────────────────────────────
function OVHeadline({ h }: { h: Headline }) {
  const good = h.good ?? h.deltaGood ?? true;
  return (
    <div className="hf-row" style={{ gap: 14, alignItems: "center" }}>
      <div className="hf-col" style={{ alignItems: "flex-end", gap: 1 }}>
        <span className="hf-mono" style={{ fontSize: 20, fontWeight: 600, color: h.disabled ? H.ink3 : h.good ? H.good : H.ink, lineHeight: 1 }}>{h.value}</span>
        <span className="hf-lbl" style={{ fontSize: 8 }}>{h.label}</span>
      </div>
      {h.spark && !h.disabled && <OVSpark pts={h.spark} w={70} h={26} color={h.good ? H.good : H.pink} />}
      {h.delta != null && <span className="hf-mono" style={{ fontSize: 11.5, fontWeight: 700, color: good ? H.good : H.bad }}>{h.delta}</span>}
    </div>
  );
}

// ── the accordion (stacked collapsible cards) ────────────────────────────────
export function OVAccordion({ analytics, slice }: { analytics: OverallAnalytics; slice: LegacySlice }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ part: true, perf: false, award: false, centre: false });
  return (
    <div className="hf-col" style={{ gap: 12 }}>
      {OV_SECTIONS.map((sec) => {
        const isOpen = !!open[sec.id];
        const h = sec.headline(analytics, slice);
        const Body = sec.Body;
        return (
          <div key={sec.id} className="hf-card" style={{ overflow: "visible" }} data-screen-label={`Section ${sec.n}`}>
            <div
              className="hf-row"
              style={{ gap: 16, padding: "15px 20px", cursor: "pointer", background: isOpen ? H.tint : H.paper, borderRadius: isOpen ? "12px 12px 0 0" : 12 }}
              onClick={() => setOpen({ ...open, [sec.id]: !isOpen })}
            >
              <span className="hf-mono" style={{ fontSize: 12, fontWeight: 700, color: H.pink, flex: "0 0 auto" }}>{sec.n}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="hf-lbl" style={{ color: H.ink3 }}>{sec.kpi.split(" · ")[0]}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: H.ink, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sec.q}</div>
              </div>
              {!isOpen && (
                <div style={{ flex: "0 0 auto" }}>
                  <OVHeadline h={h} />
                </div>
              )}
              <span style={{ flex: "0 0 auto", transform: isOpen ? "rotate(180deg)" : "none", transition: ".15s" }}>
                <Icon name="chev" size={16} color={H.ink2} />
              </span>
            </div>
            {isOpen && (
              <div style={{ padding: "20px 22px", borderTop: `1px solid ${H.line}` }}>
                <Body analytics={analytics} slice={slice} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
