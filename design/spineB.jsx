// spineB.jsx — Spine screens 4–6: Item review & scoring (hero), Grade boundaries, Grades & sign-off

const ASSESSMENTS = ['Applicable Math', 'English 2nd Lang', 'Scientific Thinking', 'Arabic 1st Lang', 'Life Skills'];

// ─── 04 · Item review & scoring  (the hero screen) ────────────────
function ScreenReview() {
  const items = [
    { q: 'Q07', t: 'A train travels 240 km in 3 hours. Find its average speed.', el: 'Number', sub: 'Rates & ratio', dem: 'Apply', qv: 84, p: '.71', it: '.42', pb: '.38', d: '.51' },
    { q: 'Q08', t: 'Which net folds into the cube shown?', el: 'Geometry', sub: 'Spatial reasoning', dem: 'Apply', qv: 78, p: '.63', it: '.39', pb: '.36', d: '.47' },
    { q: 'Q12', t: 'Estimate 19.8 × 4.1 without a calculator.', el: 'Number', sub: 'Estimation', dem: 'Recall', qv: 41, p: '.88', it: '.18', pb: '.15', d: '.21' },
    { q: 'Q15', t: 'Solve for x:  3x − 7 = 2x + 5', el: 'Algebra', sub: 'Linear equations', dem: 'Apply', qv: 88, p: '.55', it: '.48', pb: '.44', d: '.58' },
    { q: 'Q21', t: 'Read the value at the dashed line on the graph.', el: 'Statistics', sub: 'Interpreting data', dem: 'Recall', qv: 44, p: '.34', it: '.22', pb: '.19', d: '.24' },
    { q: 'Q23', t: 'Two coins are tossed. P(at least one head)?', el: 'Statistics', sub: 'Probability', dem: 'Reason', qv: 8, p: '.19', it: '-.04', pb: '-.06', d: '.02', excl: true },
    { q: 'Q28', t: 'A recipe for 4 needs 300 g flour. Amount for 7?', el: 'Number', sub: 'Rates & ratio', dem: 'Apply', qv: 80, p: '.61', it: '.41', pb: '.37', d: '.49' },
  ];
  const Hcell = (t, hint) => <th className="w-th" style={{ textAlign: 'right', padding: '9px 7px' }} title={hint}>{t}</th>;
  const num = (x) => <span className="w-mono" style={{ fontSize: 12, color: parseFloat(x) < .2 ? W.bad : W.ink }}>{x}</span>;
  return (
    <Shell active="Cycles" stage={2} done={2}
      crumb="Cycles  ›  May 2026  ›  Item review & scoring"
      actions={<><Btn variant="ghost">Filters</Btn><Btn variant="pri">Continue to boundaries →</Btn></>}>
      <div className="w-col" style={{ flex: 1, minHeight: 0 }}>
        {/* assessment tabs */}
        <div className="w-row" style={{ flex: '0 0 auto', borderBottom: `1px solid ${W.line}`, padding: '0 22px', gap: 2 }}>
          {ASSESSMENTS.map((a, i) => (
            <div key={a} style={{ padding: '11px 14px', fontSize: 12.5, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? W.accent : W.ink2, borderBottom: `2.5px solid ${i === 0 ? W.accent : 'transparent'}`, cursor: 'pointer' }}>
              {a}{i === 3 && <span className="w-mono" style={{ fontSize: 9, color: W.ink3, marginLeft: 6 }}>RTL</span>}
            </div>
          ))}
        </div>

        <div className="w-row" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
          <div className="w-col" style={{ flex: 1, minWidth: 0 }}>
            {/* headline numbers */}
            <div className="w-row" style={{ gap: 34, padding: '16px 24px', borderBottom: `1px solid ${W.line}` }}>
              <Stat n="48" label="Items" />
              <Stat n="3" label="Excluded" sub="recompute on" />
              <Stat n=".58" label="Median difficulty" />
              <Stat n="61.4%" label="Cohort mean" />
              <div style={{ flex: 1 }} />
              <Field value="search question text" w={210} icon={<Ico name="search" color={W.ink3} />} />
            </div>
            {/* filter / sort */}
            <div className="w-row" style={{ gap: 8, padding: '11px 24px', borderBottom: `1px solid ${W.line}`, flexWrap: 'wrap' }}>
              <span className="w-lbl" style={{ marginRight: 2 }}>Filter</span>
              <Chip on>All quality</Chip><Chip>Review</Chip><Chip>Poor</Chip>
              <span style={{ width: 1, height: 18, background: W.line2, margin: '0 4px' }} />
              <Chip>Element<Ico name="chev" /></Chip><Chip>Demand<Ico name="chev" /></Chip>
              <div style={{ flex: 1 }} />
              <span className="w-sub">Sort: <span style={{ fontWeight: 600, color: W.ink }}>discrimination ↑</span></span>
            </div>

            {/* dense item table */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th className="w-th">Item</th><th className="w-th">Curriculum</th><th className="w-th">Demand</th>
                  <th className="w-th">Quality</th>
                  {Hcell('p-val', 'proportion correct')}{Hcell('it-r', 'item-total correlation')}{Hcell('pt-bis', 'point-biserial')}{Hcell('disc', 'discrimination')}
                  <th className="w-th"></th>
                </tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} style={{ background: it.excl ? W.tint2 : 'transparent', opacity: it.excl ? .6 : 1 }}>
                      <td className="w-td" style={{ verticalAlign: 'top', maxWidth: 300 }}>
                        <div className="w-row" style={{ gap: 7, alignItems: 'baseline' }}>
                          <span className="w-mono" style={{ fontWeight: 700, fontSize: 12 }}>{it.q}</span>
                          <span style={{ fontSize: 12, textDecoration: it.excl ? 'line-through' : 'none', textWrap: 'pretty' }}>{it.t}</span>
                        </div>
                      </td>
                      <td className="w-td"><div style={{ fontSize: 11.5, fontWeight: 600 }}>{it.el}</div><div className="w-sub" style={{ fontSize: 10.5 }}>{it.sub}</div></td>
                      <td className="w-td"><span className="w-chip" style={{ fontSize: 10, padding: '2px 8px' }}>{it.dem}</span></td>
                      <td className="w-td"><QualityMeter v={it.qv} width={72} /></td>
                      <td className="w-td" style={{ textAlign: 'right' }}>{num(it.p)}</td>
                      <td className="w-td" style={{ textAlign: 'right' }}>{num(it.it)}</td>
                      <td className="w-td" style={{ textAlign: 'right' }}>{num(it.pb)}</td>
                      <td className="w-td" style={{ textAlign: 'right' }}>{num(it.d)}</td>
                      <td className="w-td" style={{ textAlign: 'right' }}>
                        {it.excl
                          ? <div className="w-col" style={{ alignItems: 'flex-end', gap: 1 }}><span className="w-mono" style={{ fontSize: 10, color: W.bad, fontWeight: 600 }}>EXCLUDED</span><span className="w-sub" style={{ fontSize: 10 }}>negative disc.</span></div>
                          : <Btn variant="ghost" style={{ fontSize: 11, color: W.bad }}>Exclude…</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="w-sub" style={{ padding: '12px 24px' }}>Showing 7 of 48 items · scroll for more</div>
            </div>
          </div>

          {/* right rail — live stats */}
          <div className="w-col" style={{ width: 312, flex: '0 0 auto', borderLeft: `1px solid ${W.line}`, background: W.tint, padding: '18px', gap: 20, overflow: 'hidden' }}>
            <div>
              <div className="w-row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                <span className="w-lbl">Score distribution</span>
                <span className="w-row" style={{ gap: 5, fontSize: 10, color: W.accent, fontWeight: 600 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: W.accent }} />live</span>
              </div>
              <Dist h={92} />
              <div className="w-sub" style={{ marginTop: 6 }}>Cohort mean 61.4% · σ 14.2</div>
            </div>
            <div>
              <div className="w-lbl" style={{ marginBottom: 10 }}>By curriculum element</div>
              <BreakBars items={[{ k: 'Number', v: 14 }, { k: 'Algebra', v: 11 }, { k: 'Geometry', v: 9 }, { k: 'Statistics', v: 8 }, { k: 'Measure', v: 6 }]} />
            </div>
            <div>
              <div className="w-lbl" style={{ marginBottom: 10 }}>By demand level</div>
              <BreakBars items={[{ k: 'Recall', v: 16 }, { k: 'Apply', v: 22 }, { k: 'Reason', v: 10 }]} />
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ─── 05 · Scoring & grade boundaries ──────────────────────────────
function ScreenBoundaries() {
  const bands = [
    { g: 'A', cut: 78, n: 612, pct: '12.7' },
    { g: 'B', cut: 64, n: 1144, pct: '23.8' },
    { g: 'C', cut: 50, n: 1530, pct: '31.8' },
    { g: 'D', cut: 38, n: 988, pct: '20.5' },
    { g: 'E', cut: 0, n: 538, pct: '11.2' },
  ];
  return (
    <Shell active="Cycles" stage={4} done={4}
      crumb="Cycles  ›  May 2026  ›  Scoring & grade boundaries"
      actions={<>
        <div className="w-row" style={{ border: `1px solid ${W.line2}`, borderRadius: 6, overflow: 'hidden' }}>
          <span style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: W.accentSoft, color: W.accent }}>Applicable Math</span>
          <span style={{ padding: '6px 12px', fontSize: 12, color: W.ink2, borderLeft: `1px solid ${W.line2}` }}>Overall</span>
        </div>
        <Btn variant="pri">Confirm boundaries →</Btn>
      </>}>
      <div className="w-col" style={{ padding: '24px 30px', gap: 20, flex: 1 }}>
        <div>
          <div className="w-h1">Set grade boundaries</div>
          <div className="w-sub" style={{ marginTop: 6 }}>Drag a cut-point on the curve, or type a percentage. Band counts update as you move.</div>
        </div>
        <div className="w-card" style={{ padding: '30px 28px 18px' }}>
          <Dist h={150} cuts={[88, 70, 50, 30]} bands={['E', 'D', 'C', 'B', 'A']} showHandles />
          <div className="w-row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <span className="w-mono" style={{ fontSize: 10, color: W.ink3 }}>0%</span>
            <span className="w-mono" style={{ fontSize: 10, color: W.ink3 }}>score →</span>
            <span className="w-mono" style={{ fontSize: 10, color: W.ink3 }}>100%</span>
          </div>
        </div>

        <div className="w-row" style={{ gap: 20, alignItems: 'flex-start' }}>
          <div className="w-card" style={{ flex: 1, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th className="w-th">Grade</th><th className="w-th" style={{ textAlign: 'right' }}>Cut-point ≥</th><th className="w-th" style={{ textAlign: 'right' }}>Students</th><th className="w-th" style={{ textAlign: 'right' }}>% of cohort</th></tr></thead>
              <tbody>
                {bands.map((b, i) => (
                  <tr key={i}>
                    <td className="w-td"><span style={{ width: 26, height: 26, border: `1px solid ${W.line2}`, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: W.mono }}>{b.g}</span></td>
                    <td className="w-td" style={{ textAlign: 'right' }}>
                      {b.g === 'E' ? <span className="w-sub w-mono">below</span> : <span className="w-field w-mono" style={{ display: 'inline-flex', width: 76, padding: '5px 8px', justifyContent: 'flex-end', color: W.ink }}>{b.cut}%</span>}
                    </td>
                    <td className="w-td w-mono" style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{b.n.toLocaleString()}</td>
                    <td className="w-td w-mono" style={{ textAlign: 'right', color: W.ink2 }}>{b.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="w-card" style={{ padding: '16px 18px', flex: '0 0 240px', background: W.tint }}>
            <div className="w-lbl" style={{ marginBottom: 8 }}>Compared to Jan 2026</div>
            <div className="w-sub" style={{ marginBottom: 12 }}>Distribution is close to last cycle. Grade A is 1.3 pts narrower.</div>
            <div className="w-row" style={{ gap: 8, color: W.ink2, alignItems: 'flex-start' }}><Mark kind="warn" size={15} /><span style={{ fontSize: 12 }}>A-cut is 4 pts above last cycle — confirm intended.</span></div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ─── 06 · Grades & sign-off ───────────────────────────────────────
function ScreenGrades() {
  const studs = [
    { id: '80412', n: 'Aisha N.', g: ['A', 'B', 'A', 'A', 'B'], o: 'A' },
    { id: '80413', n: 'Omar F.', g: ['C', 'C', 'B', 'C', 'C'], o: 'C' },
    { id: '80414', n: 'Lena M.', g: ['B', 'A', 'B', 'B', 'A'], o: 'B' },
    { id: '80415', n: 'Yusuf K.', g: ['D', 'C', 'D', 'C', 'C'], o: 'C' },
    { id: '80416', n: 'Sara T.', g: ['A', 'A', 'A', 'B', 'A'], o: 'A' },
    { id: '80417', n: 'Hadi R.', g: ['E', 'D', 'E', 'D', 'D'], o: 'D' },
  ];
  const GBadge = ({ g, big }) => <span style={{ width: big ? 28 : 22, height: big ? 28 : 22, border: `1px solid ${big ? W.accent : W.line2}`, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: W.mono, fontSize: big ? 14 : 11.5, background: big ? W.accent : W.paper, color: big ? '#fff' : W.ink }}>{g}</span>;
  return (
    <Shell active="Cycles" stage={5} done={5}
      crumb="Cycles  ›  May 2026  ›  Grades & sign-off"
      actions={<><Btn variant="ghost">Export CSV</Btn><Btn variant="pri"><Ico name="lock" color="#fff" />Lock grades</Btn></>}>
      <div className="w-col" style={{ padding: '24px 30px', gap: 18, flex: 1 }}>
        <div className="w-row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div className="w-h1">Grades & sign-off</div>
            <div className="w-sub" style={{ marginTop: 6 }}>Every student's section and overall grade. Review, then lock to publish.</div>
          </div>
          <div className="w-card" style={{ padding: '12px 16px', display: 'flex', gap: 18, alignItems: 'center' }}>
            <span className="w-lbl">Overall distribution</span>
            {[['A', 13], ['B', 24], ['C', 32], ['D', 20], ['E', 11]].map(([g, v]) => (
              <div key={g} className="w-col" style={{ alignItems: 'center', gap: 4 }}>
                <div style={{ width: 18, height: 42, background: W.tint2, borderRadius: 3, display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ width: '100%', height: `${v * 2.2}%`, background: W.accent, borderRadius: 3, opacity: .8 }} />
                </div>
                <span className="w-mono" style={{ fontSize: 10, fontWeight: 700 }}>{g}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="w-card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="w-th">Participant</th>
              {ASSESSMENTS.map(a => <th key={a} className="w-th" style={{ textAlign: 'center' }}>{a.split(' ')[0]}</th>)}
              <th className="w-th" style={{ textAlign: 'center' }}>Overall</th>
            </tr></thead>
            <tbody>
              {studs.map((s, i) => (
                <tr key={i}>
                  <td className="w-td"><span className="w-mono" style={{ fontSize: 11, color: W.ink3, marginRight: 9 }}>{s.id}</span><span style={{ fontWeight: 600, fontSize: 12.5 }}>{s.n}</span></td>
                  {s.g.map((g, j) => <td key={j} className="w-td" style={{ textAlign: 'center' }}><GBadge g={g} /></td>)}
                  <td className="w-td" style={{ textAlign: 'center' }}><GBadge g={s.o} big /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="w-row" style={{ gap: 14, marginTop: 'auto' }}>
          <div className="w-card" style={{ padding: '14px 18px', flex: 1, display: 'flex', gap: 12, alignItems: 'center', background: W.tint }}>
            <Mark kind="warn" size={17} />
            <span style={{ fontSize: 12.5 }}>Locking writes a signed, timestamped record and freezes all 5 assessments. Boundaries can't change afterward without re-opening the cycle.</span>
          </div>
          <Btn variant="pri" style={{ padding: '12px 22px', fontSize: 13 }}><Ico name="lock" color="#fff" />Lock grades & sign off</Btn>
        </div>
      </div>
    </Shell>
  );
}

Object.assign(window, { ScreenReview, ScreenBoundaries, ScreenGrades, ASSESSMENTS });
