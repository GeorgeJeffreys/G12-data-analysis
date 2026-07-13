// hfData2.jsx — Front-of-pipeline data layer + shared data-screen primitives for G12++
//  Real construct structure (major element → sub-element → demand D1/D2/D3),
//  an 18-student centre cohort, and the building blocks every front screen reuses:
//    · HFRONT_STAGES        the expanded pipeline these screens live in
//    · SubjectChips         the per-subject chip row (item counts, essay marker)
//    · SummaryBand          scannable stat cards for one subject
//    · Breakdown            counts by major element / sub-element / demand level
//    · RawTable             the "show me my data" spreadsheet (sticky header + sticky meta cols)
//  All inline-styled against the H tokens from hf.jsx. No shared `styles` object (by design).

// Expanded front of the pipeline. "Raw scores" (naive) is distinct from the later "Score" stage.
const HFRONT_STAGES = ['Upload', 'Raw data', 'Clean', 'Raw scores', 'Review', 'Adjustments', 'Score', 'Boundaries', 'Grades', 'Export'];

const DEMAND = {
  D1: { label: 'D1', name: 'Less demanding',       tip: 'Recall & routine procedures' },
  D2: { label: 'D2', name: 'Moderately demanding', tip: 'Apply in familiar contexts' },
  D3: { label: 'D3', name: 'More demanding',       tip: 'Reason & solve in new contexts' },
};

// item counts per element sum to the subject total; demand split ≈ 40/40/20.
const SUBJECTS = [
  { key: 'math', name: 'Applicable Maths', short: 'Maths', items: 41, rtl: false, essay: false,
    demand: { D1: 16, D2: 17, D3: 8 },
    elements: [
      { id: 'A', name: 'Numerical & quantitative reasoning', items: 9, subs: ['Understanding & using numbers', 'Applying mathematical operations'] },
      { id: 'B', name: 'Spatial & geometric reasoning', items: 7, subs: ['Interpreting shapes and measurements'] },
      { id: 'C', name: 'Functional algebra & logical thinking', items: 9, subs: ['Recognising & using patterns & relationships', 'Solving problems using algebraic techniques'] },
      { id: 'D', name: 'Data, probability & decision-making', items: 8, subs: ['Understanding & interpreting data', 'Applying probability & statistical concepts'] },
      { id: 'E', name: 'Graphical literacy & visual data interpretation', items: 8, subs: ['Reading & interpreting graphical information', 'Using visual data to support reasoning'] },
    ] },
  { key: 'eng', name: 'English as 2nd Language', short: 'English', items: 60, rtl: false, essay: true,
    demand: { D1: 24, D2: 24, D3: 12 },
    elements: [
      { id: 'A', name: 'Reading comprehension', items: 24, subs: ['Understanding meaning', 'Evaluating meaning', 'Synthesising & critically engaging'] },
      { id: 'B', name: 'Listening comprehension', items: 18, subs: ['Understanding meaning', 'Evaluating meaning', 'Interpreting tone & indirect clues'] },
      { id: 'C', name: 'Writing & expression', items: 18, essay: true, subs: ['Generating relevant content', 'Organising ideas', 'Using vocabulary', 'Applying grammar', 'Using mechanics'] },
    ] },
  { key: 'sci', name: 'Scientific Thinking', short: 'Scientific', items: 36, rtl: false, essay: false,
    demand: { D1: 14, D2: 15, D3: 7 },
    elements: [
      { id: 'A', name: 'Explain phenomena scientifically', items: 12, subs: ['Everyday application of knowledge', 'Formulating / selecting hypotheses'] },
      { id: 'B', name: 'Evaluate & design scientific inquiry', items: 16, subs: ['Variables & validity', 'Repeating experiments & outliers', 'Testing hypotheses with evidence', 'Using scientific processes', 'Analysing scientific texts', 'Evaluating scientific methods'] },
      { id: 'C', name: 'Interpret evidence & data scientifically', items: 8, subs: ['Using graphs & models', 'Interpreting & inferring from data'] },
    ] },
  { key: 'ar', name: 'Arabic as 1st Language', short: 'Arabic', items: 31, rtl: true, essay: true,
    demand: { D1: 12, D2: 13, D3: 6 },
    elements: [
      { id: 'A', name: 'Reading comprehension', items: 13, subs: ['Understanding meaning', 'Evaluating meaning', 'Lexical & semantic depth', 'Synthesising across texts'] },
      { id: 'B', name: 'Editing & proofreading', items: 8, subs: ['Identifying & correcting errors', 'Improving style & effectiveness'] },
      { id: 'C', name: 'Writing & expression', items: 10, essay: true, subs: ['Generating content', 'Organising ideas', 'Rhetorical command', 'Using vocabulary', 'Applying grammar', 'Mechanics (incl. tashkeel)', 'Register discipline'] },
    ] },
  { key: 'life', name: 'Life Success Skills', short: 'Life Skills', items: 25, rtl: false, essay: false,
    demand: { D1: 10, D2: 10, D3: 5 },
    elements: [
      { id: 'A', name: 'Communication', items: 6, subs: ['Listening', 'Speaking'] },
      { id: 'B', name: 'Creative problem-solving', items: 7, subs: ['Problem-solving', 'Creativity'] },
      { id: 'C', name: 'Self-management', items: 6, subs: ['Adapting', 'Planning'] },
      { id: 'D', name: 'Collaboration', items: 6, subs: ['Leadership', 'Teamwork'] },
    ] },
];
const subjBy = (k) => SUBJECTS.find(s => s.key === k);

// 18-student centre cohort. ability ≈ raw proportion correct (drives realistic-looking rows).
const COHORT = [
  { id: '80412', n: 'Aisha Nasser',  c: 'AM', ability: .83 },
  { id: '80413', n: 'Omar Fadel',    c: 'AM', ability: .71 },
  { id: '80414', n: 'Leila Mansour', c: 'AM', ability: .64 },
  { id: '80415', n: 'Yusuf Haddad',  c: 'AM', ability: .58 },
  { id: '80417', n: 'Noor Khalil',   c: 'PM', ability: .79 },
  { id: '80419', n: 'Sami Aboud',    c: 'PM', ability: .49 },
  { id: '80421', n: 'Maya Hassan',   c: 'PM', ability: .88 },
  { id: '80423', n: 'Rami Saab',     c: 'AM', ability: .55 },
  { id: '80425', n: 'Dana Khoury',   c: 'PM', ability: .76 },
  { id: '80427', n: 'Tariq Younan',  c: 'AM', ability: .43 },
  { id: '80429', n: 'Hiba Darwish',  c: 'PM', ability: .81 },
  { id: '80431', n: 'Karim Daoud',   c: 'AM', ability: .67 },
  { id: '80433', n: 'Lina Saleh',    c: 'PM', ability: .72 },
  { id: '80436', n: 'Jad Maalouf',   c: 'AM', ability: .60 },
  { id: '80438', n: 'Salma Rahal',   c: 'PM', ability: .85 },
  { id: '80440', n: 'Nabil Aoun',    c: 'AM', ability: .52 },
  { id: '80442', n: 'Rana Bitar',    c: 'PM', ability: .74 },
  { id: '80445', n: 'Fadi Greige',   c: 'AM', ability: .47 },
];

const frac = (x) => { const v = Math.sin(x) * 43758.5453; return v - Math.floor(v); };
// build per-item metadata for a subject: element letter + demand level, in column order
function itemMeta(subj) {
  const out = [];
  // demand pattern that yields ~40/40/20 and varies column-to-column
  const dpat = ['D1', 'D2', 'D1', 'D2', 'D3'];
  subj.elements.forEach((el) => {
    for (let k = 0; k < el.items; k++) {
      out.push({ q: out.length + 1, el: el.id, elName: el.name, demand: dpat[out.length % dpat.length], essay: !!el.essay });
    }
  });
  return out;
}
// a single response cell: 1 correct · 0 incorrect · '–' omitted/blank
function cellVal(seedId, q, ability, demand) {
  const r = frac(seedId * 31.7 + q * 7.3 + 1.1);
  if (r > 0.965) return '–';
  const diff = demand === 'D1' ? 0 : demand === 'D2' ? 0.11 : 0.24;
  return r < (ability - diff) ? 1 : 0;
}
const seedOf = (id) => Number(id);
// raw score for a student on a subject (count of 1s), and out-of
function rawScore(subj, stu) {
  const meta = itemMeta(subj);
  let got = 0, attempted = 0;
  meta.forEach(m => { const v = cellVal(seedOf(stu.id), m.q, stu.ability, m.demand); if (v !== '–') attempted++; if (v === 1) got++; });
  return { got, max: subj.items, attempted, pct: Math.round((got / subj.items) * 100) };
}

// ── per-subject chip row ────────────────────────────────────────────
function SubjectChips({ active, onPick, showItems = true }) {
  return (
    <div className="hf-row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {SUBJECTS.map(s => {
        const on = s.key === active;
        return (
          <span key={s.key} className={`hf-chip ${on ? 'on' : ''}`} onClick={() => onPick && onPick(s.key)}>
            {s.essay && <span title="includes an essay-scored element" style={{ width: 6, height: 6, borderRadius: 999, background: on ? H.pink : H.ink3, flex: '0 0 auto' }} />}
            {s.short}
            {showItems && <span className="hf-mono" style={{ fontSize: 10.5, color: on ? H.pink : H.ink3, marginLeft: 2 }}>{s.items}</span>}
          </span>
        );
      })}
    </div>
  );
}

// ── summary stat band for one subject ───────────────────────────────
function SummaryBand({ subj, participants = 18 }) {
  const cards = [
    { n: participants, label: 'Participants', sub: 'test-takers in this sitting' },
    { n: subj.items, label: 'Items', sub: 'scored questions', accent: true },
    { n: subj.elements.length, label: 'Major elements', sub: `${subj.elements.reduce((a, e) => a + e.subs.length, 0)} sub-elements` },
    { n: `${subj.demand.D1}·${subj.demand.D2}·${subj.demand.D3}`, label: 'D1 · D2 · D3', sub: 'items per demand level' },
  ];
  return (
    <div className="hf-row" style={{ gap: 0, alignItems: 'stretch' }}>
      {cards.map((c, i) => (
        <div key={i} className="hf-col" style={{ flex: 1, gap: 3, padding: '2px 22px', borderLeft: i ? `1px solid ${H.line}` : 'none' }}>
          <span className="hf-mono" style={{ fontSize: c.n.toString().length > 6 ? 21 : 27, fontWeight: 600, lineHeight: 1, color: c.accent ? H.pink : H.ink }}>{c.n}</span>
          <span className="hf-lbl" style={{ marginTop: 5 }}>{c.label}</span>
          <span className="hf-sub" style={{ fontSize: 11 }}>{c.sub}</span>
        </div>
      ))}
    </div>
  );
}

// ── breakdown by major element / demand level ───────────────────────
function Breakdown({ subj, compact }) {
  const elMax = Math.max(...subj.elements.map(e => e.items));
  const dmax = Math.max(subj.demand.D1, subj.demand.D2, subj.demand.D3);
  const demandRows = [['D1', subj.demand.D1, DEMAND.D1.name], ['D2', subj.demand.D2, DEMAND.D2.name], ['D3', subj.demand.D3, DEMAND.D3.name]];
  return (
    <div className="hf-row" style={{ gap: 22, alignItems: 'stretch', flexWrap: compact ? 'wrap' : 'nowrap' }}>
      {/* by major element */}
      <div className="hf-col" style={{ flex: 2, gap: 10, minWidth: 280 }}>
        <span className="hf-lbl">Items by major element</span>
        <div className="hf-col" style={{ gap: 8 }}>
          {subj.elements.map(el => (
            <div key={el.id} className="hf-row" style={{ gap: 10 }}>
              <span className="hf-mono" style={{ width: 16, height: 16, borderRadius: 5, background: H.tint2, color: H.ink2, fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{el.id}</span>
              <span style={{ flex: 1, fontSize: 12, color: H.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${el.name} — ${el.subs.length} sub-element${el.subs.length > 1 ? 's' : ''}`}>{el.name}{el.essay && <span style={{ color: H.pink, fontWeight: 700 }}> · essay</span>}</span>
              <div style={{ width: 90, height: 8, background: H.tint2, borderRadius: 5, flex: '0 0 auto' }}><div style={{ width: `${(el.items / elMax) * 100}%`, height: '100%', background: el.essay ? H.pink : H.bar, borderRadius: 5 }} /></div>
              <span className="hf-mono" style={{ width: 22, fontSize: 11.5, color: H.ink, textAlign: 'right', flex: '0 0 auto' }}>{el.items}</span>
            </div>
          ))}
        </div>
      </div>
      {/* by demand level */}
      <div className="hf-col" style={{ flex: 1, gap: 10, minWidth: 190, borderLeft: compact ? 'none' : `1px solid ${H.line}`, paddingLeft: compact ? 0 : 22 }}>
        <span className="hf-lbl">Items by demand level</span>
        <div className="hf-col" style={{ gap: 8 }}>
          {demandRows.map(([d, v, name]) => (
            <div key={d} className="hf-row" style={{ gap: 10 }} title={DEMAND[d].tip}>
              <span className="hf-mono" style={{ fontSize: 11, fontWeight: 700, color: H.ink2, width: 20, flex: '0 0 auto' }}>{d}</span>
              <span style={{ flex: 1, fontSize: 11.5, color: H.ink2, whiteSpace: 'nowrap' }}>{name}</span>
              <div style={{ width: 64, height: 8, background: H.tint2, borderRadius: 5, flex: '0 0 auto' }}><div style={{ width: `${(v / dmax) * 100}%`, height: '100%', background: H.bar, borderRadius: 5 }} /></div>
              <span className="hf-mono" style={{ width: 22, fontSize: 11.5, color: H.ink, textAlign: 'right', flex: '0 0 auto' }}>{v}</span>
            </div>
          ))}
          <div className="hf-sub" style={{ fontSize: 10.5, marginTop: 2 }}>Target mix 40 · 40 · 20 (±5%) — within tolerance.</div>
        </div>
      </div>
    </div>
  );
}

// ── the raw export table: sticky header + sticky meta columns ───────
function RawTable({ subjKey = 'math', maxH = 360, rows = COHORT, dirty = false, selCols = [], selRows = [] }) {
  const subj = subjBy(subjKey);
  const meta = itemMeta(subj);
  const demandTag = { D1: H.ink3, D2: H.ink2, D3: H.pink };
  // sticky meta column geometry
  const W = { id: 78, name: 146, cohort: 64 };
  const L = { id: 0, name: W.id, cohort: W.id + W.name };
  const stickyTh = (left, w, z = 6) => ({ position: 'sticky', top: 0, left, zIndex: z, minWidth: w, width: w, background: H.tint });
  const stickyTd = (left, w) => ({ position: 'sticky', left, zIndex: 2, minWidth: w, width: w, background: H.paper });
  const metaCols = [['Participant ID', W.id, L.id], ['Name', W.name, L.name], ['Cohort', W.cohort, L.cohort]];
  // a couple of injected "dirty" artifacts for the cleaning screen
  const dupId = '80421';
  return (
    <div style={{ overflow: 'auto', maxHeight: maxH, border: `1px solid ${H.line2}`, borderRadius: 10, background: H.paper }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5, width: 'max-content' }}>
        <thead>
          <tr>
            {metaCols.map(([t, w, l], i) => (
              <th key={t} className="hf-th" style={{ ...stickyTh(l, w, 7), boxShadow: i === metaCols.length - 1 ? `2px 0 0 ${H.line2}` : 'none', borderRight: i === metaCols.length - 1 ? `1px solid ${H.line2}` : 'none' }}>{t}</th>
            ))}
            {dirty && <th className="hf-th" style={{ ...stickyTh(null, 92, 6), position: 'sticky', top: 0, background: selCols.includes('_tmp') ? H.pinkSoft : H.warnSoft, color: H.warn }}>_import_tmp</th>}
            {meta.map(m => {
              const on = selCols.includes(m.q);
              return (
                <th key={m.q} className="hf-th" style={{ position: 'sticky', top: 0, minWidth: 44, width: 44, textAlign: 'center', padding: '7px 4px', background: on ? H.pinkSoft : H.tint }}>
                  <div className="hf-mono" style={{ fontSize: 11, color: on ? H.pink : H.ink2 }}>Q{m.q}</div>
                  <div style={{ fontSize: 8, marginTop: 2, color: m.essay ? H.pink : H.ink3, fontWeight: 700, letterSpacing: '.2px' }}>{m.el}·{m.demand}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((stu, ri) => {
            const rowSel = selRows.includes(stu.id);
            const isDup = dirty && stu.id === dupId && ri > 0; // second occurrence flagged
            const bg = rowSel ? H.pinkSoft2 : isDup ? H.badSoft : H.paper;
            return (
              <tr key={ri} className="hf-hover">
                {[[stu.id, W.id, L.id, 'mono'], [stu.n, W.name, L.name, ''], [stu.c, W.cohort, L.cohort, 'mono']].map(([v, w, l, mono], ci) => (
                  <td key={ci} className={`hf-td ${mono ? 'hf-mono' : ''}`} style={{ ...stickyTd(l, w), background: bg, fontSize: ci === 1 ? 12.5 : 11.5, fontWeight: ci === 1 ? 600 : 400, color: ci === 0 ? H.ink2 : H.ink, boxShadow: ci === 2 ? `2px 0 0 ${H.line2}` : 'none', borderRight: ci === 2 ? `1px solid ${H.line2}` : 'none', whiteSpace: 'nowrap' }}>
                    {ci === 0 && isDup ? <span style={{ color: H.bad, fontWeight: 700 }}>{v}</span> : v}
                  </td>
                ))}
                {dirty && <td className="hf-td hf-mono" style={{ background: bg, textAlign: 'center', fontSize: 11, color: H.ink3 }}>—</td>}
                {meta.map(m => {
                  let val = cellVal(seedOf(stu.id), m.q, stu.ability, m.demand);
                  // inject an out-of-range value on the cleaning view
                  const oor = dirty && stu.id === '80427' && m.q === 5;
                  const colSel = selCols.includes(m.q);
                  return (
                    <td key={m.q} className="hf-mono" style={{ textAlign: 'center', padding: '10px 4px', borderBottom: `1px solid ${H.line}`, background: oor ? H.warnSoft : colSel ? H.pinkSoft2 : bg, color: oor ? H.warn : val === 1 ? H.ink : val === 0 ? H.ink3 : H.line2, fontWeight: oor ? 700 : val === 1 ? 600 : 400, fontSize: 12 }}>
                      {oor ? '7' : val}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

Object.assign(window, { HFRONT_STAGES, DEMAND, SUBJECTS, subjBy, COHORT, itemMeta, cellVal, seedOf, rawScore, SubjectChips, SummaryBand, Breakdown, RawTable });
