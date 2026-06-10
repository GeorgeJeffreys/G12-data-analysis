// hfB.jsx — Hi-fi screens: Item review & scoring (hero) + Grades & sign-off

const HASSESS = ['Applicable Math', 'English 2nd Lang', 'Scientific Thinking', 'Arabic 1st Lang', 'Life Skills'];

function HFReview() {
  const items = [
    { q: 'Q07', t: 'A train travels 240 km in 3 hours. Find its average speed.', el: 'Number', sub: 'Rates & ratio', dem: 'Apply', qv: 84, p: '.71', it: '.42', pb: '.38', d: '.51' },
    { q: 'Q08', t: 'Which net folds into the cube shown?', el: 'Geometry', sub: 'Spatial reasoning', dem: 'Apply', qv: 78, p: '.63', it: '.39', pb: '.36', d: '.47' },
    { q: 'Q12', t: 'Estimate 19.8 × 4.1 without a calculator.', el: 'Number', sub: 'Estimation', dem: 'Recall', qv: 41, p: '.88', it: '.18', pb: '.15', d: '.21' },
    { q: 'Q15', t: 'Solve for x:  3x − 7 = 2x + 5', el: 'Algebra', sub: 'Linear equations', dem: 'Apply', qv: 88, p: '.55', it: '.48', pb: '.44', d: '.58' },
    { q: 'Q21', t: 'Read the value at the dashed line on the graph.', el: 'Statistics', sub: 'Interpreting data', dem: 'Recall', qv: 44, p: '.34', it: '.22', pb: '.19', d: '.24' },
    { q: 'Q23', t: 'Two coins are tossed. P(at least one head)?', el: 'Statistics', sub: 'Probability', dem: 'Reason', qv: 8, p: '.19', it: '-.04', pb: '-.06', d: '.02', excl: true },
    { q: 'Q28', t: 'A recipe for 4 needs 300 g flour. Amount for 7?', el: 'Number', sub: 'Rates & ratio', dem: 'Apply', qv: 80, p: '.61', it: '.41', pb: '.37', d: '.49' },
  ];
  const Hc = (t, hint) => <th className="hf-th" style={{ textAlign: 'right', padding: '10px 8px' }} title={hint}>{t}</th>;
  const num = (x) => <span className="hf-mono" style={{ fontSize: 12.5, color: parseFloat(x) < .2 ? H.bad : H.ink }}>{x}</span>;
  return (
    <HShell active="Cycles" stage={2} done={2}
      crumb="Cycles  ›  May 2026  ›  Item review & scoring"
      actions={<HBtn variant="ghost">Filters</HBtn>}
      stageAction={<HBtn variant="pri">Continue to boundaries<HIco name="arrow" color="#fff" /></HBtn>}>
      <div className="hf-col" style={{ flex: 1, minHeight: 0 }}>
        <div className="hf-row" style={{ flex: '0 0 auto', borderBottom: `1px solid ${H.line}`, padding: '0 24px', gap: 4, background: H.paper }}>
          {HASSESS.map((a, i) => (
            <div key={a} style={{ padding: '13px 15px', fontSize: 13, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? H.pink : H.ink2, borderBottom: `3px solid ${i === 0 ? H.pink : 'transparent'}`, cursor: 'pointer' }}>
              {a}{i === 3 && <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 6 }}>RTL</span>}
            </div>
          ))}
        </div>

        <div className="hf-row" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
          <div className="hf-col" style={{ flex: 1, minWidth: 0 }}>
            <div className="hf-row" style={{ gap: 36, padding: '18px 26px', borderBottom: `1px solid ${H.line}`, background: H.paper }}>
              <HStat n="48" label="Items" />
              <HStat n="3" label="Excluded" sub="recompute on" />
              <HStat n=".58" label="Median difficulty" />
              <HStat n="61.4%" label="Cohort mean" />
              <div style={{ flex: 1 }} />
              <span className="hf-field" style={{ width: 220, alignSelf: 'center' }}><HIco name="search" color={H.ink3} />search question text</span>
            </div>
            <div className="hf-row" style={{ gap: 9, padding: '12px 26px', borderBottom: `1px solid ${H.line}`, flexWrap: 'wrap', background: H.paper }}>
              <span className="hf-lbl" style={{ marginRight: 2 }}>Filter</span>
              <HChip on>All quality</HChip><HChip>Review</HChip><HChip>Poor</HChip>
              <span style={{ width: 1, height: 18, background: H.line2, margin: '0 4px' }} />
              <HChip>Element<HIco name="chev" /></HChip><HChip>Demand<HIco name="chev" /></HChip>
              <div style={{ flex: 1 }} />
              <span className="hf-sub">Sort: <span style={{ fontWeight: 700, color: H.ink }}>discrimination ↑</span></span>
            </div>

            <div style={{ flex: 1, overflow: 'hidden', background: H.paper }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th className="hf-th">Item</th><th className="hf-th">Curriculum</th><th className="hf-th">Demand</th><th className="hf-th">Quality</th>
                  {Hc('p-val', 'proportion correct')}{Hc('it-r', 'item-total correlation')}{Hc('pt-bis', 'point-biserial')}{Hc('disc', 'discrimination')}<th className="hf-th"></th>
                </tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className={it.excl ? '' : 'hf-hover'} style={{ background: it.excl ? H.tint : 'transparent', opacity: it.excl ? .62 : 1 }}>
                      <td className="hf-td" style={{ verticalAlign: 'top', maxWidth: 310 }}>
                        <div className="hf-row" style={{ gap: 8, alignItems: 'baseline' }}>
                          <span className="hf-mono" style={{ fontWeight: 700, fontSize: 12 }}>{it.q}</span>
                          <span style={{ fontSize: 12.5, textDecoration: it.excl ? 'line-through' : 'none', textWrap: 'pretty' }}>{it.t}</span>
                        </div>
                      </td>
                      <td className="hf-td"><div style={{ fontSize: 12, fontWeight: 600 }}>{it.el}</div><div className="hf-sub" style={{ fontSize: 11 }}>{it.sub}</div></td>
                      <td className="hf-td"><span className="hf-chip" style={{ fontSize: 10.5, padding: '2px 9px' }}>{it.dem}</span></td>
                      <td className="hf-td"><HQuality v={it.qv} width={70} /></td>
                      <td className="hf-td" style={{ textAlign: 'right' }}>{num(it.p)}</td>
                      <td className="hf-td" style={{ textAlign: 'right' }}>{num(it.it)}</td>
                      <td className="hf-td" style={{ textAlign: 'right' }}>{num(it.pb)}</td>
                      <td className="hf-td" style={{ textAlign: 'right' }}>{num(it.d)}</td>
                      <td className="hf-td" style={{ textAlign: 'right' }}>
                        {it.excl
                          ? <div className="hf-col" style={{ alignItems: 'flex-end', gap: 1 }}><span className="hf-mono" style={{ fontSize: 10, color: H.bad, fontWeight: 700 }}>EXCLUDED</span><span className="hf-sub" style={{ fontSize: 10 }}>negative disc.</span></div>
                          : <HBtn variant="ghost" style={{ fontSize: 11.5, color: H.bad }}>Exclude…</HBtn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="hf-sub" style={{ padding: '13px 26px' }}>Showing 7 of 48 items · scroll for more</div>
            </div>
          </div>

          <div className="hf-col" style={{ width: 322, flex: '0 0 auto', borderLeft: `1px solid ${H.line2}`, background: H.paper, boxShadow: '-12px 0 28px -18px rgba(31,42,49,.20)', padding: '20px', gap: 22, overflow: 'hidden' }}>
            <div>
              <div className="hf-row" style={{ justifyContent: 'space-between', marginBottom: 11 }}>
                <span className="hf-lbl">Score distribution</span>
                <span className="hf-row" style={{ gap: 5, fontSize: 10, color: H.pink, fontWeight: 700 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: H.pink }} />LIVE</span>
              </div>
              <HDist h={94} />
              <div className="hf-sub" style={{ marginTop: 7 }}>Cohort mean 61.4% · σ 14.2</div>
            </div>
            <div><div className="hf-lbl" style={{ marginBottom: 11 }}>By curriculum element</div>
              <HBreakBars items={[{ k: 'Number', v: 14 }, { k: 'Algebra', v: 11 }, { k: 'Geometry', v: 9 }, { k: 'Statistics', v: 8 }, { k: 'Measure', v: 6 }]} /></div>
            <div><div className="hf-lbl" style={{ marginBottom: 11 }}>By demand level</div>
              <HBreakBars items={[{ k: 'Recall', v: 16 }, { k: 'Apply', v: 22 }, { k: 'Reason', v: 10 }]} /></div>
          </div>
        </div>
      </div>
    </HShell>
  );
}

function HFGrades() {
  const studs = [
    { id: '80412', n: 'Aisha N.', g: ['A', 'B', 'A', 'A', 'B'], o: 'A' },
    { id: '80413', n: 'Omar F.', g: ['C', 'C', 'B', 'C', 'C'], o: 'C' },
    { id: '80414', n: 'Lena M.', g: ['B', 'A', 'B', 'B', 'A'], o: 'B' },
    { id: '80415', n: 'Yusuf K.', g: ['D', 'C', 'D', 'C', 'C'], o: 'C' },
    { id: '80416', n: 'Sara T.', g: ['A', 'A', 'A', 'B', 'A'], o: 'A' },
    { id: '80417', n: 'Hadi R.', g: ['E', 'D', 'E', 'D', 'D'], o: 'D' },
  ];
  const GB = ({ g, big }) => <span style={{ width: big ? 30 : 23, height: big ? 30 : 23, border: `1px solid ${big ? H.pink : H.line2}`, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: H.mono, fontSize: big ? 14 : 11.5, background: big ? H.pink : H.paper, color: big ? '#fff' : H.ink }}>{g}</span>;
  return (
    <HShell active="Cycles" stage={6} done={6}
      crumb="Cycles  ›  May 2026  ›  Grades & sign-off"
      actions={<HBtn variant="ghost"><HIco name="doc" />Export CSV</HBtn>}
      stageAction={<HBtn variant="pri"><HIco name="lock" color="#fff" />Lock grades</HBtn>}>
      <div className="hf-col" style={{ padding: '26px 32px', gap: 20, flex: 1 }}>
        <div className="hf-row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div className="hf-h1">Grades & sign-off</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>Every student's section and overall grade. Review, then lock to publish.</div>
          </div>
          <div className="hf-card" style={{ padding: '13px 18px', display: 'flex', gap: 18, alignItems: 'center' }}>
            <span className="hf-lbl">Overall distribution</span>
            {[['A', 13], ['B', 24], ['C', 32], ['D', 20], ['E', 11]].map(([g, v]) => (
              <div key={g} className="hf-col" style={{ alignItems: 'center', gap: 5 }}>
                <div style={{ width: 20, height: 44, background: H.tint2, borderRadius: 4, display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ width: '100%', height: `${v * 2.2}%`, background: H.bar, borderRadius: 4 }} />
                </div>
                <span className="hf-mono" style={{ fontSize: 10, fontWeight: 700 }}>{g}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="hf-card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="hf-th">Participant</th>
              {HASSESS.map(a => <th key={a} className="hf-th" style={{ textAlign: 'center' }}>{a.split(' ')[0]}</th>)}
              <th className="hf-th" style={{ textAlign: 'center' }}>Overall</th>
            </tr></thead>
            <tbody>
              {studs.map((s, i) => (
                <tr key={i} className="hf-hover">
                  <td className="hf-td"><span className="hf-mono" style={{ fontSize: 11, color: H.ink3, marginRight: 10 }}>{s.id}</span><span style={{ fontWeight: 600, fontSize: 13 }}>{s.n}</span></td>
                  {s.g.map((g, j) => <td key={j} className="hf-td" style={{ textAlign: 'center' }}><GB g={g} /></td>)}
                  <td className="hf-td" style={{ textAlign: 'center' }}><GB g={s.o} big /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="hf-row" style={{ gap: 16, marginTop: 'auto' }}>
          <div className="hf-card" style={{ padding: '15px 19px', flex: 1, display: 'flex', gap: 13, alignItems: 'center', background: H.tint }}>
            <HMark kind="warn" size={18} />
            <span style={{ fontSize: 13 }}>Locking writes a signed, timestamped record and freezes all 5 assessments. Boundaries can't change afterward without re-opening the cycle.</span>
          </div>
          <HBtn variant="pri" style={{ padding: '13px 24px', fontSize: 13.5 }}><HIco name="lock" color="#fff" />Lock grades & sign off</HBtn>
        </div>
      </div>
    </HShell>
  );
}

Object.assign(window, { HFReview, HFGrades, HASSESS });
