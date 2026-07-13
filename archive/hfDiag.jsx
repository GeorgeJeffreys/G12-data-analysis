// hfDiag.jsx — Diagnostics: exam-quality insight from response-time data (review only)
// Lives in the existing Analytics section as a third tab. Two metric families, each at
// assessment level AND major-element level. Tables are primary; charts only support.
// Status badges reuse the item-quality semantics: Good / Review / Flag.

const DIAG_SUBNAV = [
  { label: 'Trends', on: false },
  { label: 'Compare cycles', on: false },
  { label: 'Diagnostics', on: true },
];

function DiagStatus({ s }) {
  const map = { Good: 'good', Review: 'warn', Flag: 'bad' };
  return <HBadge tone={map[s]}>{s === 'Good' ? <HMark kind="pass" size={11} /> : s === 'Review' ? <HMark kind="warn" size={11} /> : <HMark kind="fail" size={11} />}{s}</HBadge>;
}

// little horizontal meter for a 0–100 rate
function RateBar({ v, tone, w = 64 }) {
  const c = tone === 'bad' ? H.bad : tone === 'warn' ? H.warn : tone === 'good' ? H.good : H.bar;
  return <div className="hf-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
    <div style={{ width: w, height: 6, background: H.tint2, borderRadius: 5, flex: '0 0 auto' }}><div style={{ width: `${v}%`, height: '100%', background: c, borderRadius: 5 }} /></div>
    <span className="hf-mono" style={{ fontSize: 12.5, width: 42, textAlign: 'right' }}>{v}%</span>
  </div>;
}

// ── data ──────────────────────────────────────────────────────────
// Family A — speededness / omission / completion
const SPEED = {
  whole: { el: 'Whole assessment', sp: 0.07, om: 3.1, comp: 96.8, status: 'Good' },
  els: [
    { el: 'Number', sp: 0.04, om: 1.8, comp: 98.4, status: 'Good' },
    { el: 'Algebra', sp: 0.09, om: 3.6, comp: 96.1, status: 'Good' },
    { el: 'Geometry', sp: 0.12, om: 5.2, comp: 93.7, status: 'Review' },
    { el: 'Statistics', sp: 0.21, om: 9.4, comp: 88.2, status: 'Flag' },
    { el: 'Measure', sp: 0.06, om: 2.4, comp: 97.5, status: 'Good' },
  ],
};
// Family B — timing / performance
const TIMING = {
  whole: { el: 'Whole assessment', medRt: '01:04', meanRt: '01:11', meanSc: 61.4, medSc: 62, r: -0.18, strength: 'Weak negative' },
  els: [
    { el: 'Number', medRt: '00:48', meanRt: '00:52', meanSc: 68.2, medSc: 70, r: -0.09, strength: 'Negligible' },
    { el: 'Algebra', medRt: '01:02', meanRt: '01:08', meanSc: 60.1, medSc: 61, r: -0.21, strength: 'Weak negative' },
    { el: 'Geometry', medRt: '01:19', meanRt: '01:27', meanSc: 55.4, medSc: 56, r: -0.34, strength: 'Moderate negative' },
    { el: 'Statistics', medRt: '01:36', meanRt: '01:49', meanSc: 49.8, medSc: 50, r: -0.46, strength: 'Moderate negative' },
    { el: 'Measure', medRt: '00:55', meanRt: '00:59', meanSc: 63.0, medSc: 64, r: -0.12, strength: 'Negligible' },
  ],
};

function rTone(r) { const a = Math.abs(r); return a >= 0.4 ? 'bad' : a >= 0.2 ? 'warn' : 'neutral'; }

function SectionHead({ children }) {
  return <tr><td colSpan={9} style={{ padding: '8px 12px', background: H.tint, borderBottom: `1px solid ${H.line2}`, borderTop: `1px solid ${H.line2}` }}><span className="hf-lbl">{children}</span></td></tr>;
}

function HFDiagnostics() {
  const Hc = (t, sub, hint) => <th className="hf-th" style={{ textAlign: 'right' }} title={hint}>{t}{sub && <div style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: H.ink3, fontSize: 9 }}>{sub}</div>}</th>;

  const speedRow = (r, whole) => {
    const omTone = r.om >= 8 ? 'bad' : r.om >= 5 ? 'warn' : 'good';
    const compTone = r.comp < 90 ? 'bad' : r.comp < 95 ? 'warn' : 'good';
    return (
      <tr key={r.el} className={whole ? '' : 'hf-hover'} style={{ background: whole ? H.canvas : 'transparent' }}>
        <td className="hf-td" style={{ fontWeight: whole ? 700 : 600, fontSize: 12.5, paddingLeft: whole ? 12 : 26 }}>{r.el}</td>
        <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 13 }}>{r.sp.toFixed(2)}</td>
        <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 13, color: omTone === 'bad' ? H.bad : omTone === 'warn' ? H.warn : H.ink }}>{r.om.toFixed(1)}%</td>
        <td className="hf-td" style={{ textAlign: 'right' }}><RateBar v={r.comp} tone={compTone} /></td>
        <td className="hf-td" style={{ textAlign: 'right' }}><DiagStatus s={r.status} /></td>
      </tr>
    );
  };
  const timeRow = (r, whole) => (
    <tr key={r.el} className={whole ? '' : 'hf-hover'} style={{ background: whole ? H.canvas : 'transparent' }}>
      <td className="hf-td" style={{ fontWeight: whole ? 700 : 600, fontSize: 12.5, paddingLeft: whole ? 12 : 26 }}>{r.el}</td>
      <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 13 }}>{r.medRt}</td>
      <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 13 }}>{r.meanRt}</td>
      <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 13 }}>{r.meanSc.toFixed(1)}%</td>
      <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 13 }}>{r.medSc}</td>
      <td className="hf-td" style={{ textAlign: 'right' }}>
        <div className="hf-row" style={{ gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <div style={{ width: 50, height: 6, background: H.tint2, borderRadius: 5, position: 'relative', flex: '0 0 auto' }}>
            <div style={{ position: 'absolute', left: '50%', top: -2, width: 1, height: 10, background: H.line2 }} />
            <div style={{ position: 'absolute', right: '50%', width: `${Math.abs(r.r) * 100}%`, height: '100%', background: rTone(r.r) === 'bad' ? H.bad : rTone(r.r) === 'warn' ? H.warn : H.bar, borderRadius: 5 }} />
          </div>
          <span className="hf-mono" style={{ fontSize: 12.5, width: 38, textAlign: 'right', color: rTone(r.r) === 'bad' ? H.bad : rTone(r.r) === 'warn' ? H.warn : H.ink }}>{r.r.toFixed(2)}</span>
        </div>
      </td>
      <td className="hf-td" style={{ fontSize: 11.5, color: H.ink2, fontWeight: 600 }}>{r.strength}</td>
    </tr>
  );

  return (
    <HShell active="Analytics" subnav={DIAG_SUBNAV}
      crumb="Analytics  ›  Diagnostics"
      actions={<><HChip on>May 2026<HIco name="chev" /></HChip><HBtn variant="ghost"><HIco name="download" />Export</HBtn></>}>
      <div className="hf-col" style={{ padding: '24px 30px', gap: 18, flex: 1, overflow: 'auto' }}>
        <div className="hf-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
          <div style={{ minWidth: 0 }}>
            <div className="hf-row" style={{ gap: 11, alignItems: 'center' }}>
              <div className="hf-h1">Diagnostics</div>
              <HBadge tone="neutral"><HIco name="eye" size={11} color={H.ink2} />Review only · not a grading step</HBadge>
            </div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 700 }}>Exam-quality measures the app computes from raw response-time data. Use them to spot speededness or weak items for the next sitting — they never change a student's mark or grade.</div>
          </div>
        </div>

        {/* assessment selector — one row, applies to both tables */}
        <div className="hf-row" style={{ gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="hf-lbl" style={{ marginRight: 2 }}>Assessment</span>
          <HChip on>Applicable Math<HIco name="chev" /></HChip>
          <HChip>English 2nd Lang</HChip>
          <HChip>Scientific Thinking</HChip>
          <HChip>Arabic 1st Lang <span className="hf-mono" style={{ fontSize: 9, marginLeft: 2, opacity: .7 }}>RTL</span></HChip>
          <div style={{ flex: 1 }} />
          <span className="hf-sub" style={{ fontSize: 11.5 }}>4,812 candidates · 48 items · computed 15 May 2026</span>
        </div>

        {/* Family A */}
        <div className="hf-card" style={{ overflow: 'hidden' }}>
          <div className="hf-row" style={{ padding: '14px 18px', borderBottom: `1px solid ${H.line2}`, background: H.paper, gap: 12 }}>
            <div style={{ flex: 1 }}>
              <span className="hf-h2">Speededness, omission & completion</span>
              <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>Whether students had enough time to attempt the questions.</div>
            </div>
            <span className="hf-row" style={{ gap: 12 }}>
              {['Good', 'Review', 'Flag'].map(s => <DiagStatus key={s} s={s} />)}
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="hf-th">Element</th>
              {Hc('Speededness index', '0–1, lower is better', 'share of candidates who ran out of time')}
              {Hc('Omission rate', '% left blank', 'questions reached but not answered')}
              {Hc('Completion rate', '% reaching the end')}
              <th className="hf-th" style={{ textAlign: 'right' }}>Status</th>
            </tr></thead>
            <tbody>
              {speedRow(SPEED.whole, true)}
              <SectionHead>Major curriculum elements</SectionHead>
              {SPEED.els.map(r => speedRow(r, false))}
            </tbody>
          </table>
        </div>

        {/* Family B */}
        <div className="hf-card" style={{ overflow: 'hidden' }}>
          <div className="hf-row" style={{ padding: '14px 18px', borderBottom: `1px solid ${H.line2}`, background: H.paper, gap: 12 }}>
            <div style={{ flex: 1 }}>
              <span className="hf-h2">Timing & performance</span>
              <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 3 }}>How long questions took, and whether time spent relates to how well students scored.</div>
            </div>
            <span className="hf-sub" style={{ fontSize: 11 }}>Response time as <span className="hf-mono">mm:ss</span> per item</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="hf-th">Element</th>
              {Hc('Median RT', 'per item')}
              {Hc('Mean RT', 'per item')}
              {Hc('Mean score', null)}
              {Hc('Median score', null)}
              {Hc('Time ↔ score', 'correlation r', 'correlation between time spent and score')}
              <th className="hf-th">Strength</th>
            </tr></thead>
            <tbody>
              {timeRow(TIMING.whole, true)}
              <SectionHead>Major curriculum elements</SectionHead>
              {TIMING.els.map(r => timeRow(r, false))}
            </tbody>
          </table>
          <div className="hf-row" style={{ padding: '12px 18px', gap: 9, alignItems: 'center', background: H.canvas, borderTop: `1px solid ${H.line}` }}>
            <HIco name="eye" size={13} color={H.ink3} />
            <span className="hf-sub" style={{ fontSize: 11.5 }}>A stronger negative correlation means slower responses tended to score lower — usually a sign the element was demanding, not a data fault. <b style={{ color: H.ink }}>Statistics</b> shows both the highest omission and the strongest negative timing link — worth a look before the next sitting.</span>
          </div>
        </div>
      </div>
    </HShell>
  );
}

Object.assign(window, { HFDiagnostics, DIAG_SUBNAV });
