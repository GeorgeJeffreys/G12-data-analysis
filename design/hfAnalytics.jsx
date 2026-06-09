// hfAnalytics.jsx — Analytics area: Trends + Compare cycles

const AN_SUBNAV = (a) => [{ label: 'Trends', on: a === 't' }, { label: 'Compare cycles', on: a === 'c' }];
const CYCLE_LABELS = ['May 25', 'Nov 25', 'Jan 26', 'May 26'];
// grade ramp: pink for top grade, neutral ramp down
const GRADE_C = { A: H.pink, B: '#6b7780', C: '#9aa4ac', D: '#c2cad0', E: '#dfe4e9' };

function Spark({ pts, w = 116, h = 32, color = H.pink }) {
  const max = Math.max(...pts), min = Math.min(...pts);
  const nx = (i) => (i / (pts.length - 1)) * (w - 4) + 2;
  const ny = (v) => h - ((v - min) / ((max - min) || 1)) * (h - 6) - 3;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${nx(i).toFixed(1)} ${ny(v).toFixed(1)}`).join(' ');
  return <svg width={w} height={h} style={{ display: 'block' }}>
    <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={nx(pts.length - 1)} cy={ny(pts[pts.length - 1])} r="2.6" fill={color} />
  </svg>;
}

function StackCol({ dist, h = 150, w = 30 }) {
  return <div className="hf-col" style={{ width: w, height: h, borderRadius: 4, overflow: 'hidden', flex: '0 0 auto' }}>
    {['A', 'B', 'C', 'D', 'E'].map(g => <div key={g} style={{ height: `${dist[g]}%`, background: GRADE_C[g] }} title={`${g} ${dist[g]}%`} />)}
  </div>;
}

// ─── Trends ────────────────────────────────────────────────────────
function HFTrends() {
  const meanByAsm = [
    { n: 'Applicable Math', pts: [58.1, 59.4, 60.2, 61.4], now: '61.4%', d: '+1.2' },
    { n: 'English 2nd Lang', pts: [64.0, 63.2, 62.8, 63.5], now: '63.5%', d: '+0.7' },
    { n: 'Scientific Thinking', pts: [55.2, 57.0, 58.9, 57.6], now: '57.6%', d: '−1.3' },
    { n: 'Arabic 1st Lang', pts: [69.1, 68.4, 70.2, 71.0], now: '71.0%', d: '+0.8' },
    { n: 'Life Success Skills', pts: [72.0, 73.1, 72.4, 74.2], now: '74.2%', d: '+1.8' },
  ];
  const gradeOverTime = [
    { A: 11, B: 23, C: 33, D: 22, E: 11 }, { A: 12, B: 24, C: 32, D: 21, E: 11 },
    { A: 11, B: 25, C: 33, D: 19, E: 12 }, { A: 13, B: 24, C: 32, D: 20, E: 11 },
  ];
  return (
    <HShell active="Analytics" subnav={AN_SUBNAV('t')}
      crumb="Analytics  ›  Trends"
      actions={<><HChip on>All assessments<HIco name="chev" /></HChip><HBtn variant="ghost"><HIco name="download" />Export</HBtn></>}>
      <div className="hf-col" style={{ padding: '24px 30px', gap: 20, flex: 1, overflow: 'hidden' }}>
        <div><div className="hf-h1">Trends across cycles</div><div className="hf-sub" style={{ marginTop: 6 }}>How each assessment has behaved over the last four sittings (May 2025 → May 2026).</div></div>

        {/* KPI row */}
        <div className="hf-row" style={{ gap: 16 }}>
          {[
            { lbl: 'Participants', v: '4,812', d: '+311 vs last', pts: [4201, 4390, 4503, 4812] },
            { lbl: 'Avg cohort mean', v: '65.5%', d: '+0.6 vs last', pts: [63.7, 64.2, 64.9, 65.5] },
            { lbl: 'Avg items excluded', v: '3.4', d: '−0.8 vs last', pts: [5.1, 4.6, 4.2, 3.4] },
            { lbl: 'Mean item quality', v: '71', d: '+3 vs last', pts: [64, 66, 68, 71] },
          ].map((k, i) => (
            <div key={i} className="hf-card" style={{ flex: 1, padding: '16px 18px' }}>
              <div className="hf-lbl">{k.lbl}</div>
              <div className="hf-row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
                <div><div className="hf-mono" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{k.v}</div><div className="hf-sub" style={{ fontSize: 11, marginTop: 5 }}>{k.d}</div></div>
                <Spark pts={k.pts} w={96} h={36} />
              </div>
            </div>
          ))}
        </div>

        <div className="hf-row" style={{ gap: 16, flex: 1, minHeight: 0, alignItems: 'stretch' }}>
          {/* cohort mean by assessment */}
          <div className="hf-card" style={{ flex: 1, padding: '18px 20px', overflow: 'hidden' }}>
            <div className="hf-lbl" style={{ marginBottom: 4 }}>Cohort mean by assessment</div>
            {meanByAsm.map((m, i) => (
              <div key={i} className="hf-row" style={{ gap: 14, padding: '11px 0', borderBottom: i < meanByAsm.length - 1 ? `1px solid ${H.line}` : 'none' }}>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{m.n}</span>
                <Spark pts={m.pts} w={104} h={28} color={H.ink2} />
                <span className="hf-mono" style={{ width: 52, textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{m.now}</span>
                <span className="hf-mono" style={{ width: 40, textAlign: 'right', fontSize: 11.5, color: m.d[0] === '−' ? H.bad : H.good }}>{m.d}</span>
              </div>
            ))}
          </div>

          {/* grade distribution over time */}
          <div className="hf-card" style={{ flex: '0 0 380px', padding: '18px 20px' }}>
            <div className="hf-lbl" style={{ marginBottom: 4 }}>Grade distribution over time</div>
            <div className="hf-sub" style={{ fontSize: 11, marginBottom: 16 }}>Applicable Math · % in each grade</div>
            <div className="hf-row" style={{ justifyContent: 'space-around', alignItems: 'flex-end', height: 168 }}>
              {gradeOverTime.map((d, i) => (
                <div key={i} className="hf-col" style={{ alignItems: 'center', gap: 8 }}>
                  <StackCol dist={d} h={150} w={34} />
                  <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink2 }}>{CYCLE_LABELS[i]}</span>
                </div>
              ))}
            </div>
            <div className="hf-row" style={{ justifyContent: 'center', gap: 13, marginTop: 14 }}>
              {['A', 'B', 'C', 'D', 'E'].map(g => <span key={g} className="hf-row" style={{ gap: 5, fontSize: 10.5, color: H.ink2 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: GRADE_C[g] }} />{g}</span>)}
            </div>
          </div>
        </div>
      </div>
    </HShell>
  );
}

// ─── Compare cycles ────────────────────────────────────────────────
function HFCompare() {
  const cols = [
    { c: 'May 2026', part: '4,812', mean: '61.4%', med: '62', sd: '13.0', items: '48', excl: '3', a: '12.7%', e: '11.2%' },
    { c: 'January 2026', part: '4,503', mean: '60.2%', med: '61', sd: '13.6', items: '46', excl: '5', a: '11.4%', e: '12.0%' },
  ];
  const rows = [
    { k: 'Participants', f: 'part' }, { k: 'Cohort mean', f: 'mean' }, { k: 'Median score', f: 'med' },
    { k: 'Std. dev (σ)', f: 'sd' }, { k: 'Items scored', f: 'items' }, { k: 'Items excluded', f: 'excl' },
    { k: 'Grade A share', f: 'a' }, { k: 'Grade E share', f: 'e' },
  ];
  const dist = { 'May 2026': { A: 13, B: 24, C: 32, D: 20, E: 11 }, 'January 2026': { A: 11, B: 25, C: 33, D: 19, E: 12 } };
  return (
    <HShell active="Analytics" subnav={AN_SUBNAV('c')}
      crumb="Analytics  ›  Compare cycles"
      actions={<HBtn variant="ghost"><HIco name="download" />Export comparison</HBtn>}>
      <div className="hf-col" style={{ padding: '24px 30px', gap: 20, flex: 1, overflow: 'hidden' }}>
        <div><div className="hf-h1">Compare cycles</div><div className="hf-sub" style={{ marginTop: 6 }}>Pick two or more sittings and an assessment to see them side by side.</div></div>

        {/* selectors */}
        <div className="hf-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="hf-lbl" style={{ marginRight: 2 }}>Cycles</span>
          <HChip on>May 2026 <span style={{ marginLeft: 4, opacity: .7 }}>✕</span></HChip>
          <HChip on>January 2026 <span style={{ marginLeft: 4, opacity: .7 }}>✕</span></HChip>
          <HChip><HIco name="plus" size={12} />Add cycle</HChip>
          <span style={{ width: 1, height: 20, background: H.line2, margin: '0 4px' }} />
          <span className="hf-lbl" style={{ marginRight: 2 }}>Assessment</span>
          <HChip on>Applicable Math<HIco name="chev" /></HChip>
        </div>

        <div className="hf-row" style={{ gap: 16, flex: 1, minHeight: 0, alignItems: 'stretch' }}>
          {/* metrics table */}
          <div className="hf-card" style={{ flex: 1, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th className="hf-th">Metric</th>
                {cols.map(c => <th key={c.c} className="hf-th" style={{ textAlign: 'right' }}>{c.c}</th>)}
                <th className="hf-th" style={{ textAlign: 'right', width: 70 }}>Δ</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const v0 = parseFloat(cols[0][r.f].replace(/[^0-9.\-]/g, ''));
                  const v1 = parseFloat(cols[1][r.f].replace(/[^0-9.\-]/g, ''));
                  const delta = v0 - v1;
                  const dp = (Math.abs(delta) >= 100) ? delta.toLocaleString() : delta.toFixed(1).replace(/\.0$/, '');
                  return (
                    <tr key={i} className="hf-hover">
                      <td className="hf-td" style={{ fontWeight: 600, fontSize: 12.5 }}>{r.k}</td>
                      {cols.map(c => <td key={c.c} className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 13 }}>{c[r.f]}</td>)}
                      <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 12, color: Math.abs(delta) < 0.05 ? H.ink3 : delta > 0 ? H.good : H.bad }}>{delta > 0 ? '+' : ''}{dp}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* grade distribution grouped */}
          <div className="hf-card" style={{ flex: '0 0 360px', padding: '18px 20px' }}>
            <div className="hf-lbl" style={{ marginBottom: 16 }}>Grade distribution</div>
            <div className="hf-row" style={{ justifyContent: 'space-around', alignItems: 'flex-end', height: 170 }}>
              {['A', 'B', 'C', 'D', 'E'].map(g => (
                <div key={g} className="hf-col" style={{ alignItems: 'center', gap: 8 }}>
                  <div className="hf-row" style={{ alignItems: 'flex-end', gap: 4, height: 140 }}>
                    <div style={{ width: 16, height: `${dist['May 2026'][g] / 35 * 100}%`, background: H.pink, borderRadius: '2px 2px 0 0' }} title={`May ${dist['May 2026'][g]}%`} />
                    <div style={{ width: 16, height: `${dist['January 2026'][g] / 35 * 100}%`, background: H.ink2, opacity: .45, borderRadius: '2px 2px 0 0' }} title={`Jan ${dist['January 2026'][g]}%`} />
                  </div>
                  <span className="hf-mono" style={{ fontSize: 11, fontWeight: 700 }}>{g}</span>
                </div>
              ))}
            </div>
            <div className="hf-row" style={{ justifyContent: 'center', gap: 16, marginTop: 14 }}>
              <span className="hf-row" style={{ gap: 5, fontSize: 10.5, color: H.ink2 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: H.pink }} />May 2026</span>
              <span className="hf-row" style={{ gap: 5, fontSize: 10.5, color: H.ink2 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: H.ink2, opacity: .45 }} />January 2026</span>
            </div>
          </div>
        </div>
      </div>
    </HShell>
  );
}

Object.assign(window, { HFTrends, HFCompare, AN_SUBNAV });
