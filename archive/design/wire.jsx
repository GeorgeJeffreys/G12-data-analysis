// wire.jsx — shared primitives for G12++ Exam Processing Suite (clean / professional)
// Neutral slate palette, functional colour only for status. IBM Plex Sans/Mono.
// Exports primitives to window for use by spineA/spineB/explore.

const W = {
  paper:    '#ffffff',
  tint:     '#f7f9fb',
  tint2:    '#eef1f5',
  line:     '#e6e9ee',
  line2:    '#d2d7df',
  ink:      '#1f2933',
  ink2:     '#59636f',
  ink3:     '#98a2b0',
  accent:   '#2b5c8a',   // calm, trustworthy primary
  accentSoft:'#e9f0f7',
  good:     '#2f7d4f',  goodSoft: '#e8f1ea',
  warn:     '#9a7a1e',  warnSoft: '#f6efd9',
  bad:      '#b23b2e',  badSoft:  '#f6e7e4',
  uiFont:   '"IBM Plex Sans", system-ui, sans-serif',
  mono:     '"IBM Plex Mono", ui-monospace, monospace',
};

if (typeof document !== 'undefined' && !document.getElementById('w-styles')) {
  const s = document.createElement('style');
  s.id = 'w-styles';
  s.textContent = `
  .w-root *{box-sizing:border-box}
  .w-root{font-family:${W.uiFont};color:${W.ink};font-size:13px;line-height:1.45;height:100%;background:${W.paper};position:relative}
  .w-mono{font-family:${W.mono};font-variant-numeric:tabular-nums}
  .w-h1{font-size:19px;font-weight:600;letter-spacing:-.3px}
  .w-h2{font-size:14px;font-weight:600;letter-spacing:-.1px}
  .w-lbl{font-size:10px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:${W.ink3}}
  .w-sub{font-size:12px;color:${W.ink2}}
  .w-row{display:flex;align-items:center}
  .w-col{display:flex;flex-direction:column}
  .w-card{border:1px solid ${W.line};background:${W.paper};border-radius:8px}
  .w-btn{font-family:inherit;font-size:12px;font-weight:600;border:1px solid ${W.line2};
    background:${W.paper};color:${W.ink};padding:7px 13px;border-radius:6px;cursor:pointer;
    display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .w-btn:hover{border-color:${W.ink3}}
  .w-btn.pri{background:${W.accent};border-color:${W.accent};color:#fff}
  .w-btn.danger{border-color:${W.bad};color:${W.bad}}
  .w-btn.ghost{border-color:transparent;color:${W.ink2};padding:7px 8px;background:transparent}
  .w-btn.ghost:hover{background:${W.tint2}}
  .w-chip{font-size:11px;font-weight:500;border:1px solid ${W.line2};border-radius:999px;
    padding:3px 10px;color:${W.ink2};display:inline-flex;align-items:center;gap:5px;white-space:nowrap;background:${W.paper};cursor:pointer}
  .w-chip.on{border-color:${W.accent};color:${W.accent};background:${W.accentSoft};font-weight:600}
  .w-field{border:1px solid ${W.line2};border-radius:6px;background:${W.paper};
    padding:8px 10px;font-size:12px;color:${W.ink3};display:flex;align-items:center;gap:7px}
  .w-th{font-size:10px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:${W.ink3};
    text-align:left;padding:9px 10px;border-bottom:1px solid ${W.line2};white-space:nowrap;background:${W.tint}}
  .w-td{padding:9px 10px;border-bottom:1px solid ${W.line};vertical-align:middle}
  .w-divider{height:1px;background:${W.line}}
  `;
  document.head.appendChild(s);
}

// ── status marks (shape + colour, colour-blind safe) ──
function Mark({ kind, size = 15 }) {
  const st = { width: size, height: size, flex: '0 0 auto', display: 'inline-block', verticalAlign: 'middle' };
  if (kind === 'pass') return (
    <svg viewBox="0 0 16 16" style={st}><circle cx="8" cy="8" r="7" fill={W.goodSoft}/><path d="M4.5 8.2l2.3 2.3L11.5 5.6" fill="none" stroke={W.good} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
  if (kind === 'warn') return (
    <svg viewBox="0 0 16 16" style={st}><circle cx="8" cy="8" r="7" fill={W.warnSoft}/><path d="M8 4.4v4.2M8 10.8v.05" stroke={W.warn} strokeWidth="1.8" strokeLinecap="round"/></svg>);
  if (kind === 'fail') return (
    <svg viewBox="0 0 16 16" style={st}><circle cx="8" cy="8" r="7" fill={W.badSoft}/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" fill="none" stroke={W.bad} strokeWidth="1.8" strokeLinecap="round"/></svg>);
  return null;
}

// ── tiny inline icons (no emoji) ──
function Ico({ name, size = 14, color = 'currentColor' }) {
  const st = { width: size, height: size, flex: '0 0 auto', display: 'inline-block', verticalAlign: 'middle' };
  const p = { fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'search': return <svg viewBox="0 0 16 16" style={st}><circle cx="7" cy="7" r="4.2" {...p}/><path d="M10.2 10.2L14 14" {...p}/></svg>;
    case 'lock':   return <svg viewBox="0 0 16 16" style={st}><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" {...p}/><path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" {...p}/></svg>;
    case 'upload': return <svg viewBox="0 0 16 16" style={st}><path d="M8 10.5V3.5M5 6l3-3 3 3M3 12.5h10" {...p}/></svg>;
    case 'x':      return <svg viewBox="0 0 16 16" style={st}><path d="M4 4l8 8M12 4l-8 8" {...p}/></svg>;
    case 'chev':   return <svg viewBox="0 0 16 16" style={st}><path d="M4 6l4 4 4-4" {...p}/></svg>;
    default: return null;
  }
}

// ── hatched placeholder ──
function Hatch({ label, h = 80, w = '100%', style = {} }) {
  return (
    <div style={{ width: w, height: h, border: `1px dashed ${W.line2}`, borderRadius: 6,
      background: `repeating-linear-gradient(135deg, transparent 0 8px, ${W.tint2} 8px 9px)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>
      {label && <span className="w-mono" style={{ fontSize: 10, color: W.ink3, letterSpacing: .3 }}>{label}</span>}
    </div>
  );
}

function Btn({ children, variant, style }) { return <button className={`w-btn ${variant || ''}`} style={style}>{children}</button>; }
function Chip({ children, on }) { return <span className={`w-chip ${on ? 'on' : ''}`}>{children}</span>; }
function Field({ label, value, w, icon }) {
  return (
    <label className="w-col" style={{ gap: 5, width: w }}>
      {label && <span className="w-lbl">{label}</span>}
      <span className="w-field">{icon}{value || '\u00A0'}</span>
    </label>
  );
}

function Stat({ n, label, sub }) {
  return (
    <div className="w-col" style={{ gap: 2 }}>
      <span className="w-mono" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1, letterSpacing: '-.5px' }}>{n}</span>
      <span className="w-lbl" style={{ marginTop: 4 }}>{label}</span>
      {sub && <span className="w-sub" style={{ fontSize: 11 }}>{sub}</span>}
    </div>
  );
}

// ── score distribution; optional cut lines + handles (accent) ──
function Dist({ bars, h = 110, cuts = [], bands, w = '100%', showHandles }) {
  const data = bars || [3,5,8,12,16,19,22,24,23,19,15,11,8,6,4,3,2];
  const max = Math.max(...data);
  return (
    <div style={{ position: 'relative', width: w }}>
      <div className="w-row" style={{ alignItems: 'flex-end', gap: 2, height: h, borderBottom: `1px solid ${W.line2}` }}>
        {data.map((v, i) => (
          <div key={i} style={{ flex: 1, height: `${(v / max) * 100}%`, background: W.tint2, borderTop: `2px solid ${W.ink3}`, borderRadius: '2px 2px 0 0' }} />
        ))}
      </div>
      {cuts.map((c, i) => (
        <div key={i} style={{ position: 'absolute', top: -6, bottom: 0, left: `${c}%`, width: 0 }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, borderLeft: `2px dashed ${W.accent}` }} />
          {showHandles && <div style={{ position: 'absolute', top: -5, left: -8, width: 16, height: 16, borderRadius: 5, background: W.paper, border: `2px solid ${W.accent}`, boxShadow: '0 1px 3px rgba(0,0,0,.12)', cursor: 'ew-resize' }} />}
        </div>
      ))}
      {bands && (
        <div className="w-row" style={{ position: 'absolute', top: 4, left: 0, right: 0, justifyContent: 'space-around' }}>
          {bands.map((b, i) => <span key={i} className="w-mono" style={{ fontSize: 11, fontWeight: 600, color: W.ink2 }}>{b}</span>)}
        </div>
      )}
    </div>
  );
}

function BreakBars({ items, w = '100%' }) {
  const max = Math.max(...items.map(i => i.v));
  return (
    <div className="w-col" style={{ gap: 9, width: w }}>
      {items.map((it, i) => (
        <div key={i} className="w-row" style={{ gap: 8 }}>
          <span style={{ width: 92, fontSize: 11, color: W.ink2, textAlign: 'right', flex: '0 0 auto' }}>{it.k}</span>
          <div style={{ flex: 1, height: 10, background: W.tint2, borderRadius: 3 }}>
            <div style={{ width: `${(it.v / max) * 100}%`, height: '100%', background: W.accent, borderRadius: 3, opacity: .8 }} />
          </div>
          <span className="w-mono" style={{ width: 30, fontSize: 11, color: W.ink, textAlign: 'right', flex: '0 0 auto' }}>{it.v}</span>
        </div>
      ))}
    </div>
  );
}

// ── quality: composite 0–100 meter, colour-coded by severity (the chosen treatment) ──
function qColor(v) { return v >= 65 ? W.good : v >= 30 ? W.warn : W.bad; }
function QualityMeter({ v, width = 92, showLabel }) {
  const c = qColor(v);
  const label = v >= 65 ? 'Good' : v >= 30 ? 'Review' : 'Poor';
  return (
    <div className="w-row" style={{ gap: 8 }}>
      <div style={{ width, height: 7, background: W.tint2, borderRadius: 4, flex: '0 0 auto', position: 'relative' }}>
        <div style={{ width: `${v}%`, height: '100%', background: c, borderRadius: 4 }} />
      </div>
      <span className="w-mono" style={{ fontSize: 11, color: c, fontWeight: 600, width: 22 }}>{v}</span>
      {showLabel && <span style={{ fontSize: 11, fontWeight: 600, color: c }}>{label}</span>}
    </div>
  );
}

// ── 7-stage pipeline stepper ──
const STAGES = ['Ingest', 'Validate', 'Review', 'Score', 'Boundaries', 'Grades', 'Export'];
function Pipeline({ active = 2, done = 1, compact }) {
  return (
    <div className="w-row" style={{ gap: 0, flexWrap: 'nowrap' }}>
      {STAGES.map((s, i) => {
        const state = i < done ? 'done' : i === active ? 'now' : 'next';
        const on = state !== 'next';
        return (
          <React.Fragment key={s}>
            <div className="w-row" style={{ gap: 7 }}>
              <span style={{ width: 20, height: 20, borderRadius: 999, flex: '0 0 auto',
                border: `1.5px solid ${on ? W.accent : W.line2}`,
                background: state === 'done' ? W.accent : state === 'now' ? W.accentSoft : W.paper,
                color: state === 'done' ? '#fff' : state === 'now' ? W.accent : W.ink3,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                {state === 'done' ? <svg width="10" height="10" viewBox="0 0 12 12"><path d="M2.5 6.2l2.2 2.2L9.5 3.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : i + 1}
              </span>
              {!compact && <span style={{ fontSize: 12, fontWeight: state === 'now' ? 700 : 500, color: state === 'next' ? W.ink3 : W.ink }}>{s}</span>}
            </div>
            {i < STAGES.length - 1 && <div style={{ width: compact ? 16 : 24, height: 2, background: i < done ? W.accent : W.line2, margin: '0 8px' }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── hybrid shell: slim icon rail + top bar + (optional) pipeline strip ──
const RAIL = [
  { k: 'Cycles', d: 'M3 4h10v3H3zM3 9h10v3H3z' },
  { k: 'Assessments', d: 'M4 3h6l2 2v8H4z' },
  { k: 'Audit log', d: 'M4 3h8v10H4zM6 6h4M6 8.5h4' },
  { k: 'Settings', d: 'M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z' },
];
function RailNav({ active = 'Cycles' }) {
  return (
    <div className="w-col" style={{ width: 60, flex: '0 0 auto', borderRight: `1px solid ${W.line}`, background: W.tint, alignItems: 'center', padding: '14px 0', gap: 6 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: W.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <span className="w-mono" style={{ fontSize: 13, fontWeight: 700 }}>G</span>
      </div>
      {RAIL.map(it => {
        const on = it.k === active;
        return (
          <div key={it.k} title={it.k} style={{ width: 38, height: 38, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: on ? W.accentSoft : 'transparent', color: on ? W.accent : W.ink3 }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d={it.d}/></svg>
          </div>
        );
      })}
    </div>
  );
}

function Shell({ active = 'Cycles', crumb, actions, stage, done, children }) {
  return (
    <div className="w-root w-row" style={{ alignItems: 'stretch' }}>
      <RailNav active={active} />
      <div className="w-col" style={{ flex: 1, minWidth: 0 }}>
        <div className="w-row" style={{ height: 50, flex: '0 0 auto', borderBottom: `1px solid ${W.line}`, padding: '0 22px', gap: 12, background: W.paper }}>
          <span className="w-sub" style={{ flex: 1 }}>{crumb}</span>
          {actions}
        </div>
        {stage != null && (
          <div className="w-row" style={{ flex: '0 0 auto', borderBottom: `1px solid ${W.line}`, padding: '12px 22px', background: W.tint }}>
            <Pipeline active={stage} done={done != null ? done : stage} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

Object.assign(window, { W, Mark, Ico, Hatch, Btn, Chip, Field, Stat, Dist, BreakBars, qColor, QualityMeter, Pipeline, RailNav, Shell, STAGES });
