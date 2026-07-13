// explore.jsx — exploration zones, clean restyle. Chosen options tagged.
// Picks: Nav C (Hybrid) · Quality D (Meter) · Layout A (Rail) · Boundary A (Drag).

function MiniHatch({ h = 12, w }) {
  return <div style={{ width: w, height: h, borderRadius: 4, background: `repeating-linear-gradient(135deg, transparent 0 6px, ${W.tint2} 6px 7px)`, border: `1px solid ${W.line}` }} />;
}
function Skel({ w = '100%', h = 9, c }) { return <div style={{ width: w, height: h, borderRadius: 3, background: c || W.tint2 }} />; }
function FrameTitle({ children, sub, chosen }) {
  return <div style={{ padding: '12px 14px', borderBottom: `1px solid ${W.line}` }}>
    <div className="w-row" style={{ gap: 8 }}>
      <div className="w-h2" style={{ fontSize: 13 }}>{children}</div>
      {chosen && <span className="w-row" style={{ gap: 4, fontSize: 10, fontWeight: 700, color: W.good, background: W.goodSoft, padding: '2px 8px', borderRadius: 999 }}>
        <svg width="10" height="10" viewBox="0 0 12 12"><path d="M2.5 6.2l2.2 2.2L9.5 3.5" fill="none" stroke={W.good} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>Chosen</span>}
    </div>
    {sub && <div className="w-sub" style={{ fontSize: 11, marginTop: 3 }}>{sub}</div>}
  </div>;
}

// ═══ NAV MODEL ══════════════════════════════════════════════════════
function NavSidebar() {
  return (
    <div className="w-root w-col">
      <FrameTitle sub="Persistent wide rail · stage shown as a chip">A · Wide sidebar</FrameTitle>
      <div className="w-row" style={{ flex: 1, alignItems: 'stretch' }}>
        <div className="w-col" style={{ width: 96, background: W.tint, borderRight: `1px solid ${W.line}`, padding: '12px 0', gap: 4 }}>
          <div style={{ padding: '0 12px 8px', fontWeight: 700, fontSize: 11, color: W.accent }}>G12++</div>
          {['Cycles', 'Assess.', 'Audit', 'Settings'].map((t, i) => (
            <div key={t} style={{ padding: '6px 12px', fontSize: 10.5, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? W.accent : W.ink2, borderLeft: `2.5px solid ${i === 0 ? W.accent : 'transparent'}`, background: i === 0 ? W.accentSoft : 'transparent' }}>{t}</div>
          ))}
        </div>
        <div className="w-col" style={{ flex: 1, padding: 14, gap: 11 }}>
          <div className="w-row" style={{ justifyContent: 'space-between' }}><Skel w={90} h={11} c={W.line2} /><span className="w-chip on" style={{ fontSize: 9, padding: '1px 7px' }}>Review · 3/7</span></div>
          <Skel /><Skel w="80%" /><MiniHatch h={46} /><Skel w="60%" />
        </div>
      </div>
    </div>
  );
}
function NavStepper() {
  return (
    <div className="w-root w-col">
      <FrameTitle sub="Pipeline IS the nav — linear, hard to skip a step">B · Top pipeline stepper</FrameTitle>
      <div className="w-col" style={{ flex: 1, padding: 14, gap: 12 }}>
        <div className="w-row" style={{ justifyContent: 'space-between' }}><span style={{ fontWeight: 700, fontSize: 11, color: W.accent }}>G12++ · May 2026</span><Skel w={50} h={9} /></div>
        <div style={{ padding: '10px 4px', borderTop: `1px solid ${W.line}`, borderBottom: `1px solid ${W.line}` }}><Pipeline active={2} done={2} compact /></div>
        <Skel /><Skel w="74%" /><MiniHatch h={40} /><Skel w="55%" />
        <div className="w-row" style={{ gap: 6, marginTop: 'auto' }}><Btn variant="ghost" style={{ fontSize: 11 }}>← Validate</Btn><div style={{ flex: 1 }} /><Btn variant="pri" style={{ fontSize: 11 }}>Score →</Btn></div>
      </div>
    </div>
  );
}
function NavHybrid() {
  return (
    <div className="w-root w-col">
      <FrameTitle chosen sub="Slim rail for cross-cycle nav + stepper for this cycle's flow">C · Hybrid</FrameTitle>
      <div className="w-row" style={{ flex: 1, alignItems: 'stretch' }}>
        <div className="w-col" style={{ width: 56, background: W.tint, borderRight: `1px solid ${W.line}`, padding: '12px 0', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: W.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, fontFamily: W.mono }}>G</div>
          {[0, 1, 2, 3].map(i => <div key={i} style={{ width: 24, height: 24, borderRadius: 7, background: i === 0 ? W.accentSoft : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 13, height: 13, borderRadius: 4, border: `1.4px solid ${i === 0 ? W.accent : W.line2}` }} /></div>)}
        </div>
        <div className="w-col" style={{ flex: 1, padding: 12, gap: 10 }}>
          <Skel w={80} h={11} c={W.line2} />
          <div style={{ padding: '7px 0', borderTop: `1px solid ${W.line}`, borderBottom: `1px solid ${W.line}` }}><Pipeline active={2} done={2} compact /></div>
          <Skel /><Skel w="78%" /><MiniHatch h={34} />
        </div>
      </div>
    </div>
  );
}

// ═══ QUALITY RATING REPRESENTATION ══════════════════════════════════
function QRow({ q, left, stat }) {
  return <div className="w-row" style={{ gap: 8, padding: '9px 12px', borderBottom: `1px solid ${W.line}` }}>
    <span className="w-mono" style={{ fontWeight: 700, fontSize: 11, width: 26 }}>{q}</span>
    <div style={{ flex: 1 }}>{left}</div>
    <span className="w-mono" style={{ fontSize: 11, color: W.ink2 }}>{stat}</span>
  </div>;
}
function QualBadge() {
  const bg = { good: W.goodSoft, review: W.warnSoft, poor: W.badSoft };
  const fg = { good: W.good, review: W.warn, poor: W.bad };
  const Tag = ({ r, t }) => <span style={{ fontSize: 10.5, fontWeight: 700, color: fg[r], background: bg[r], padding: '3px 9px', borderRadius: 999 }}>{t}</span>;
  return <div className="w-root w-col">
    <FrameTitle sub="Loud buckets — but only 3 levels, no magnitude">A · Colour badges</FrameTitle>
    <QRow q="Q07" left={<Tag r="good" t="Good" />} stat=".51" />
    <QRow q="Q12" left={<Tag r="review" t="Review" />} stat=".21" />
    <QRow q="Q23" left={<Tag r="poor" t="Poor" />} stat=".02" />
  </div>;
}
function QualShape() {
  const Row = ({ r, t }) => <span className="w-row" style={{ gap: 6, fontSize: 11.5, fontWeight: 600 }}><Mark kind={r} size={15} />{t}</span>;
  return <div className="w-root w-col">
    <FrameTitle sub="Shape + label — colour-blind safe, still only 3 levels">B · Shape + label</FrameTitle>
    <QRow q="Q07" left={<Row r="pass" t="Good" />} stat=".51" />
    <QRow q="Q12" left={<Row r="warn" t="Review" />} stat=".21" />
    <QRow q="Q23" left={<Row r="fail" t="Poor" />} stat=".02" />
  </div>;
}
function QualType() {
  const Lab = ({ t, w }) => <span style={{ fontSize: 11.5, fontWeight: w ? 700 : 500, color: w ? W.bad : W.ink2, letterSpacing: '.3px', borderLeft: `2px solid ${w ? W.bad : W.line2}`, paddingLeft: 8 }}>{t}</span>;
  return <div className="w-root w-col">
    <FrameTitle sub="Quiet — weight carries severity, no colour">C · Typographic only</FrameTitle>
    <QRow q="Q07" left={<Lab t="GOOD" />} stat=".51" />
    <QRow q="Q12" left={<Lab t="NEEDS REVIEW" />} stat=".21" />
    <QRow q="Q23" left={<Lab t="POOR" w />} stat=".02" />
  </div>;
}
function QualMeter() {
  return <div className="w-root w-col">
    <FrameTitle chosen sub="Composite 0–100 score, colour-coded bar — shows magnitude">D · Quality meter</FrameTitle>
    <QRow q="Q07" left={<QualityMeter v={84} width={110} showLabel />} stat=".51" />
    <QRow q="Q12" left={<QualityMeter v={41} width={110} showLabel />} stat=".21" />
    <QRow q="Q23" left={<QualityMeter v={8} width={110} showLabel />} stat=".02" />
  </div>;
}

// ═══ ITEM-REVIEW / STATS LAYOUT ═════════════════════════════════════
const IROWS = [{ q: 'Q07', qv: 84, d: '.51', w: 80 }, { q: 'Q12', qv: 41, d: '.21', w: 60 }, { q: 'Q15', qv: 88, d: '.58', w: 90 }, { q: 'Q23', qv: 8, d: '.02', w: 70 }];
function tinyTable(rows, sel) {
  return <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
    {rows.map((r, i) => (
      <tr key={i} style={{ background: i === sel ? W.accentSoft : 'transparent' }}>
        <td style={{ padding: '7px 10px', borderBottom: `1px solid ${W.line}` }}><span className="w-mono" style={{ fontWeight: 700, fontSize: 10, marginRight: 7 }}>{r.q}</span><Skel w={r.w} h={7} c={W.line2} /></td>
        <td style={{ padding: '7px 10px', borderBottom: `1px solid ${W.line}`, width: 90 }}><QualityMeter v={r.qv} width={48} /></td>
        <td style={{ padding: '7px 10px', borderBottom: `1px solid ${W.line}`, width: 30 }} className="w-mono"><span style={{ fontSize: 10, color: W.ink2 }}>{r.d}</span></td>
      </tr>
    ))}
  </tbody></table>;
}
function LayoutRail() {
  return <div className="w-root w-col">
    <FrameTitle chosen sub="Table scrolls; stats persist on the right, always visible">A · Table + sticky right rail</FrameTitle>
    <div className="w-row" style={{ flex: 1, alignItems: 'stretch' }}>
      <div style={{ flex: 1, borderRight: `1px solid ${W.line}` }}>{tinyTable(IROWS)}</div>
      <div className="w-col" style={{ width: 150, background: W.tint, padding: 12, gap: 12 }}>
        <div><div className="w-lbl" style={{ fontSize: 9 }}>Distribution · live</div><div style={{ marginTop: 6 }}><Dist h={48} /></div></div>
        <div><div className="w-lbl" style={{ fontSize: 9 }}>By element</div><div style={{ marginTop: 6 }}><BreakBars items={[{ k: 'Num', v: 14 }, { k: 'Alg', v: 11 }, { k: 'Geo', v: 9 }]} /></div></div>
      </div>
    </div>
  </div>;
}
function LayoutDrawer() {
  return <div className="w-root w-col">
    <FrameTitle sub="Full-width table; click a row to expand its detail below">B · Table + expanding row drawer</FrameTitle>
    <div className="w-col" style={{ flex: 1 }}>
      {tinyTable(IROWS, 3)}
      <div style={{ background: W.tint, borderTop: `2px solid ${W.accent}`, padding: 12 }}>
        <div className="w-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><span className="w-mono" style={{ fontWeight: 700, fontSize: 11 }}>Q23 · detail</span><Btn variant="ghost" style={{ fontSize: 10 }}><Ico name="x" size={11} />close</Btn></div>
        <div className="w-row" style={{ gap: 14 }}>
          <div style={{ flex: 1 }}><Skel /><div style={{ height: 5 }} /><Skel w="70%" /></div>
          <div className="w-row" style={{ gap: 12 }}><Stat n=".02" label="disc" /><Stat n="-.04" label="it-r" /></div>
        </div>
      </div>
    </div>
  </div>;
}
function LayoutSplit() {
  return <div className="w-root w-col">
    <FrameTitle sub="Compact item list left, one item's full detail right">C · Master–detail split</FrameTitle>
    <div className="w-row" style={{ flex: 1, alignItems: 'stretch' }}>
      <div style={{ width: 150, borderRight: `1px solid ${W.line}` }}>
        {IROWS.map((r, i) => <div key={i} className="w-row" style={{ gap: 7, padding: '8px 10px', borderBottom: `1px solid ${W.line}`, background: i === 3 ? W.accentSoft : 'transparent', borderLeft: `2.5px solid ${i === 3 ? W.accent : 'transparent'}` }}><span className="w-mono" style={{ fontWeight: 700, fontSize: 10 }}>{r.q}</span><span style={{ width: 8, height: 8, borderRadius: 999, background: qColor(r.qv) }} /><Skel w={r.w * .55} h={6} c={W.line2} /></div>)}
      </div>
      <div className="w-col" style={{ flex: 1, padding: 12, gap: 10 }}>
        <span className="w-mono" style={{ fontWeight: 700, fontSize: 12 }}>Q23 · Probability</span>
        <Skel /><Skel w="80%" />
        <div className="w-row" style={{ gap: 14, marginTop: 2 }}><Stat n=".02" label="disc" /><Stat n=".19" label="p-val" /></div>
        <Btn variant="danger" style={{ fontSize: 11, marginTop: 'auto', alignSelf: 'flex-start' }}>Exclude…</Btn>
      </div>
    </div>
  </div>;
}

// ═══ GRADE-BOUNDARY INTERACTION ═════════════════════════════════════
function BoundDrag() {
  return <div className="w-root w-col">
    <FrameTitle chosen sub="Grab the dashed line; bands recount live">A · Drag handles on the curve</FrameTitle>
    <div className="w-col" style={{ flex: 1, padding: '22px 16px', justifyContent: 'center', gap: 12 }}>
      <Dist h={96} cuts={[80, 58, 36]} bands={['E', 'D', 'C', 'A']} showHandles />
      <div className="w-row" style={{ justifyContent: 'space-between' }}>{[['A', 612], ['B', 1144], ['C', 1530], ['D', 988]].map(([g, n]) => <span key={g} className="w-mono" style={{ fontSize: 10, color: W.ink2 }}>{g} <b style={{ color: W.ink }}>{n}</b></span>)}</div>
    </div>
  </div>;
}
function BoundNumeric() {
  return <div className="w-root w-col">
    <FrameTitle sub="Type exact cut-points; precise & auditable">B · Numeric entry table</FrameTitle>
    <div className="w-col" style={{ flex: 1, padding: 14, gap: 9, justifyContent: 'center' }}>
      {[['A', '78', 612], ['B', '64', 1144], ['C', '50', 1530], ['D', '38', 988]].map(([g, c, n]) => (
        <div key={g} className="w-row" style={{ gap: 10 }}>
          <span style={{ width: 24, height: 24, border: `1px solid ${W.line2}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: W.mono, fontSize: 11 }}>{g}</span>
          <span className="w-sub" style={{ fontSize: 11 }}>≥</span>
          <span className="w-field w-mono" style={{ width: 64, padding: '5px 8px', justifyContent: 'flex-end', color: W.ink }}>{c}%</span>
          <div style={{ flex: 1 }} /><span className="w-mono" style={{ fontSize: 12, fontWeight: 600 }}>{n.toLocaleString()}</span><span className="w-sub" style={{ fontSize: 10 }}>students</span>
        </div>
      ))}
    </div>
  </div>;
}
function BoundSlider() {
  return <div className="w-root w-col">
    <FrameTitle sub="Curve for reference, one slider track for all cuts">C · Slider track under curve</FrameTitle>
    <div className="w-col" style={{ flex: 1, padding: '20px 16px', justifyContent: 'center', gap: 16 }}>
      <Dist h={70} cuts={[80, 58, 36]} />
      <div style={{ position: 'relative', height: 6, background: W.tint2, borderRadius: 4 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '100%', background: W.accent, borderRadius: 4, opacity: .2 }} />
        {[20, 42, 64].map((x, i) => <div key={i} style={{ position: 'absolute', left: `${x}%`, top: -6, width: 16, height: 16, borderRadius: 999, background: W.paper, border: `2px solid ${W.accent}`, boxShadow: '0 1px 3px rgba(0,0,0,.12)' }} />)}
      </div>
      <div className="w-row" style={{ justifyContent: 'space-around' }}>{['D|E', 'C|D', 'B|C', 'A|B'].map(t => <span key={t} className="w-mono" style={{ fontSize: 9.5, color: W.ink3 }}>{t}</span>)}</div>
    </div>
  </div>;
}

Object.assign(window, {
  NavSidebar, NavStepper, NavHybrid,
  QualBadge, QualShape, QualType, QualMeter,
  LayoutRail, LayoutDrawer, LayoutSplit,
  BoundDrag, BoundNumeric, BoundSlider,
});
