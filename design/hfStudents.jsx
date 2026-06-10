// hfStudents.jsx — New workflow screens for G12++ (Alsama brand)
//  · Screen 1: Per-student technical exclusions  (HFStudentExclusions)
//  · Screen 2: Distinction safeguard             (HFDistinction)
// Both continue the existing hf.jsx primitives + pipeline. Per-student scope is
// kept visually distinct from the cohort-wide item exclusion on the review screen.

// ── small bits ───────────────────────────────────────────────────
const first = (n) => n.split(' ')[0];
const inits = (n) => n.split(' ').map(w => w[0]).slice(0, 2).join('');

function Bolt({ color = H.ink3, size = 13 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }}><path d="M8.6 2L4 9h3.4L7 14l4.6-7H8z"/></svg>;
}

// tiny grid that shows the SCOPE difference: a struck column (cohort) vs one cell (student)
function ScopeGrid({ mode }) {
  const cols = 5, rows = 4, cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const colHi = mode === 'column' && c === 2;
    const cellHi = mode === 'cell' && c === 2 && r === 1;
    cells.push(<span key={r + '-' + c} style={{ width: 8, height: 8, borderRadius: 2,
      background: colHi ? H.badSoft : cellHi ? H.pink : H.tint2,
      border: `1px solid ${colHi ? H.bad : cellHi ? H.pink : 'transparent'}` }} />);
  }
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},8px)`, gap: 3, flex: '0 0 auto' }}>{cells}</div>;
}

function ScopeLegend() {
  return (
    <div className="hf-card" style={{ padding: '13px 16px' }}>
      <span className="hf-lbl">Two kinds of exclusion — keep them apart</span>
      <div className="hf-row" style={{ gap: 14, marginTop: 11, alignItems: 'stretch' }}>
        <div className="hf-row" style={{ gap: 12, flex: 1, padding: '10px 13px', border: `1px solid ${H.line2}`, borderRadius: 10, background: H.canvas }}>
          <ScopeGrid mode="column" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Cohort item exclusion</div>
            <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 1 }}>On <b style={{ color: H.ink }}>Item review</b> — drops a question for <b style={{ color: H.ink }}>every</b> student.</div>
          </div>
        </div>
        <div className="hf-row" style={{ gap: 12, flex: 1, padding: '10px 13px', border: `1.5px solid ${H.pink}`, borderRadius: 10, background: H.pinkSoft2 }}>
          <ScopeGrid mode="cell" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: H.pink }}>Per-student exclusion — this step</div>
            <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 1 }}>Drops one question for <b style={{ color: H.pink }}>one</b> student only. The rest keep it.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── incident data (sourced from the technical-errors file uploaded at Ingest) ──
const INCIDENTS = [
  { sid: '80412', sn: 'Aisha N.', q: 'Q15', asm: 'Applicable Math', dem: 'Apply', text: 'Solve for x:  3x − 7 = 2x + 5', err: 'Calculator tool froze mid-question; ~4 min lost', d: 'excluded', reason: 'Confirmed technical fault', by: 'Sami Haddad', at: '15:10' },
  { sid: '80412', sn: 'Aisha N.', q: 'Q21', asm: 'Applicable Math', dem: 'Recall', text: 'Read the value at the dashed line on the graph.', err: 'Graph image failed to load on first attempt', d: 'await', open: true },
  { sid: '80413', sn: 'Omar F.', q: 'Q07', asm: 'English 2nd Lang', dem: 'Apply', text: 'Choose the word that best completes the sentence.', err: 'Audio clip would not play (listening item)', d: 'await' },
  { sid: '80414', sn: 'Lena M.', q: 'Q33', asm: 'Arabic 1st Lang', dem: 'Reason', rtl: true, text: 'اقرأ الفقرة ثم أجب عن السؤال التالي.', err: 'النص العربي لم يظهر بشكل صحيح أثناء الاختبار', d: 'await' },
  { sid: '80421', sn: 'Maya H.', q: 'Q12', asm: 'Applicable Math', dem: 'Recall', text: 'Estimate 19.8 × 4.1 without a calculator.', err: 'Power outage in room B; session paused 8 min', d: 'excluded', reason: 'Power outage', by: 'Sami Haddad', at: '15:14' },
  { sid: '80440', sn: 'Karim D.', q: 'Q23', asm: 'Applicable Math', dem: 'Reason', text: 'Two coins are tossed. P(at least one head)?', err: 'Tablet battery died; resumed on a new device', d: 'kept', by: 'Sami Haddad', at: '15:20' },
];
const RESOLVED = {
  Q21: { d: 'excluded', reason: 'Network / loading failure', by: 'Rana Mansour', at: '16:38' },
  Q07: { d: 'kept', by: 'Rana Mansour', at: '16:40', note: 'audio confirmed working on review' },
  Q33: { d: 'excluded', reason: 'Confirmed technical fault', by: 'Rana Mansour', at: '16:42' },
};

function AsmTag({ asm, rtl }) {
  return <span className="hf-mono" style={{ fontSize: 9.5, color: H.ink3, border: `1px solid ${H.line2}`, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{asm}{rtl && ' · RTL'}</span>;
}

// the decision control — the per-student scope is unmistakable (pink, "for X only", mini avatar)
function Decision({ inc }) {
  if (inc.d === 'excluded') {
    return (
      <div className="hf-col" style={{ gap: 5, alignItems: 'flex-end', textAlign: 'right' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px 5px 6px', borderRadius: 999, background: H.pink, color: '#fff', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
          <span style={{ width: 17, height: 17, borderRadius: 999, background: 'rgba(255,255,255,.22)', fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{inits(inc.sn)}</span>
          Excluded for {first(inc.sn)} only
        </span>
        <span className="hf-sub" style={{ fontSize: 10.5 }}>{inc.reason} · {inc.by} · {inc.at}</span>
        <div className="hf-row" style={{ gap: 8 }}>
          <span className="hf-row" style={{ gap: 4, fontSize: 10, color: H.ink3 }}><HIco name="lock" size={10} color={H.ink3} />logged</span>
          <HBtn variant="ghost" style={{ fontSize: 10.5, padding: '3px 7px' }}>Undo</HBtn>
        </div>
      </div>
    );
  }
  if (inc.d === 'kept') {
    return (
      <div className="hf-col" style={{ gap: 5, alignItems: 'flex-end', textAlign: 'right' }}>
        <HBadge tone="neutral"><HMark kind="pass" size={11} />Kept · scored normally</HBadge>
        <span className="hf-sub" style={{ fontSize: 10.5 }}>{inc.by} · {inc.at}{inc.note ? ' · ' + inc.note : ''}</span>
        <HBtn variant="ghost" style={{ fontSize: 10.5, padding: '3px 7px' }}>Change</HBtn>
      </div>
    );
  }
  if (inc.open) {
    return (
      <div className="hf-card" style={{ padding: '12px 13px', width: 286, borderColor: H.pink, boxShadow: '0 8px 24px -12px rgba(193,44,104,.4)' }}>
        <div className="hf-lbl" style={{ color: H.pink, marginBottom: 9 }}>Exclude {inc.q} for {inc.sn} only</div>
        <div className="hf-col" style={{ gap: 2 }}>
          {[['Confirmed technical fault', true], ['Device / hardware failure', false], ['Power outage', false], ['Network / loading failure', false], ['Other…', false]].map(([r, on], i) => (
            <label key={i} className="hf-row" style={{ gap: 8, padding: '5px 4px', cursor: 'pointer' }}>
              <span style={{ width: 14, height: 14, borderRadius: 999, flex: '0 0 auto', border: `1.5px solid ${on ? H.pink : H.line2}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{on && <span style={{ width: 7, height: 7, borderRadius: 999, background: H.pink }} />}</span>
              <span style={{ fontSize: 12, fontWeight: on ? 700 : 500, color: on ? H.ink : H.ink2 }}>{r}</span>
            </label>
          ))}
        </div>
        <div className="hf-row" style={{ gap: 7, marginTop: 11 }}>
          <HBtn variant="pri" style={{ fontSize: 11 }}>Confirm exclusion</HBtn>
          <HBtn variant="ghost" style={{ fontSize: 11 }}>Cancel</HBtn>
        </div>
      </div>
    );
  }
  return (
    <div className="hf-col" style={{ gap: 6, alignItems: 'flex-end', textAlign: 'right' }}>
      <div className="hf-row" style={{ gap: 7 }}>
        <HBtn variant="pri" style={{ fontSize: 11.5 }}>Exclude for {first(inc.sn)}</HBtn>
        <HBtn style={{ fontSize: 11.5 }}>Keep</HBtn>
      </div>
      <span className="hf-sub" style={{ fontSize: 10.5 }}>excludes this one question for {first(inc.sn)} only</span>
    </div>
  );
}

function IncidentRow({ inc, showStudent, last }) {
  return (
    <div className="hf-row" style={{ padding: '14px 16px', gap: 16, alignItems: 'flex-start', borderBottom: last ? 'none' : `1px solid ${H.line}`, background: inc.d === 'excluded' ? H.pinkSoft2 : 'transparent' }}>
      <div className="hf-col" style={{ flex: 1, gap: 7, minWidth: 0 }}>
        <div className="hf-row" style={{ gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
          {showStudent && <span className="hf-row" style={{ gap: 7 }}><HAvatar name={inc.sn} size={22} /><span style={{ fontSize: 12.5, fontWeight: 700 }}>{inc.sn}</span><span className="hf-mono" style={{ fontSize: 10.5, color: H.ink3 }}>{inc.sid}</span></span>}
          <span className="hf-mono" style={{ fontSize: 12, fontWeight: 700 }}>{inc.q}</span>
          <AsmTag asm={inc.asm} rtl={inc.rtl} />
          <span className="hf-chip" style={{ fontSize: 10.5, padding: '2px 9px' }}>{inc.dem}</span>
        </div>
        <div style={{ fontSize: 12.5, color: H.ink, textWrap: 'pretty' }} dir={inc.rtl ? 'rtl' : 'ltr'}>{inc.text}</div>
        <div className="hf-row" style={{ gap: 7, alignItems: 'center', flexWrap: 'wrap' }} dir={inc.rtl ? 'rtl' : 'ltr'}>
          <Bolt color={H.warn} />
          <span style={{ fontSize: 11.5, color: H.ink2 }}>{inc.err}</span>
          <span className="hf-mono" style={{ fontSize: 9.5, color: H.ink3, border: `1px solid ${H.line2}`, padding: '0 5px', borderRadius: 4 }}>from faults file</span>
        </div>
      </div>
      <div style={{ flex: '0 0 auto' }}><Decision inc={inc} /></div>
    </div>
  );
}

function HFStudentExclusions({ state = 'awaiting' }) {
  const [grp, setGrp] = React.useState('student');
  const empty = state === 'empty';

  // resolve "await" rows for the resolved state
  const list = INCIDENTS.map(i => state === 'resolved' && i.d === 'await' ? { ...i, ...RESOLVED[i.q], open: false } : i);
  const nExcl = list.filter(i => i.d === 'excluded').length;
  const nKept = list.filter(i => i.d === 'kept').length;
  const nAwait = list.filter(i => i.d === 'await').length;
  const nStud = new Set(list.map(i => i.sid)).size;

  // grouping
  const groups = [];
  const key = (i) => grp === 'student' ? i.sid : i.q + '·' + i.asm;
  const seen = {};
  list.forEach(i => { const k = key(i); if (!seen[k]) { seen[k] = { items: [], head: i }; groups.push(seen[k]); } seen[k].items.push(i); });

  const stageAction = empty
    ? <HBtn variant="pri">Skip — nothing to review<HIco name="arrow" color="#fff" /></HBtn>
    : <div className="hf-row" style={{ gap: 13 }}>{nAwait > 0 && <span className="hf-sub" style={{ fontSize: 11.5 }}>{nAwait} still awaiting — you can decide later</span>}<HBtn variant="pri">Continue to scoring<HIco name="arrow" color="#fff" /></HBtn></div>;

  return (
    <HShell active="Cycles" stage={3} done={3}
      crumb="Cycles  ›  May 2026  ›  Student review"
      actions={<HBtn variant="ghost"><HIco name="doc" />Audit log</HBtn>}
      stageAction={stageAction}>

      {empty ? (
        <div className="hf-col" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
          <div className="hf-col" style={{ alignItems: 'center', gap: 16, maxWidth: 540, textAlign: 'center' }}>
            <div style={{ width: 58, height: 58, borderRadius: 999, border: `1.5px dashed ${H.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: H.canvas }}><Bolt color={H.ink3} size={24} /></div>
            <div className="hf-h1">Nothing to review here</div>
            <div className="hf-sub" style={{ fontSize: 13.5, lineHeight: 1.55 }}>No technical-errors file was added for the May 2026 sitting, so there are no per-student faults to work through. This is an <b style={{ color: H.ink }}>optional</b> step — you can move straight to scoring.</div>
            <div className="hf-row" style={{ gap: 10, marginTop: 4 }}>
              <HBtn variant="pri">Skip to scoring<HIco name="arrow" color="#fff" /></HBtn>
              <HBtn><HIco name="upload" />Add a technical-errors file</HBtn>
            </div>
            <div className="hf-row" style={{ gap: 7, marginTop: 8, color: H.ink3 }}><HIco name="lock" size={12} color={H.ink3} /><span className="hf-sub" style={{ fontSize: 11.5 }}>This step never blocks the pipeline.</span></div>
          </div>
        </div>
      ) : (
        <div className="hf-col" style={{ flex: 1, minHeight: 0 }}>
          {/* header band */}
          <div className="hf-col" style={{ padding: '22px 28px 16px', gap: 16, borderBottom: `1px solid ${H.line}`, background: H.paper }}>
            <div className="hf-row" style={{ gap: 24, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="hf-h1">Per-student technical exclusions</div>
                <div className="hf-sub" style={{ marginTop: 7, maxWidth: 620 }}>Work through faults that hit individual students on individual questions. Excluding here removes that one question from that one student's score — everyone else keeps it.</div>
              </div>
            </div>

            {state === 'resolved' && (
              <div className="hf-card" style={{ padding: '12px 16px', background: H.goodSoft, borderColor: H.good, display: 'flex', gap: 11, alignItems: 'center' }}>
                <HMark kind="pass" size={17} />
                <span style={{ fontSize: 13 }}><b>All {list.length} incidents reviewed.</b> {nExcl} questions excluded for individual students, {nKept} kept. Scores are ready to compute.</span>
              </div>
            )}

            {/* stats */}
            <div className="hf-row" style={{ gap: 40 }}>
              <HStat n={list.length} label="Incidents" sub="from faults file" />
              <HStat n={nExcl} label="Per-student exclusions" accent sub="applied" />
              <HStat n={nKept} label="Kept" sub="no fault counted" />
              <HStat n={nAwait} label="Awaiting decision" sub={nAwait ? 'needs review' : 'all clear'} />
              <HStat n={nStud} label="Students affected" />
            </div>
          </div>

          {/* controls */}
          <div className="hf-row" style={{ gap: 11, padding: '12px 28px', borderBottom: `1px solid ${H.line}`, background: H.paper, flexWrap: 'wrap' }}>
            <span className="hf-lbl" style={{ marginRight: 1 }}>Group by</span>
            <div className="hf-row" style={{ border: `1px solid ${H.line2}`, borderRadius: 8, overflow: 'hidden' }}>
              {['student', 'question'].map((g, i) => (
                <span key={g} onClick={() => setGrp(g)} style={{ padding: '6px 13px', fontSize: 11.5, fontWeight: grp === g ? 700 : 500, cursor: 'pointer', textTransform: 'capitalize', background: grp === g ? H.pinkSoft : H.paper, color: grp === g ? H.pink : H.ink2, borderLeft: i ? `1px solid ${H.line2}` : 'none' }}>{g}</span>
              ))}
            </div>
            <span style={{ width: 1, height: 20, background: H.line2, margin: '0 4px' }} />
            <span className="hf-field" style={{ width: 210 }}><HIco name="search" color={H.ink3} />Filter by student or ID</span>
            <HChip>All assessments<HIco name="chev" /></HChip>
            <HChip on>Awaiting</HChip><HChip>Resolved</HChip>
            <div style={{ flex: 1 }} />
            <span className="hf-sub">{list.length} incidents · {nAwait} awaiting</span>
          </div>

          {/* list */}
          <div style={{ flex: 1, overflow: 'auto', background: H.canvas, padding: '18px 28px' }}>
            <div className="hf-card" style={{ overflow: 'hidden' }}>
              {groups.map((g, gi) => (
                <React.Fragment key={gi}>
                  <div className="hf-row" style={{ padding: '10px 16px', gap: 11, background: H.tint, borderBottom: `1px solid ${H.line2}`, borderTop: gi ? `1px solid ${H.line2}` : 'none' }}>
                    {grp === 'student' ? (
                      <>
                        <HAvatar name={g.head.sn} size={26} tone="pink" />
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{g.head.sn}</span>
                        <span className="hf-mono" style={{ fontSize: 11, color: H.ink3 }}>{g.head.sid}</span>
                        <span style={{ flex: 1 }} />
                        <span className="hf-sub" style={{ fontSize: 11.5 }}>{g.items.length} incident{g.items.length > 1 ? 's' : ''} · {g.items.filter(i => i.d === 'excluded').length} excluded</span>
                      </>
                    ) : (
                      <>
                        <span className="hf-mono" style={{ fontSize: 12.5, fontWeight: 700 }}>{g.head.q}</span>
                        <AsmTag asm={g.head.asm} rtl={g.head.rtl} />
                        <span style={{ fontSize: 12, color: H.ink2, textWrap: 'pretty' }} dir={g.head.rtl ? 'rtl' : 'ltr'}>{g.head.text}</span>
                        <span style={{ flex: 1 }} />
                        <span className="hf-sub" style={{ fontSize: 11.5 }}>{g.items.length} student{g.items.length > 1 ? 's' : ''} affected</span>
                      </>
                    )}
                  </div>
                  {g.items.map((inc, ii) => <IncidentRow key={ii} inc={inc} showStudent={grp === 'question'} last={ii === g.items.length - 1} />)}
                </React.Fragment>
              ))}
            </div>
            <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 13, display: 'flex', gap: 7, alignItems: 'center' }}><HIco name="lock" size={12} color={H.ink3} />Every decision is attributed and written to the audit log. Re-opening the cycle is required to change a locked one.</div>
          </div>
        </div>
      )}
    </HShell>
  );
}

// ───────────────────────────────────────────────────────────────────
// Screen 2 — Distinction safeguard
// ───────────────────────────────────────────────────────────────────
const THRESHOLD = 3;
function AwardPill({ level, dim, strike }) {
  const isDist = level === 'Distinction';
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
    background: isDist ? (dim ? H.tint2 : H.pink) : H.paper,
    color: isDist ? (dim ? H.ink3 : '#fff') : H.slate,
    border: isDist ? 'none' : `1.5px solid ${H.slate2}`,
    textDecoration: strike ? 'line-through' : 'none', opacity: strike ? 0.55 : 1 }}>{level}</span>;
}
function Pips({ n, t = THRESHOLD }) {
  const ok = n >= t;
  return (
    <div className="hf-row" style={{ gap: 9 }}>
      <div className="hf-row" style={{ gap: 3 }}>
        {Array.from({ length: t }).map((_, i) => (
          <span key={i} style={{ width: 9, height: 9, borderRadius: 999, flex: '0 0 auto',
            background: i < Math.min(n, t) ? (ok ? H.good : H.pink) : H.paper,
            border: `1.5px solid ${i < Math.min(n, t) ? (ok ? H.good : H.pink) : (i < t ? H.line2 : H.line2)}` }} />
        ))}
      </div>
      <span className="hf-mono" style={{ fontSize: 12.5, fontWeight: 700, color: ok ? H.good : H.pink }}>{n}<span style={{ color: H.ink3, fontWeight: 500 }}>/{t}</span></span>
    </div>
  );
}

const DSTUD = [
  { id: '80445', n: 'Hana M.', ans: 5, res: 'pass' },
  { id: '80412', n: 'Aisha N.', ans: 4, res: 'pass' },
  { id: '80416', n: 'Sara T.', ans: 3, res: 'pass' },
  { id: '80433', n: 'Noor S.', ans: 3, res: 'pass' },
  { id: '80421', n: 'Maya H.', ans: 2, res: 'capped' },
  { id: '80440', n: 'Karim D.', ans: 2, res: 'override', reason: 'Two top-difficulty items excluded for confirmed tech fault (Student review)', by: 'Rana Mansour' },
  { id: '80430', n: 'Ziad A.', ans: 1, res: 'capped' },
];

function HFDistinction({ state = 'capped' }) {
  const rows = state === 'allpass' ? DSTUD.map(s => ({ ...s, ans: Math.max(s.ans, THRESHOLD), res: 'pass' })) : DSTUD;
  const nCap = rows.filter(r => r.res === 'capped').length;
  const nOver = rows.filter(r => r.res === 'override').length;
  const nPass = rows.filter(r => r.res === 'pass').length;

  return (
    <HShell active="Cycles" stage={6} done={6}
      crumb="Cycles  ›  May 2026  ›  Grades & sign-off  ›  Distinction safeguard"
      actions={<HBtn variant="ghost"><HIco name="doc" />Audit log</HBtn>}
      stageAction={<HBtn variant="pri">{nCap ? 'Confirm caps & continue' : 'Confirm & continue'}<HIco name="arrow" color="#fff" /></HBtn>}>

      {/* assessment tabs (top-difficulty questions are per assessment) */}
      <div className="hf-row" style={{ flex: '0 0 auto', borderBottom: `1px solid ${H.line}`, padding: '0 24px', gap: 4, background: H.paper }}>
        {HASSESS.map((a, i) => (
          <div key={a} style={{ padding: '13px 15px', fontSize: 13, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? H.pink : H.ink2, borderBottom: `3px solid ${i === 0 ? H.pink : 'transparent'}`, cursor: 'pointer' }}>
            {a}{i === 3 && <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 6 }}>RTL</span>}
          </div>
        ))}
      </div>

      <div className="hf-col" style={{ padding: '24px 30px', gap: 18, flex: 1, minHeight: 0 }}>
        <div>
          <div className="hf-h1">Distinction safeguard</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>A Distinction is only awarded when a student actually attempted enough of the hardest questions. This runs on the provisional awards from boundaries.</div>
        </div>

        {/* the rule */}
        <div className="hf-row" style={{ borderRadius: 12, background: H.slate, color: H.cream, padding: '18px 22px', gap: 22, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div className="hf-lbl" style={{ color: 'rgba(233,237,241,.55)' }}>The rule</div>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: '#fff', marginTop: 6, lineHeight: 1.4 }}>A Distinction needs at least {THRESHOLD} top-difficulty questions answered.</div>
            <div style={{ fontSize: 12.5, color: 'rgba(233,237,241,.82)', marginTop: 6, lineHeight: 1.5 }}>Top-difficulty = <b style={{ color: '#fff' }}>Reason</b> demand · 8 such questions in Applicable Math. Fall short and the award caps to <b style={{ color: '#fff' }}>Advanced achievement</b>.</div>
          </div>
          <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(233,237,241,.18)' }} />
          <div className="hf-col" style={{ alignItems: 'center', gap: 7, flex: '0 0 auto' }}>
            <span style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(255,255,255,.1)', border: '1.5px solid rgba(255,255,255,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: H.mono, fontSize: 26, fontWeight: 700, color: '#fff' }}>{THRESHOLD}</span>
            <span style={{ fontSize: 10.5, color: 'rgba(233,237,241,.7)' }}>threshold</span>
            <span className="hf-row" style={{ gap: 5, fontSize: 10.5, color: '#fff', fontWeight: 600, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,.4)', paddingBottom: 1 }}>Set in Settings<HIco name="arrow" size={11} color="#fff" /></span>
          </div>
        </div>

        {state === 'allpass' && (
          <div className="hf-card" style={{ padding: '13px 17px', background: H.goodSoft, borderColor: H.good, display: 'flex', gap: 11, alignItems: 'center' }}>
            <HMark kind="pass" size={18} />
            <span style={{ fontSize: 13 }}><b>Every student in line for a Distinction met the rule.</b> Nothing to cap — confirm to continue to sign-off.</span>
          </div>
        )}

        {/* stats */}
        <div className="hf-row" style={{ gap: 44 }}>
          <HStat n="41" label="In line for Distinction" />
          <HStat n={state === 'allpass' ? 41 : 33} label="Meet the rule" />
          <HStat n={state === 'allpass' ? 0 : 7} label="Capped" accent={state !== 'allpass'} sub={state === 'allpass' ? 'none' : '→ Advanced achievement'} />
          <HStat n={state === 'allpass' ? 0 : 1} label="Overridden" sub="by a Lead" />
        </div>

        {/* table */}
        <div className="hf-card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="hf-th">Participant</th>
              <th className="hf-th">Top-difficulty answered</th>
              <th className="hf-th">Meets rule</th>
              <th className="hf-th">Provisional award</th>
              <th className="hf-th">Result</th>
              <th className="hf-th" style={{ textAlign: 'right' }}></th>
            </tr></thead>
            <tbody>
              {rows.map((s, i) => {
                const pass = s.res === 'pass';
                const over = s.res === 'override';
                return (
                  <tr key={i} className="hf-hover" style={{ background: s.res === 'capped' ? H.warnSoft : over ? H.pinkSoft2 : 'transparent' }}>
                    <td className="hf-td"><div className="hf-row" style={{ gap: 11 }}><HAvatar name={s.n} size={30} /><div><div style={{ fontWeight: 600, fontSize: 13 }}>{s.n}</div><div className="hf-mono hf-sub" style={{ fontSize: 11 }}>{s.id}</div></div></div></td>
                    <td className="hf-td"><Pips n={s.ans} /></td>
                    <td className="hf-td">
                      {pass
                        ? <span className="hf-row" style={{ gap: 7 }}><HMark kind="pass" size={15} /><span style={{ fontSize: 12, fontWeight: 600, color: H.good }}>Meets rule</span></span>
                        : <span className="hf-row" style={{ gap: 7 }}><HMark kind="fail" size={15} /><span style={{ fontSize: 12, fontWeight: 600, color: H.bad }}>Short by {THRESHOLD - s.ans}</span></span>}
                    </td>
                    <td className="hf-td"><AwardPill level="Distinction" dim /></td>
                    <td className="hf-td">
                      {pass && <AwardPill level="Distinction" />}
                      {s.res === 'capped' && (
                        <div className="hf-row" style={{ gap: 9, alignItems: 'center' }}>
                          <AwardPill level="Distinction" strike />
                          <HIco name="arrow" size={13} color={H.warn} />
                          <AwardPill level="Advanced achievement" />
                          <HBadge tone="warn">Capped</HBadge>
                        </div>
                      )}
                      {over && (
                        <div className="hf-col" style={{ gap: 4 }}>
                          <div className="hf-row" style={{ gap: 9, alignItems: 'center' }}>
                            <AwardPill level="Distinction" />
                            <HBadge tone="accent"><HIco name="lock" size={11} color={H.pink} />Cap overridden · Lead</HBadge>
                          </div>
                          <span className="hf-sub" style={{ fontSize: 10.5, maxWidth: 320, textWrap: 'pretty' }}>{s.reason} · {s.by}</span>
                        </div>
                      )}
                    </td>
                    <td className="hf-td" style={{ textAlign: 'right' }}>
                      {s.res === 'capped' && <HBtn variant="ghost" style={{ fontSize: 11.5 }}>Override…</HBtn>}
                      {over && <HBtn variant="ghost" style={{ fontSize: 11.5 }}>Undo</HBtn>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="hf-row" style={{ gap: 7, alignItems: 'center' }}>
          <span className="hf-sub" style={{ fontSize: 11.5 }}>Showing 7 of 41 in line · sorted by closest to the line</span>
          <span style={{ flex: 1 }} />
          <span className="hf-sub" style={{ fontSize: 11.5, display: 'flex', gap: 7, alignItems: 'center' }}><HIco name="lock" size={12} color={H.ink3} />Every cap and override is attributed and audit-logged. Only a Lead can override.</span>
        </div>
      </div>
    </HShell>
  );
}

Object.assign(window, { HFStudentExclusions, HFDistinction, ScopeLegend });
