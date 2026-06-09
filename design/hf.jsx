// hf.jsx — Hi-fi brand system + primitives for G12++ (Alsama brand)
// Clean, technical foundation: cool-neutral surfaces + IBM Plex Sans/Mono.
// Alsama pink is used ONLY as an accent — primary actions, active/current state,
// focus, and directly-manipulated controls (cut-lines). Data viz stays neutral.

const H = {
  paper:   '#ffffff',
  canvas:  '#fbfcfd',   // near-white page background
  tint:    '#e9eef3',   // distinct light panel (side rails / headers)
  tint2:   '#e2e8ee',
  line:    '#e9ecf0',
  line2:   '#d5dbe1',
  ink:     '#1f2a31',   // cool slate near-black
  ink2:    '#58656d',
  ink3:    '#97a1a9',
  pink:    '#c12c68',   // Alsama accent
  pinkDk:  '#a4225626',
  pinkHover:'#a82357',
  pinkSoft:'#fbe7ef',
  pinkSoft2:'#fdf3f7',
  slate:   '#37454e',   // dark neutral (focal panels)
  slate2:  '#46555f',
  cream:   '#e9edf1',   // cool light text on dark panels
  bar:     '#8b959d',   // neutral chart stroke
  barFill: '#e3e7ea',   // neutral chart fill
  good:    '#2f7d52',  goodSoft: '#e7f1ea',
  warn:    '#946c1a',  warnSoft: '#f4eed9',
  bad:     '#c0392b',  badSoft:  '#f7e7e4',
  ui:      '"IBM Plex Sans", system-ui, sans-serif',
  mono:    '"IBM Plex Mono", ui-monospace, monospace',
  script:  '"Yellowtail", cursive',
};

if (typeof document !== 'undefined' && !document.getElementById('hf-styles')) {
  const s = document.createElement('style');
  s.id = 'hf-styles';
  s.textContent = `
  .hf *{box-sizing:border-box}
  .hf{font-family:${H.ui};color:${H.ink};font-size:13.5px;line-height:1.45;height:100%;background:${H.canvas};position:relative;-webkit-font-smoothing:antialiased}
  .hf-mono{font-family:${H.mono};font-variant-numeric:tabular-nums;letter-spacing:-.2px}
  .hf-row{display:flex;align-items:center}
  .hf-col{display:flex;flex-direction:column}
  .hf-h1{font-size:23px;font-weight:700;letter-spacing:-.5px;line-height:1.1}
  .hf-h2{font-size:15px;font-weight:700;letter-spacing:-.2px}
  .hf-lbl{font-size:10.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:${H.ink3}}
  .hf-sub{font-size:12.5px;color:${H.ink2}}
  .hf-card{background:${H.paper};border:1px solid ${H.line};border-radius:12px;box-shadow:0 1px 2px rgba(44,55,57,.03),0 2px 8px rgba(44,55,57,.04)}
  .hf-btn{font-family:inherit;font-size:12.5px;font-weight:600;border:1px solid ${H.line2};background:${H.paper};color:${H.ink};
    padding:8px 14px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;transition:.15s}
  .hf-btn:hover{border-color:${H.ink3};background:${H.tint}}
  .hf-btn.pri{background:${H.pink};border-color:${H.pink};color:#fff;box-shadow:0 1px 2px rgba(193,44,104,.3)}
  .hf-btn.pri:hover{background:${H.pinkHover};border-color:${H.pinkHover}}
  .hf-btn.danger{border-color:${H.bad};color:${H.bad}}
  .hf-btn.danger:hover{background:${H.badSoft}}
  .hf-btn.ghost{border-color:transparent;color:${H.ink2};background:transparent;padding:8px 9px}
  .hf-btn.ghost:hover{background:${H.tint2}}
  .hf-chip{font-size:11.5px;font-weight:500;border:1px solid ${H.line2};border-radius:999px;padding:4px 11px;color:${H.ink2};
    display:inline-flex;align-items:center;gap:5px;white-space:nowrap;background:${H.paper};cursor:pointer;transition:.12s}
  .hf-chip:hover{border-color:${H.ink3}}
  .hf-chip.on{border-color:${H.pink};color:${H.pink};background:${H.pinkSoft};font-weight:700}
  .hf-field{border:1px solid ${H.line2};border-radius:8px;background:${H.paper};padding:9px 11px;font-size:12.5px;color:${H.ink3};display:flex;align-items:center;gap:8px}
  .hf-th{font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:${H.ink3};text-align:left;padding:10px 12px;border-bottom:1px solid ${H.line2};white-space:nowrap;background:${H.tint}}
  .hf-td{padding:11px 12px;border-bottom:1px solid ${H.line};vertical-align:middle}
  .hf tr.hf-hover:hover{background:${H.pinkSoft2}}
  .hf-input{font-family:${H.mono};font-variant-numeric:tabular-nums;border:1px solid ${H.line2};border-radius:7px;background:${H.paper};
    padding:6px 9px;font-size:13px;color:${H.ink};text-align:right;width:74px;outline:none;transition:.12s}
  .hf-input:focus{border-color:${H.pink};box-shadow:0 0 0 3px ${H.pinkSoft}}
  `;
  document.head.appendChild(s);
}

function HMark({ kind, size = 16 }) {
  const st = { width: size, height: size, flex: '0 0 auto', display: 'inline-block', verticalAlign: 'middle' };
  if (kind === 'pass') return <svg viewBox="0 0 16 16" style={st}><circle cx="8" cy="8" r="7.2" fill={H.goodSoft}/><path d="M4.5 8.2l2.3 2.3L11.5 5.6" fill="none" stroke={H.good} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (kind === 'warn') return <svg viewBox="0 0 16 16" style={st}><circle cx="8" cy="8" r="7.2" fill={H.warnSoft}/><path d="M8 4.3v4.3M8 10.9v.05" stroke={H.warn} strokeWidth="1.9" strokeLinecap="round"/></svg>;
  if (kind === 'fail') return <svg viewBox="0 0 16 16" style={st}><circle cx="8" cy="8" r="7.2" fill={H.badSoft}/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" fill="none" stroke={H.bad} strokeWidth="1.9" strokeLinecap="round"/></svg>;
  return null;
}

function HIco({ name, size = 15, color = 'currentColor' }) {
  const st = { width: size, height: size, flex: '0 0 auto', display: 'inline-block', verticalAlign: 'middle' };
  const p = { fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'search': return <svg viewBox="0 0 16 16" style={st}><circle cx="7" cy="7" r="4.2" {...p}/><path d="M10.2 10.2L14 14" {...p}/></svg>;
    case 'lock':   return <svg viewBox="0 0 16 16" style={st}><rect x="3.5" y="7" width="9" height="6.5" rx="1.4" {...p}/><path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" {...p}/></svg>;
    case 'upload': return <svg viewBox="0 0 16 16" style={st}><path d="M8 10.5V3.5M5 6l3-3 3 3M3 12.5h10" {...p}/></svg>;
    case 'x':      return <svg viewBox="0 0 16 16" style={st}><path d="M4 4l8 8M12 4l-8 8" {...p}/></svg>;
    case 'chev':   return <svg viewBox="0 0 16 16" style={st}><path d="M4 6l4 4 4-4" {...p}/></svg>;
    case 'plus':   return <svg viewBox="0 0 16 16" style={st}><path d="M8 3v10M3 8h10" {...p}/></svg>;
    case 'arrow':  return <svg viewBox="0 0 16 16" style={st}><path d="M3 8h10M9 4l4 4-4 4" {...p}/></svg>;
    case 'doc':    return <svg viewBox="0 0 16 16" style={st}><path d="M4 2.5h5l3 3v8H4z" {...p}/><path d="M9 2.5v3h3" {...p}/></svg>;
    case 'download': return <svg viewBox="0 0 16 16" style={st}><path d="M8 2.5v7M5 7l3 3 3-3M3 13h10" {...p}/></svg>;
    case 'dots':   return <svg viewBox="0 0 16 16" style={st} fill={color} stroke="none"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>;
    case 'filter': return <svg viewBox="0 0 16 16" style={st}><path d="M2.5 4h11L9.5 9v3.5l-3 1.5V9z" {...p}/></svg>;
    case 'trash':  return <svg viewBox="0 0 16 16" style={st}><path d="M3.5 4.5h9M6 4.5V3h4v1.5M5 4.5l.6 9h4.8l.6-9" {...p}/></svg>;
    case 'mail':   return <svg viewBox="0 0 16 16" style={st}><rect x="2.5" y="4" width="11" height="8" rx="1.2" {...p}/><path d="M3 5l5 4 5-4" {...p}/></svg>;
    case 'refresh':return <svg viewBox="0 0 16 16" style={st}><path d="M13 6a5 5 0 10.5 4M13 3v3h-3" {...p}/></svg>;
    case 'award':  return <svg viewBox="0 0 16 16" style={st}><circle cx="8" cy="6.5" r="3.5" {...p}/><path d="M6 9.5L5 14l3-1.6L11 14l-1-4.5" {...p}/></svg>;
    case 'cal':    return <svg viewBox="0 0 16 16" style={st}><rect x="2.5" y="3.5" width="11" height="10" rx="1.2" {...p}/><path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" {...p}/></svg>;
    case 'eye':    return <svg viewBox="0 0 16 16" style={st}><path d="M1.5 8S4 4 8 4s6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z" {...p}/><circle cx="8" cy="8" r="1.6" {...p}/></svg>;
    default: return null;
  }
}

function HBtn({ children, variant, style, onClick }) { return <button className={`hf-btn ${variant || ''}`} style={style} onClick={onClick}>{children}</button>; }
function HChip({ children, on, onClick }) { return <span className={`hf-chip ${on ? 'on' : ''}`} onClick={onClick}>{children}</span>; }

function HStat({ n, label, sub, accent }) {
  return (
    <div className="hf-col" style={{ gap: 3 }}>
      <span className="hf-mono" style={{ fontSize: 25, fontWeight: 600, lineHeight: 1, color: accent ? H.pink : H.ink }}>{n}</span>
      <span className="hf-lbl" style={{ marginTop: 4 }}>{label}</span>
      {sub && <span className="hf-sub" style={{ fontSize: 11 }}>{sub}</span>}
    </div>
  );
}

function HHatch({ label, h = 80, w = '100%', style = {} }) {
  return <div style={{ width: w, height: h, border: `1.5px dashed ${H.line2}`, borderRadius: 10, background: `repeating-linear-gradient(135deg, transparent 0 9px, ${H.tint2} 9px 10px)`, display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>
    {label && <span className="hf-mono" style={{ fontSize: 11, color: H.ink3 }}>{label}</span>}
  </div>;
}

function HDist({ bars, h = 110, w = '100%' }) {
  const data = bars || [3,5,8,12,16,19,22,24,23,19,15,11,8,6,4,3,2];
  const max = Math.max(...data);
  return (
    <div className="hf-row" style={{ alignItems: 'flex-end', gap: 2, height: h, width: w, borderBottom: `1px solid ${H.line2}` }}>
      {data.map((v, i) => <div key={i} style={{ flex: 1, height: `${(v / max) * 100}%`, background: H.barFill, borderTop: `2.5px solid ${H.bar}`, borderRadius: '3px 3px 0 0' }} />)}
    </div>
  );
}

function HBreakBars({ items, w = '100%' }) {
  const max = Math.max(...items.map(i => i.v));
  return (
    <div className="hf-col" style={{ gap: 9, width: w }}>
      {items.map((it, i) => (
        <div key={i} className="hf-row" style={{ gap: 9 }}>
          <span style={{ width: 92, fontSize: 11.5, color: H.ink2, textAlign: 'right', flex: '0 0 auto' }}>{it.k}</span>
          <div style={{ flex: 1, height: 10, background: H.tint2, borderRadius: 5 }}><div style={{ width: `${(it.v / max) * 100}%`, height: '100%', background: H.bar, borderRadius: 5 }} /></div>
          <span className="hf-mono" style={{ width: 28, fontSize: 11.5, color: H.ink, textAlign: 'right', flex: '0 0 auto' }}>{it.v}</span>
        </div>
      ))}
    </div>
  );
}

function hfQColor(v) { return v >= 65 ? H.good : v >= 30 ? H.warn : H.bad; }
function HQuality({ v, width = 80, showLabel }) {
  const c = hfQColor(v);
  const label = v >= 65 ? 'Good' : v >= 30 ? 'Review' : 'Poor';
  return (
    <div className="hf-row" style={{ gap: 9 }}>
      <div style={{ width, height: 7, background: H.tint2, borderRadius: 5, flex: '0 0 auto' }}><div style={{ width: `${v}%`, height: '100%', background: c, borderRadius: 5 }} /></div>
      <span className="hf-mono" style={{ fontSize: 11.5, color: c, fontWeight: 600, width: 20 }}>{v}</span>
      {showLabel && <span style={{ fontSize: 11.5, fontWeight: 700, color: c }}>{label}</span>}
    </div>
  );
}

const HSTAGES = ['Ingest', 'Validate', 'Review', 'Score', 'Boundaries', 'Grades', 'Export'];
function HPipeline({ active = 2, done = 1, compact, range }) {
  const isDone = (i) => range ? i < range[0] : i < done;
  const isNow = (i) => range ? (i >= range[0] && i <= range[1]) : i === active;
  return (
    <div className="hf-row" style={{ flexWrap: 'nowrap' }}>
      {HSTAGES.map((s, i) => {
        const state = isDone(i) ? 'done' : isNow(i) ? 'now' : 'next';
        return (
          <React.Fragment key={s}>
            <div className="hf-row" style={{ gap: 7 }}>
              <span style={{ width: 21, height: 21, borderRadius: 999, flex: '0 0 auto',
                border: `1.5px solid ${state === 'done' ? H.slate : state === 'now' ? H.pink : H.line2}`,
                background: state === 'done' ? H.slate : state === 'now' ? H.pinkSoft : H.paper,
                color: state === 'done' ? '#fff' : state === 'now' ? H.pink : H.ink3,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                {state === 'done' ? <svg width="10" height="10" viewBox="0 0 12 12"><path d="M2.5 6.2l2.2 2.2L9.5 3.5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg> : i + 1}
              </span>
              {!compact && <span style={{ fontSize: 12, fontWeight: state === 'now' ? 700 : 500, color: state === 'next' ? H.ink3 : H.ink }}>{s}</span>}
            </div>
            {i < HSTAGES.length - 1 && <div style={{ width: compact ? 16 : 26, height: 2,
              background: isDone(i) ? H.slate : (range && i >= range[0] && i < range[1]) ? H.pink : H.line2, margin: '0 9px' }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// light neutral rail; pink only on brand mark + active item. Three areas.
const HRAIL = [
  { k: 'Cycles', d: 'M3 5h10M3 8h10M3 11h7' },
  { k: 'Analytics', d: 'M3 13V8.5M7.5 13V3.5M12 13V10' },
  { k: 'Settings', d: 'M8 6a2 2 0 100 4 2 2 0 100-4M8 2.6V4.2M8 11.8v1.6M13.4 8H11.8M4.2 8H2.6M11.4 4.6l-1 1M5.6 10.4l-1 1M11.4 11.4l-1-1M5.6 5.6l-1-1' },
];
function HRail({ active = 'Cycles' }) {
  return (
    <div className="hf-col" style={{ width: 64, flex: '0 0 auto', background: H.tint, borderRight: `1px solid ${H.line2}`, alignItems: 'center', padding: '16px 0', gap: 6 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: H.pink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, boxShadow: '0 1px 4px rgba(193,44,104,.35)' }}>
        <span style={{ fontFamily: H.script, fontSize: 22, lineHeight: 1, marginTop: 4 }}>A</span>
      </div>
      {HRAIL.map(it => {
        const on = it.k === active;
        return (
          <div key={it.k} title={it.k} className="hf-col" style={{ alignItems: 'center', gap: 3, cursor: 'pointer' }}>
            <div style={{ width: 40, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? H.pinkSoft : 'transparent', color: on ? H.pink : H.ink3 }}>
              <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={it.d}/></svg>
            </div>
            <span style={{ fontSize: 8.5, fontWeight: on ? 700 : 500, letterSpacing: '.2px', color: on ? H.pink : H.ink3 }}>{it.k}</span>
          </div>
        );
      })}
      <div style={{ flex: 1 }} />
      <div style={{ width: 30, height: 30, borderRadius: 999, background: H.tint2, color: H.ink2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>RM</div>
    </div>
  );
}

// secondary tab bar (sits under the header)
function HSubnav({ items }) {
  return (
    <div className="hf-row" style={{ flex: '0 0 auto', borderBottom: `1px solid ${H.line}`, padding: '0 24px', gap: 2, background: H.paper }}>
      {items.map((it, i) => (
        <div key={i} style={{ padding: '12px 15px', fontSize: 13, fontWeight: it.on ? 700 : 500, color: it.on ? H.pink : H.ink2,
          borderBottom: `3px solid ${it.on ? H.pink : 'transparent'}`, cursor: 'pointer' }}>{it.label}</div>
      ))}
    </div>
  );
}

function HShell({ active = 'Cycles', crumb, actions, subnav, stage, done, range, stageAction, children }) {
  return (
    <div className="hf hf-row" style={{ alignItems: 'stretch' }}>
      <HRail active={active} />
      <div className="hf-col" style={{ flex: 1, minWidth: 0 }}>
        <div className="hf-row" style={{ height: 54, flex: '0 0 auto', borderBottom: `1px solid ${H.line}`, padding: '0 24px', gap: 14, background: H.paper }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: H.pink, letterSpacing: '-.3px' }}>G12<span style={{ color: H.ink }}>++</span></span>
          <span style={{ width: 1, height: 20, background: H.line2 }} />
          <span className="hf-sub" style={{ flex: 1 }}>{crumb}</span>
          {actions}
        </div>
        {subnav && <HSubnav items={subnav} />}
        {stage != null && (
          <div className="hf-row" style={{ flex: '0 0 auto', borderBottom: `1px solid ${H.line}`, padding: '9px 24px', background: H.canvas, gap: 16, minHeight: 56 }}>
            <HPipeline active={stage} done={done != null ? done : stage} range={range} />
            <div style={{ flex: 1 }} />
            {stageAction}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ── form / status primitives ──
function HBadge({ tone = 'neutral', children }) {
  const map = {
    good: [H.good, H.goodSoft], warn: [H.warn, H.warnSoft], bad: [H.bad, H.badSoft],
    accent: [H.pink, H.pinkSoft], neutral: [H.ink2, H.tint2],
  };
  const [fg, bg] = map[tone] || map.neutral;
  return <span style={{ fontSize: 10.5, fontWeight: 700, color: fg, background: bg, padding: '3px 9px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', letterSpacing: '.2px' }}>{children}</span>;
}
function HToggle({ on }) {
  return <span style={{ width: 34, height: 20, borderRadius: 999, background: on ? H.pink : H.line2, position: 'relative', flex: '0 0 auto', transition: '.15s', display: 'inline-block' }}>
    <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: '.15s' }} />
  </span>;
}
function HCheck({ on, half }) {
  return <span style={{ width: 18, height: 18, borderRadius: 5, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: `1.5px solid ${on || half ? H.pink : H.line2}`, background: on ? H.pink : half ? H.pinkSoft : H.paper }}>
    {on && <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 6.2l2.2 2.2L9.5 3.5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>}
    {half && <span style={{ width: 8, height: 2, background: H.pink, borderRadius: 2 }} />}
  </span>;
}
function HAvatar({ name, size = 32, tone }) {
  const init = name.split(' ').map(w => w[0]).slice(0, 2).join('');
  return <span style={{ width: size, height: size, borderRadius: 999, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: tone === 'pink' ? H.pinkSoft : H.tint2, color: tone === 'pink' ? H.pink : H.ink2, fontWeight: 700, fontSize: size * 0.38 }}>{init}</span>;
}
function HProgress({ pct, w = '100%', tone }) {
  return <div style={{ width: w, height: 7, background: H.tint2, borderRadius: 5 }}><div style={{ width: `${pct}%`, height: '100%', background: tone === 'good' ? H.good : H.pink, borderRadius: 5, transition: '.2s' }} /></div>;
}

Object.assign(window, { H, HMark, HIco, HBtn, HChip, HStat, HHatch, HDist, HBreakBars, hfQColor, HQuality, HPipeline, HRail, HSubnav, HShell, HSTAGES, HBadge, HToggle, HCheck, HAvatar, HProgress });
