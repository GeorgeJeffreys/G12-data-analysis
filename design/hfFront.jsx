// hfFront.jsx — Four new front-of-pipeline screens for G12++
//   1. HFCombinedUpload  — one combined file → detected & split by subject (+ merge-multiple mode)
//   2. HFRawView         — read-first "show me my data" (summary-first + spreadsheet-dense)
//   3. HFCleanSeparate   — dedicated clean-only screen (select rows/cols, resolve validation)
//   4. HFNaiveScores     — scores as-submitted, before item review (per-subject, chip-driven)
// Reuses hf.jsx primitives + hfData2.jsx data layer. Left-primary / right-supporting throughout.

// shared validation checks the cleaning screens act on
const CLEAN_CHECKS = [
  { k: 'fail', t: 'Duplicate participant submissions', n: '1 row', why: 'Participant 80421 (Maya Hassan) appears twice. Keep one before scoring.', act: 'Resolve' },
  { k: 'warn', t: 'Response value out of range', n: '1 cell', why: 'Q5 for 80427 reads “7” — expected 0 or 1. Set to blank or correct it.', act: 'Fix value' },
  { k: 'warn', t: 'Unused column detected', n: '_import_tmp', why: 'A leftover import column with no data. Safe to delete.', act: 'Delete column' },
  { k: 'pass', t: 'File encoding (UTF-8)', n: 'OK' },
  { k: 'pass', t: 'All 41 item columns present', n: '41 / 41' },
  { k: 'pass', t: 'Participant IDs well-formed', n: '18' },
];

function FrontBanner({ tone = 'neutral', icon, title, children, action }) {
  const c = tone === 'bad' ? [H.bad, H.badSoft] : tone === 'warn' ? [H.warn, H.warnSoft] : tone === 'good' ? [H.good, H.goodSoft] : [H.ink2, H.tint];
  return (
    <div className="hf-row" style={{ gap: 12, padding: '12px 15px', borderRadius: 10, background: c[1], alignItems: 'center' }}>
      {icon && <HIco name={icon} size={16} color={c[0]} />}
      <div style={{ flex: 1 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: c[0] }}>{title}</span>
        {children && <span className="hf-sub" style={{ marginLeft: 8, fontSize: 12 }}>{children}</span>}
      </div>
      {action}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 1 · Combined upload — detect & split by subject
// ════════════════════════════════════════════════════════════════════
function HFCombinedUpload({ mode = 'detected' }) {
  const detected = [
    { ...subjBy('math'), part: 18, ok: true },
    { ...subjBy('eng'), part: 18, ok: true },
    { ...subjBy('sci'), part: 18, ok: true },
    { ...subjBy('ar'), part: 17, ok: 'warn' },
    { ...subjBy('life'), part: 18, ok: true },
  ];
  const totalItems = detected.reduce((a, s) => a + s.items, 0);
  const merge = mode === 'merge';
  const mergeFiles = [
    { f: 'results_session_AM.csv', sheet: 'Sheet 1', rows: '10 participants × 193 items', tag: 'AM cohort' },
    { f: 'results_session_PM.csv', sheet: 'Sheet 1', rows: '8 participants × 193 items', tag: 'PM cohort' },
    { f: 'english_listening_addendum.xlsx', sheet: 'Listening', rows: '18 participants × 18 items', tag: 'merges into English' },
  ];
  return (
    <HShell active="Cycles" stage={0} done={0} stages={HFRONT_STAGES} optIndex={-1} tight
      crumb="Cycles  ›  May 2026  ›  Upload exam data"
      actions={<HBtn variant="ghost"><HIco name="doc" />Template & format guide</HBtn>}
      stageAction={<HBtn variant="pri">Confirm {detected.length} subjects & continue<HIco name="arrow" color="#fff" /></HBtn>}>
      <div className="hf-row" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        <div className="hf-col" style={{ flex: 1, padding: '26px 30px', gap: 20, minWidth: 0 }}>
          <div>
            <div className="hf-h1">Upload exam data</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 640 }}>Drop in <strong>one combined file</strong> with every subject in it — we detect each subject and split it for you. Got several files or sheets instead? We'll merge them into one dataset first.</div>
          </div>

          {/* mode toggle */}
          <div className="hf-row" style={{ gap: 0, border: `1px solid ${H.line2}`, borderRadius: 9, padding: 3, alignSelf: 'flex-start', background: H.tint }}>
            {[['detected', 'One combined file'], ['merge', 'Merge several files']].map(([m, label]) => (
              <span key={m} style={{ padding: '7px 15px', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                background: mode === m ? H.paper : 'transparent', color: mode === m ? H.pink : H.ink2, boxShadow: mode === m ? '0 1px 2px rgba(44,55,57,.12)' : 'none' }}>{label}</span>
            ))}
          </div>

          {!merge ? (
            <div className="hf-row" style={{ gap: 14, padding: '16px 18px', border: `1.5px solid ${H.line2}`, borderRadius: 12, background: H.paper, alignItems: 'center' }}>
              <span style={{ width: 46, height: 46, borderRadius: 11, background: H.pinkSoft, color: H.pink, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}><HIco name="doc" size={22} color={H.pink} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="hf-mono" style={{ fontSize: 13, fontWeight: 600 }}>g12_combined_export_may26.csv</div>
                <div className="hf-sub" style={{ fontSize: 11.5 }}>4.7 MB · 18 participants · 193 columns · uploaded just now</div>
              </div>
              <HBadge tone="good"><HMark kind="pass" size={11} />Parsed</HBadge>
              <HBtn variant="ghost" style={{ fontSize: 12 }}><HIco name="upload" size={13} />Replace</HBtn>
            </div>
          ) : (
            <div className="hf-col" style={{ gap: 10 }}>
              <div className="hf-row" style={{ gap: 9 }}><span className="hf-lbl">3 files queued to merge</span><div style={{ flex: 1, height: 1, background: H.line }} /><HBtn variant="ghost" style={{ fontSize: 11.5 }}><HIco name="plus" size={12} />Add file</HBtn></div>
              {mergeFiles.map((f, i) => (
                <div key={i} className="hf-row" style={{ gap: 12, padding: '12px 15px', border: `1px solid ${H.line2}`, borderRadius: 10, background: H.paper, alignItems: 'center' }}>
                  <HIco name="doc" size={16} color={H.ink2} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hf-mono" style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.f}</div>
                    <div className="hf-sub" style={{ fontSize: 11 }}>{f.sheet} · {f.rows}</div>
                  </div>
                  <HBadge tone="neutral">{f.tag}</HBadge>
                  <HIco name="x" size={13} color={H.ink3} />
                </div>
              ))}
              <FrontBanner tone="good" icon="refresh" title="Merged into one dataset" action={<span className="hf-mono" style={{ fontSize: 11.5, color: H.good, fontWeight: 700 }}>18 participants · 193 items</span>}>matched on Participant ID — no ID conflicts found.</FrontBanner>
            </div>
          )}

          {/* detection result */}
          <div className="hf-col" style={{ gap: 11 }}>
            <div className="hf-row" style={{ gap: 10 }}>
              <span className="hf-lbl">Found {detected.length} subjects in this file</span>
              <span className="hf-sub" style={{ fontSize: 11.5 }}>{totalItems} items total · split automatically</span>
            </div>
            <div className="hf-card" style={{ overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>
                  <th className="hf-th">Detected subject</th>
                  <th className="hf-th" style={{ textAlign: 'right' }}>Items</th>
                  <th className="hf-th" style={{ textAlign: 'right' }}>Participants</th>
                  <th className="hf-th">Elements</th>
                  <th className="hf-th" style={{ textAlign: 'right' }}>Status</th>
                </tr></thead>
                <tbody>
                  {detected.map((s, i) => (
                    <tr key={s.key} className="hf-hover">
                      <td className="hf-td" style={{ fontWeight: 600 }}>
                        <span className="hf-row" style={{ gap: 8 }}>{s.name}{s.essay && <HBadge tone="accent">has essay</HBadge>}{s.rtl && <HBadge tone="neutral">RTL</HBadge>}</span>
                      </td>
                      <td className="hf-td hf-mono" style={{ textAlign: 'right' }}>{s.items}</td>
                      <td className="hf-td hf-mono" style={{ textAlign: 'right', color: s.ok === 'warn' ? H.warn : H.ink }}>{s.part}</td>
                      <td className="hf-td hf-mono" style={{ color: H.ink2 }}>{s.elements.map(e => e.id).join(' · ')}</td>
                      <td className="hf-td" style={{ textAlign: 'right' }}>
                        {s.ok === 'warn'
                          ? <HBadge tone="warn"><HMark kind="warn" size={11} />1 fewer participant</HBadge>
                          : <HBadge tone="good"><HMark kind="pass" size={11} />Split OK</HBadge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <FrontBanner tone="warn" icon="filter" title="Arabic has 17 participants, others have 18." action={<HBtn variant="ghost" style={{ fontSize: 11.5, color: H.warn }}>See who's missing</HBtn>}>One student has no Arabic responses — fine if they didn't sit it. You can confirm later in cleaning.</FrontBanner>
          </div>

          {/* continuity with the 3-card import concept */}
          <div className="hf-col" style={{ gap: 10 }}>
            <div className="hf-row" style={{ gap: 10 }}><span className="hf-lbl">Inputs for this sitting</span><div style={{ flex: 1, height: 1, background: H.line }} /><span className="hf-row" style={{ gap: 6, fontSize: 11, color: H.ink3 }}><HIco name="lock" size={11} color={H.ink3} />Only the exam export is required</span></div>
            <div className="hf-row" style={{ gap: 12, alignItems: 'stretch' }}>
              {[['doc', 'Raw exam export', 'accent', 'This combined file', 'good'], ['doc', 'Essay marks', 'neutral', 'Optional · add later', 'add'], ['filter', 'Incident log', 'neutral', 'Optional · add later', 'add']].map(([ic, t, tone, sub, st], i) => (
                <div key={i} className="hf-card" style={{ flex: 1, padding: '13px 15px', gap: 9, display: 'flex', alignItems: 'center', borderStyle: st === 'add' ? 'dashed' : 'solid', borderColor: st === 'good' ? H.good : H.line2 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: st === 'good' ? H.goodSoft : H.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}><HIco name={ic} size={16} color={st === 'good' ? H.good : H.ink2} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{t}</div><div className="hf-sub" style={{ fontSize: 10.5 }}>{sub}</div></div>
                  {st === 'good' ? <HMark kind="pass" size={16} /> : <HBtn variant="ghost" style={{ fontSize: 11 }}><HIco name="plus" size={12} />Add</HBtn>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* right rail */}
        <div className="hf-col" style={{ width: 290, flex: '0 0 auto', borderLeft: `1px solid ${H.line2}`, background: H.paper, padding: '26px 22px', gap: 16 }}>
          <span className="hf-lbl">What happens on continue</span>
          <div className="hf-col" style={{ gap: 0 }}>
            {[['Split into 5 subject datasets', 'each opens in its own raw view'], ['Keep your original file', 'nothing is overwritten'], ['Nothing is scored yet', 'review & clean come first']].map(([t, s], i) => (
              <div key={i} className="hf-row" style={{ gap: 11, padding: '11px 0', borderBottom: i < 2 ? `1px solid ${H.line}` : 'none' }}>
                <span className="hf-mono" style={{ width: 20, height: 20, borderRadius: 6, background: H.tint2, color: H.ink2, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{i + 1}</span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{t}</div><div className="hf-sub" style={{ fontSize: 11 }}>{s}</div></div>
              </div>
            ))}
          </div>
          <div style={{ height: 1, background: H.line }} />
          <span className="hf-lbl">How we detect subjects</span>
          <div className="hf-sub" style={{ fontSize: 12, lineHeight: 1.5 }}>We read the <span className="hf-mono" style={{ fontSize: 11 }}>subject</span> column (or a per-subject sheet) and group items by their element codes (A–E · D1–D3). No subject column? <span style={{ color: H.pink, fontWeight: 600 }}>Map it by hand →</span></div>
          <div className="hf-card" style={{ padding: '12px 14px', background: H.canvas, gap: 7, display: 'flex', flexDirection: 'column' }}>
            <span className="hf-lbl" style={{ fontSize: 9.5 }}>Detected this upload</span>
            <div className="hf-row" style={{ gap: 8 }}><span className="hf-mono" style={{ fontSize: 19, fontWeight: 600, color: H.pink }}>193</span><span className="hf-sub" style={{ fontSize: 11 }}>items across<br />5 subjects</span></div>
          </div>
        </div>
      </div>
    </HShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// 2 · Raw data view — read-first "show me my data"
// ════════════════════════════════════════════════════════════════════
function HFRawView({ dense = false, subjKey = 'math' }) {
  const [subj, setSubj] = React.useState(subjKey);
  const s = subjBy(subj);
  return (
    <HShell active="Cycles" stage={1} done={1} stages={HFRONT_STAGES} optIndex={-1} tight
      crumb="Cycles  ›  May 2026  ›  Raw data"
      actions={<><HBtn variant="ghost"><HIco name="download" />Export CSV</HBtn><HBtn variant="ghost"><HIco name="filter" />Clean data</HBtn></>}
      stageAction={<HBtn variant="pri">Looks right — continue<HIco name="arrow" color="#fff" /></HBtn>}>
      <div className="hf-col" style={{ flex: 1, padding: dense ? '20px 28px' : '24px 30px', gap: dense ? 14 : 18, minWidth: 0 }}>
        <div className="hf-row" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <div className="hf-h1">Your raw data</div>
            <div className="hf-sub" style={{ marginTop: 6 }}>This is exactly what you uploaded, before any analysis. Have a look, then move on — or open <strong>Clean</strong> to tidy it.</div>
          </div>
          <FrontBanner tone="neutral" icon="eye" title="Read-only view." action={null}>Editing happens in Clean.</FrontBanner>
        </div>

        <SubjectChips active={subj} onPick={setSubj} />

        {dense ? (
          <>
            <div className="hf-row" style={{ gap: 0, alignItems: 'stretch', border: `1px solid ${H.line2}`, borderRadius: 10, background: H.paper, padding: '12px 0' }}>
              {[[18, 'Participants'], [s.items, 'Items'], [s.elements.length, 'Elements'], [`${s.demand.D1}·${s.demand.D2}·${s.demand.D3}`, 'D1·D2·D3'], ['0', 'Items excluded']].map(([n, l], i) => (
                <div key={i} className="hf-col" style={{ flex: 1, gap: 2, padding: '0 18px', borderLeft: i ? `1px solid ${H.line}` : 'none', alignItems: 'flex-start' }}>
                  <span className="hf-mono" style={{ fontSize: n.toString().length > 6 ? 17 : 21, fontWeight: 600, color: i === 1 ? H.pink : H.ink }}>{n}</span>
                  <span className="hf-lbl" style={{ fontSize: 9.5 }}>{l}</span>
                </div>
              ))}
            </div>
            <div className="hf-row" style={{ gap: 10 }}><span className="hf-lbl">{s.name} · raw responses</span><span className="hf-sub" style={{ fontSize: 11.5 }}>18 rows × {s.items} items · 1 correct · 0 incorrect · – omitted</span><div style={{ flex: 1 }} /><span className="hf-sub" style={{ fontSize: 11, fontStyle: 'italic' }}>scroll → to see all items</span></div>
            <RawTable subjKey={subj} maxH={520} />
          </>
        ) : (
          <>
            <div className="hf-row" style={{ gap: 16, alignItems: 'stretch' }}>
              <div className="hf-card" style={{ flex: 1, padding: '18px 4px' }}><SummaryBand subj={s} /></div>
            </div>
            <div className="hf-card" style={{ padding: '18px 20px' }}><Breakdown subj={s} /></div>
            <div className="hf-row" style={{ gap: 10 }}><span className="hf-lbl">{s.name} · raw responses</span><span className="hf-sub" style={{ fontSize: 11.5 }}>18 rows × {s.items} items · 1 correct · 0 incorrect · – omitted</span><div style={{ flex: 1 }} /><span className="hf-sub" style={{ fontSize: 11, fontStyle: 'italic' }}>scroll → to see all items</span></div>
            <RawTable subjKey={subj} maxH={300} />
          </>
        )}
      </div>
    </HShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// 3 · Data cleaning — dedicated clean-only screen
//   (Viewing lives on Screen 2 / Raw data, so this screen is purely cleaning.)
// ════════════════════════════════════════════════════════════════════
function ValidationRail({ compact }) {
  const counts = { fail: CLEAN_CHECKS.filter(c => c.k === 'fail').length, warn: CLEAN_CHECKS.filter(c => c.k === 'warn').length, pass: CLEAN_CHECKS.filter(c => c.k === 'pass').length };
  return (
    <div className="hf-col" style={{ gap: 13 }}>
      <div className="hf-row" style={{ gap: 8 }}>
        <span className="hf-lbl">Validation report</span>
        <div style={{ flex: 1 }} />
        <HBadge tone="bad">{counts.fail} must fix</HBadge>
        <HBadge tone="warn">{counts.warn} warnings</HBadge>
      </div>
      <div className="hf-col" style={{ gap: 9 }}>
        {CLEAN_CHECKS.map((c, i) => (
          <div key={i} className="hf-card" style={{ padding: '11px 13px', borderColor: c.k === 'fail' ? H.bad : c.k === 'warn' ? H.line2 : H.line, background: c.k === 'fail' ? H.badSoft : H.paper, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="hf-row" style={{ gap: 9 }}>
              <HMark kind={c.k} size={15} />
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: c.k === 'pass' ? 500 : 700 }}>{c.t}</span>
              <span className="hf-mono" style={{ fontSize: 11, color: c.k === 'fail' ? H.bad : c.k === 'warn' ? H.warn : H.ink3 }}>{c.n}</span>
            </div>
            {c.why && <div className="hf-sub" style={{ fontSize: 11, paddingLeft: 24 }}>{c.why}</div>}
            {c.act && <div style={{ paddingLeft: 24 }}><HBtn variant={c.k === 'fail' ? 'pri' : ''} style={{ fontSize: 11, padding: '5px 11px' }}>{c.act}</HBtn></div>}
          </div>
        ))}
      </div>
      <FrontBanner tone="bad" icon="lock" title="1 issue blocks continuing." >Warnings are your call.</FrontBanner>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Dedicated cleaning screen — select rows/columns + resolve validation
// ════════════════════════════════════════════════════════════════════
function HFCleanSeparate() {
  return (
    <HShell active="Cycles" stage={2} done={2} stages={HFRONT_STAGES} optIndex={-1} tight
      crumb="Cycles  ›  May 2026  ›  Applicable Maths  ›  Clean data"
      actions={<HBtn variant="ghost"><HIco name="refresh" />Revert all</HBtn>}
      stageAction={<HBtn variant="pri" style={{ opacity: .45 }}>Resolve 1 issue to continue<HIco name="arrow" color="#fff" /></HBtn>}>
      <div className="hf-row" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        <div className="hf-col" style={{ flex: 1, padding: '22px 28px', gap: 15, minWidth: 0 }}>
          <div className="hf-row" style={{ gap: 16, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div className="hf-h1">Clean data</div>
              <div className="hf-sub" style={{ marginTop: 6 }}>Remove columns and rows you don’t need, fix flagged values, then continue. A dedicated step — your raw file is never touched.</div>
            </div>
            <div className="hf-card" style={{ padding: '10px 16px', display: 'flex', gap: 16, alignItems: 'center', background: H.canvas }}>
              <div className="hf-col" style={{ alignItems: 'center' }}><span className="hf-mono" style={{ fontSize: 17, fontWeight: 600, color: H.ink3 }}>18</span><span className="hf-lbl" style={{ fontSize: 9 }}>before</span></div>
              <HIco name="arrow" size={15} color={H.ink3} />
              <div className="hf-col" style={{ alignItems: 'center' }}><span className="hf-mono" style={{ fontSize: 17, fontWeight: 600, color: H.pink }}>17</span><span className="hf-lbl" style={{ fontSize: 9 }}>after</span></div>
              <div style={{ width: 1, height: 30, background: H.line2 }} />
              <span className="hf-sub" style={{ fontSize: 11.5 }}>1 row &<br />1 column removed</span>
            </div>
          </div>

          <div className="hf-row" style={{ gap: 12, padding: '11px 15px', borderRadius: 10, background: H.slate, color: H.cream, alignItems: 'center' }}>
            <HCheck on />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#fff' }}>1 column · 1 row selected</span>
            <div style={{ flex: 1 }} />
            <HBtn style={{ fontSize: 11.5, background: 'transparent', borderColor: H.slate2, color: H.cream }}>Clear</HBtn>
            <HBtn variant="danger" style={{ fontSize: 11.5, background: H.paper }}><HIco name="trash" size={12} color={H.bad} />Delete selected</HBtn>
          </div>

          <div className="hf-row" style={{ gap: 10 }}><span className="hf-lbl">Select rows / columns to remove</span><div style={{ flex: 1 }} /><span className="hf-sub" style={{ fontSize: 11, fontStyle: 'italic' }}>scroll → for all items</span></div>
          <RawTable subjKey="math" maxH={480} dirty selCols={['_tmp']} selRows={['80421']} />
        </div>
        <div className="hf-col" style={{ width: 320, flex: '0 0 auto', borderLeft: `1px solid ${H.line2}`, background: H.paper, padding: '22px 20px', gap: 14, overflow: 'auto' }}>
          <ValidationRail />
        </div>
      </div>
    </HShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// 4 · Naive overall scores — before any item review (per-subject)
// ════════════════════════════════════════════════════════════════════
function elementScore(subj, stu, elId) {
  const meta = itemMeta(subj).filter(m => m.el === elId);
  let got = 0; meta.forEach(m => { if (cellVal(seedOf(stu.id), m.q, stu.ability, m.demand) === 1) got++; });
  return { got, max: meta.length };
}

function HFNaiveScores({ subjKey = 'math' }) {
  const [subj, setSubj] = React.useState(subjKey);
  const s = subjBy(subj);
  const mcqEls = s.elements.filter(e => !e.essay);
  const essayEl = s.elements.find(e => e.essay);
  const mcqMax = mcqEls.reduce((a, e) => a + e.items, 0);
  const scored = COHORT.map(stu => {
    let got = 0; mcqEls.forEach(e => { got += elementScore(s, stu, e.id).got; });
    return { ...stu, got, pct: Math.round((got / mcqMax) * 100) };
  }).sort((a, b) => b.pct - a.pct);
  const avg = Math.round(scored.reduce((a, x) => a + x.pct, 0) / scored.length);
  return (
    <HShell active="Cycles" stage={3} done={3} stages={HFRONT_STAGES} optIndex={-1} tight
      crumb="Cycles  ›  May 2026  ›  Raw scores"
      actions={<HBtn variant="ghost"><HIco name="download" />Export</HBtn>}
      stageAction={<HBtn variant="pri">Continue to item review<HIco name="arrow" color="#fff" /></HBtn>}>
      <div className="hf-col" style={{ flex: 1, padding: '22px 30px', gap: 15, minWidth: 0 }}>
        <div className="hf-row" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="hf-h1">Raw scores — as submitted</div>
            <div className="hf-sub" style={{ marginTop: 6, maxWidth: 660 }}>What every student scored straight from their answers, with <strong>no items removed</strong>. This is a sanity check before item review — not a final result.</div>
          </div>
        </div>

        <FrontBanner tone="warn" icon="eye" title="Before any item review." action={<span className="hf-mono" style={{ fontSize: 11.5, color: H.warn, fontWeight: 700 }}>0 items excluded</span>}>No questions have been dropped yet. Final scores can change once weak items are reviewed.</FrontBanner>

        <div className="hf-row" style={{ gap: 12, alignItems: 'center' }}>
          <SubjectChips active={subj} onPick={setSubj} />
          <div style={{ flex: 1 }} />
          <span className="hf-sub" style={{ fontSize: 11.5 }}>cohort average</span>
          <span className="hf-mono" style={{ fontSize: 15, fontWeight: 600, color: H.ink }}>{avg}%</span>
        </div>

        {essayEl && (
          <FrontBanner tone="neutral" icon="doc" title={`Showing MCQ items only (${mcqMax} of ${s.items}).`}>The “{essayEl.name}” essay element is marked offline and added later in Adjustments.</FrontBanner>
        )}

        <div className="hf-card" style={{ overflow: 'hidden', direction: s.rtl ? 'rtl' : 'ltr' }}>
          <div style={{ overflow: 'auto', maxHeight: 460 }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, direction: 'ltr' }}>
              <thead><tr>
                <th className="hf-th" style={{ position: 'sticky', top: 0, width: 36 }}>#</th>
                <th className="hf-th" style={{ position: 'sticky', top: 0 }}>Participant</th>
                {mcqEls.map(e => <th key={e.id} className="hf-th" style={{ position: 'sticky', top: 0, textAlign: 'center', minWidth: 52 }} title={e.name}>{e.id} <span style={{ color: H.ink3, fontWeight: 400 }}>/{e.items}</span></th>)}
                <th className="hf-th" style={{ position: 'sticky', top: 0, textAlign: 'right' }}>Raw score</th>
                <th className="hf-th" style={{ position: 'sticky', top: 0, textAlign: 'right', minWidth: 150 }}>Percentage</th>
                <th className="hf-th" style={{ position: 'sticky', top: 0 }}></th>
              </tr></thead>
              <tbody>
                {scored.map((stu, i) => (
                  <tr key={stu.id} className="hf-hover">
                    <td className="hf-td hf-mono" style={{ color: H.ink3, fontSize: 11.5 }}>{i + 1}</td>
                    <td className="hf-td">
                      <div className="hf-row" style={{ gap: 9 }}>
                        <HAvatar name={stu.n} size={26} />
                        <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{stu.n}</div><div className="hf-mono hf-sub" style={{ fontSize: 10.5 }}>{stu.id}</div></div>
                      </div>
                    </td>
                    {mcqEls.map(e => { const es = elementScore(s, stu, e.id); return <td key={e.id} className="hf-td hf-mono" style={{ textAlign: 'center', color: H.ink2, fontSize: 12 }}>{es.got}</td>; })}
                    <td className="hf-td hf-mono" style={{ textAlign: 'right', fontWeight: 600 }}>{stu.got}<span style={{ color: H.ink3, fontWeight: 400 }}> / {mcqMax}</span></td>
                    <td className="hf-td">
                      <div className="hf-row" style={{ gap: 10, justifyContent: 'flex-end' }}>
                        <div style={{ width: 84, height: 7, background: H.tint2, borderRadius: 5, flex: '0 0 auto' }}><div style={{ width: `${stu.pct}%`, height: '100%', background: H.bar, borderRadius: 5 }} /></div>
                        <span className="hf-mono" style={{ fontSize: 13, fontWeight: 600, width: 34, textAlign: 'right' }}>{stu.pct}%</span>
                      </div>
                    </td>
                    <td className="hf-td" style={{ textAlign: 'right' }}><HBtn variant="ghost" style={{ fontSize: 11 }}>Items<HIco name="arrow" size={12} /></HBtn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hf-row" style={{ gap: 10, alignItems: 'center' }}>
          <span className="hf-sub" style={{ fontSize: 12 }}>Click a subject above to see its raw scores, or drill into any student's items.</span>
          <div style={{ flex: 1 }} />
          <HBtn variant="pri">Continue to item review<HIco name="arrow" color="#fff" /></HBtn>
        </div>
      </div>
    </HShell>
  );
}

Object.assign(window, { HFCombinedUpload, HFRawView, HFCleanSeparate, HFNaiveScores });
