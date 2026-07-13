// hfBoundaries.jsx — Hi-fi screen 05: Scoring & grade boundaries, INTERACTIVE dual-mode.
// Mode A "Fix boundaries": set cut-points → live student counts.
// Mode B "Fix cohort %": set target % per band → solves for the cut-points.

const { useState, useRef, useCallback } = React;

// ── synthetic cohort score model (≈ normal, slight low tail) ──
const HF_N = 4812;
const HF_COUNTS = (() => {
  const pdf = (x, mu, sd) => Math.exp(-0.5 * ((x - mu) / sd) ** 2);
  const raw = []; let sum = 0;
  for (let s = 0; s <= 100; s++) { const w = pdf(s, 62, 13) + 0.18 * pdf(s, 38, 18); raw[s] = w; sum += w; }
  return raw.map(w => (w / sum) * HF_N);
})();
const HF_ATABOVE = (() => { const a = new Array(102).fill(0); for (let s = 100; s >= 0; s--) a[s] = a[s + 1] + HF_COUNTS[s]; return a; })();
const atOrAbove = (cut) => HF_ATABOVE[Math.max(0, Math.min(100, Math.round(cut)))];

function bandCounts(c) {
  return {
    A: atOrAbove(c.A),
    B: atOrAbove(c.B) - atOrAbove(c.A),
    C: atOrAbove(c.C) - atOrAbove(c.B),
    D: atOrAbove(c.D) - atOrAbove(c.C),
    E: HF_N - atOrAbove(c.D),
  };
}
// solve cut-points from cumulative-from-top targets (percent)
function cutsFromTargets(t) {
  let cum = 0; const cuts = {};
  ['A', 'B', 'C', 'D'].forEach(g => {
    cum += Number(t[g]) || 0;
    const want = cum / 100 * HF_N;
    let best = 0, bd = Infinity;
    for (let s = 0; s <= 100; s++) { const d = Math.abs(atOrAbove(s) - want); if (d < bd) { bd = d; best = s; } }
    cuts[g] = best;
  });
  return cuts;
}

const GRADES = ['A', 'B', 'C', 'D', 'E'];
const BAND_FILL = { A: 0.06, B: 0.0, C: 0.045, D: 0.0, E: 0.03 };
const fmt = (n) => Math.round(n).toLocaleString();

// ── the chart: histogram + shaded bands + cut handles ──
function BoundaryChart({ cuts, draggable, onDrag }) {
  const ref = useRef(null);
  const bars = []; for (let s = 0; s <= 100; s += 2) bars.push(HF_COUNTS[s] + (HF_COUNTS[s + 1] || 0));
  const max = Math.max(...bars);
  const regions = [
    { g: 'E', from: 0, to: cuts.D }, { g: 'D', from: cuts.D, to: cuts.C }, { g: 'C', from: cuts.C, to: cuts.B },
    { g: 'B', from: cuts.B, to: cuts.A }, { g: 'A', from: cuts.A, to: 100 },
  ];
  const startDrag = (key) => (e) => {
    if (!draggable) return; e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    const move = (ev) => {
      let v = Math.round(((ev.clientX - rect.left) / rect.width) * 100);
      v = Math.max(0, Math.min(100, v));
      onDrag(key, v);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };
  return (
    <div ref={ref} style={{ position: 'relative', height: 196, userSelect: 'none' }}>
      {/* shaded grade bands */}
      {regions.map(r => (
        <div key={r.g} style={{ position: 'absolute', top: 0, bottom: 22, left: `${r.from}%`, width: `${r.to - r.from}%`, background: H.slate, opacity: BAND_FILL[r.g] }} />
      ))}
      {regions.map(r => (
        <div key={r.g + 'l'} style={{ position: 'absolute', top: 4, left: `${(r.from + r.to) / 2}%`, transform: 'translateX(-50%)', fontFamily: H.mono, fontWeight: 700, fontSize: 13, color: H.ink2 }}>{r.g}</div>
      ))}
      {/* bars */}
      <div className="hf-row" style={{ position: 'absolute', left: 0, right: 0, bottom: 22, top: 0, alignItems: 'flex-end', gap: 1 }}>
        {bars.map((v, i) => <div key={i} style={{ flex: 1, height: `${(v / max) * 92}%`, background: '#dde4ea', borderRadius: '2px 2px 0 0' }} />)}
      </div>
      {/* baseline */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 22, height: 1.5, background: H.line2 }} />
      {/* cut handles */}
      {['D', 'C', 'B', 'A'].map(k => (
        <div key={k} style={{ position: 'absolute', top: 0, bottom: 22, left: `${cuts[k]}%`, width: 0 }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, borderLeft: `2px dashed ${H.pink}` }} />
          <div onPointerDown={startDrag(k)} title={draggable ? 'Drag' : 'Computed from target %'}
            style={{ position: 'absolute', top: -2, left: -15, width: 30, height: 20, borderRadius: 6, background: draggable ? H.pink : H.paper,
              border: `2px solid ${H.pink}`, color: draggable ? '#fff' : H.pink, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: H.mono, fontSize: 10, fontWeight: 700, cursor: draggable ? 'ew-resize' : 'default', boxShadow: '0 2px 6px rgba(193,44,104,.3)' }}>
            {cuts[k]}
          </div>
        </div>
      ))}
      {/* axis */}
      <div className="hf-row" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, justifyContent: 'space-between' }}>
        {['0%', '25%', '50%', '75%', '100%'].map(t => <span key={t} className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>{t}</span>)}
      </div>
    </div>
  );
}

function HFBoundaries() {
  const [mode, setMode] = useState('cuts'); // 'cuts' | 'pct'
  const [cuts, setCuts] = useState({ A: 78, B: 64, C: 50, D: 38 });
  const [targets, setTargets] = useState({ A: 13, B: 24, C: 32, D: 20 });

  const effCuts = mode === 'cuts' ? cuts : cutsFromTargets(targets);
  const counts = bandCounts(effCuts);
  const eTarget = 100 - (Number(targets.A) + Number(targets.B) + Number(targets.C) + Number(targets.D));

  const setCut = useCallback((k, v) => {
    setCuts(prev => {
      const order = ['A', 'B', 'C', 'D']; const i = order.indexOf(k); const n = { ...prev };
      let val = Math.max(0, Math.min(100, Math.round(v)));
      const hi = i > 0 ? prev[order[i - 1]] - 2 : 99;       // must stay below higher grade's cut
      const lo = i < 3 ? prev[order[i + 1]] + 2 : 1;        // and above lower grade's cut
      n[k] = Math.max(lo, Math.min(hi, val));
      return n;
    });
  }, []);

  const seg = (val, label, sub) => (
    <button onClick={() => setMode(val)} style={{ flex: 1, padding: '10px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
      background: mode === val ? H.paper : 'transparent', borderRadius: 8, boxShadow: mode === val ? '0 1px 3px rgba(44,55,57,.12)' : 'none', transition: '.15s' }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: mode === val ? H.pink : H.ink2 }}>{label}</div>
      <div className="hf-sub" style={{ fontSize: 11, marginTop: 1 }}>{sub}</div>
    </button>
  );

  return (
    <HShell active="Cycles" stage={5} done={5}
      crumb="Cycles  ›  May 2026  ›  Scoring & grade boundaries"
      actions={
        <div className="hf-row" style={{ border: `1px solid ${H.line2}`, borderRadius: 8, overflow: 'hidden' }}>
          <span style={{ padding: '7px 13px', fontSize: 12.5, fontWeight: 700, background: H.pinkSoft, color: H.pink, whiteSpace: 'nowrap' }}>Applicable Math</span>
          <span style={{ padding: '7px 13px', fontSize: 12.5, color: H.ink2, borderLeft: `1px solid ${H.line2}`, whiteSpace: 'nowrap' }}>Overall</span>
        </div>}
      stageAction={<HBtn variant="pri">Confirm boundaries<HIco name="arrow" color="#fff" /></HBtn>}>
      <div className="hf-col" style={{ padding: '24px 32px', gap: 18, flex: 1 }}>
        <div className="hf-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="hf-h1">Set grade boundaries</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 560 }}>
              {mode === 'cuts'
                ? 'Drag a cut-point on the curve, or type a score. Student counts update as you move.'
                : 'Type the share of students you want in each grade. We solve for the nearest cut-points that achieve it.'}
            </div>
          </div>
          {/* MODE TOGGLE */}
          <div className="hf-row" style={{ background: H.tint2, borderRadius: 11, padding: 4, gap: 4, width: 380, flex: '0 0 auto' }}>
            {seg('cuts', 'Fix boundaries', 'Set scores → see counts')}
            {seg('pct', 'Fix cohort %', 'Set shares → solve scores')}
          </div>
        </div>

        <div className="hf-row" style={{ gap: 20, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          {/* chart */}
          <div className="hf-card" style={{ flex: 1, padding: '20px 24px 14px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="hf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="hf-lbl">Score distribution · 4,812 students</span>
              <span className="hf-row" style={{ gap: 6, fontSize: 11, color: mode === 'cuts' ? H.pink : H.ink3, fontWeight: 600 }}>
                {mode === 'cuts'
                  ? <><span style={{ width: 6, height: 6, borderRadius: 999, background: H.pink }} />Handles draggable</>
                  : <>Handles computed from targets</>}
              </span>
            </div>
            <BoundaryChart cuts={effCuts} draggable={mode === 'cuts'} onDrag={setCut} />
            <div className="hf-row" style={{ gap: 30, marginTop: 22, paddingTop: 18, borderTop: `1px solid ${H.line}` }}>
              <HStat n="61.4%" label="Cohort mean" />
              <HStat n="62" label="Median" />
              <HStat n="13.0" label="Std. dev (σ)" />
              <HStat n="45" label="Items scored" sub="3 excluded" />
            </div>
            <div className="hf-row" style={{ gap: 9, marginTop: 'auto', paddingTop: 16, color: H.ink3 }}>
              <HIco name="arrow" size={14} color={H.ink3} />
              <span className="hf-sub" style={{ fontSize: 11.5 }}>
                {mode === 'cuts' ? 'Drag a dashed handle or edit a score on the right — everything recomputes instantly.' : 'Cut-points are placed automatically. Switch to “Fix boundaries” to nudge them by hand.'}
              </span>
            </div>
          </div>

          {/* table */}
          <div className="hf-card" style={{ flex: '0 0 440px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', flex: '0 0 auto' }}>
              <thead><tr>
                <th className="hf-th">Grade</th>
                <th className="hf-th" style={{ textAlign: 'right' }}>Cut-point ≥{mode === 'pct' && <span style={{ color: H.pink, marginLeft: 5 }}>auto</span>}</th>
                <th className="hf-th" style={{ textAlign: 'right' }}>Students</th>
                <th className="hf-th" style={{ textAlign: 'right' }}>% of cohort{mode === 'cuts' && <span style={{ color: H.pink, marginLeft: 5 }}>auto</span>}</th>
              </tr></thead>
              <tbody>
                {GRADES.map(g => {
                  const cnt = counts[g];
                  const pctNow = cnt / HF_N * 100;
                  const isE = g === 'E';
                  return (
                    <tr key={g}>
                      <td className="hf-td"><span style={{ width: 27, height: 27, border: `1px solid ${H.line2}`, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: H.mono }}>{g}</span></td>
                      {/* cut-point */}
                      <td className="hf-td" style={{ textAlign: 'right' }}>
                        {isE ? <span className="hf-sub hf-mono">below D</span>
                          : mode === 'cuts'
                            ? <span className="hf-row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                                <input className="hf-input" value={effCuts[g]} onChange={(e) => setCut(g, e.target.value)} /><span className="hf-sub">%</span>
                              </span>
                            : <span className="hf-mono" style={{ fontWeight: 600 }}>{effCuts[g]}%</span>}
                      </td>
                      {/* students */}
                      <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 600 }}>{fmt(cnt)}</td>
                      {/* % of cohort */}
                      <td className="hf-td" style={{ textAlign: 'right' }}>
                        {mode === 'pct' && !isE
                          ? <span className="hf-row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                              <input className="hf-input" style={{ width: 58 }} value={targets[g]} onChange={(e) => setTargets(t => ({ ...t, [g]: e.target.value.replace(/[^0-9]/g, '') }))} /><span className="hf-sub">%</span>
                            </span>
                          : <span className="hf-mono" style={{ color: H.ink2 }}>{pctNow.toFixed(1)}%</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* compared to last cycle */}
            <div style={{ padding: '16px 18px 10px', borderTop: `1px solid ${H.line}` }}>
              <div className="hf-lbl" style={{ whiteSpace: 'nowrap', marginBottom: 18 }}>Grade mix vs Jan 2026</div>
              <div className="hf-row" style={{ alignItems: 'flex-end', justifyContent: 'space-around', height: 70 }}>
                {GRADES.map(g => {
                  const nowPct = counts[g] / HF_N * 100;
                  const last = { A: 11.2, B: 25.1, C: 33.4, D: 18.9, E: 11.4 }[g];
                  const delta = nowPct - last;
                  return (
                    <div key={g} className="hf-col" style={{ alignItems: 'center', gap: 6, flex: 1 }}>
                      <span className="hf-mono" style={{ fontSize: 9.5, color: Math.abs(delta) < 0.5 ? H.ink3 : H.ink2 }}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}</span>
                      <div className="hf-row" style={{ alignItems: 'flex-end', gap: 3, height: 46 }}>
                        <div style={{ width: 12, height: `${Math.max(4, nowPct / 36 * 100)}%`, background: H.ink2, borderRadius: '2px 2px 0 0' }} />
                        <div style={{ width: 12, height: `${Math.max(4, last / 36 * 100)}%`, border: `1.5px solid ${H.line2}`, borderBottom: 'none', borderRadius: '2px 2px 0 0' }} />
                      </div>
                      <span className="hf-mono" style={{ fontSize: 10, fontWeight: 700 }}>{g}</span>
                    </div>
                  );
                })}
              </div>
              <div className="hf-row" style={{ justifyContent: 'center', gap: 16, marginTop: 12, fontSize: 10.5, color: H.ink3 }}>
                <span className="hf-row" style={{ gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: H.ink2 }} />Now</span>
                <span className="hf-row" style={{ gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, border: `1.5px solid ${H.line2}` }} />Jan 2026</span>
              </div>
            </div>
            {/* footer note */}
            <div className="hf-row" style={{ padding: '11px 14px', gap: 9, borderTop: `1px solid ${H.line}`, background: H.tint, marginTop: 'auto' }}>
              {mode === 'pct'
                ? (eTarget < 0
                    ? <><HMark kind="fail" size={15} /><span style={{ fontSize: 11.5, color: H.bad }}>Targets exceed 100%. Reduce a band — E is currently {eTarget}%.</span></>
                    : <><HMark kind="warn" size={15} /><span className="hf-sub" style={{ fontSize: 11.5 }}>E takes the remainder ({eTarget}%). Scores are discrete, so achieved % can differ slightly from target.</span></>)
                : <><HMark kind="warn" size={15} /><span className="hf-sub" style={{ fontSize: 11.5 }}>A-cut is 4 pts above Jan 2026 — confirm intended before continuing.</span></>}
            </div>
          </div>
        </div>
      </div>
    </HShell>
  );
}

Object.assign(window, { HFBoundaries });
