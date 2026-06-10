// hfA.jsx — Hi-fi screens 1–3: Cycles dashboard, Cycle overview, Ingest & validate

function HFCycles() {
  const rows = [
    { name: 'May 2026', stage: 'Review', done: 2, part: '4,812', asm: 5, act: '2h ago', live: true },
    { name: 'January 2026', stage: 'Locked', done: 7, part: '4,503', asm: 5, act: '12 Feb 2026', lock: true },
    { name: 'November 2025', stage: 'Locked', done: 7, part: '4,390', asm: 4, act: '03 Dec 2025', lock: true },
    { name: 'May 2025', stage: 'Locked', done: 7, part: '4,201', asm: 4, act: '11 Jun 2025', lock: true },
  ];
  return (
    <HShell active="Cycles" crumb="Cycles"
      actions={<><HBtn variant="ghost"><HIco name="search" />Search</HBtn><HBtn variant="pri"><HIco name="plus" color="#fff" />Start new cycle</HBtn></>}>
      <div className="hf-col" style={{ padding: '28px 32px', gap: 22, flex: 1 }}>
        <div className="hf-row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div className="hf-h1">Exam cycles</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>Each cycle is one sitting of the assessments. Open a cycle to process its results.</div>
          </div>
          <div className="hf-row" style={{ gap: 8 }}><HChip on>All</HChip><HChip>In progress</HChip><HChip>Locked</HChip></div>
        </div>

        <div className="hf-card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="hf-th">Cycle</th><th className="hf-th">Stage in pipeline</th>
              <th className="hf-th" style={{ textAlign: 'right' }}>Participants</th><th className="hf-th" style={{ textAlign: 'right' }}>Assessments</th>
              <th className="hf-th">Last activity</th><th className="hf-th"></th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="hf-hover" style={{ background: r.live ? H.pinkSoft2 : 'transparent' }}>
                  <td className="hf-td"><div className="hf-row" style={{ gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</span>
                    {r.live && <span style={{ fontSize: 10, fontWeight: 700, color: H.pink, background: H.pinkSoft, padding: '2px 9px', borderRadius: 999 }}>ACTIVE</span>}
                  </div></td>
                  <td className="hf-td"><div className="hf-row" style={{ gap: 9 }}>
                    {r.lock ? <HIco name="lock" size={14} color={H.ink2} /> : <span style={{ width: 9, height: 9, borderRadius: 999, background: H.pink, flex: '0 0 auto' }} />}
                    <span style={{ fontWeight: 500, fontSize: 12.5 }}>{r.lock ? 'Locked & exported' : r.stage}</span>
                    <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink3 }}>{r.done}/7</span>
                  </div></td>
                  <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 13 }}>{r.part}</td>
                  <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 13 }}>{r.asm}</td>
                  <td className="hf-td hf-sub">{r.act}</td>
                  <td className="hf-td" style={{ textAlign: 'right' }}><HBtn>{r.lock ? 'View' : <>Open<HIco name="arrow" /></>}</HBtn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hf-sub" style={{ marginTop: 'auto' }}>4 cycles · oldest archived after 3 years per retention policy</div>
      </div>
    </HShell>
  );
}

function HFOverview() {
  const asm = [
    { n: 'Applicable Math', d: 2, items: 48 },
    { n: 'English as a 2nd Language', d: 2, items: 56 },
    { n: 'Scientific Thinking', d: 1, items: 42 },
    { n: 'Arabic as a 1st Language', d: 1, items: 51, rtl: true },
    { n: 'Life Success Skills', d: 0, items: 0 },
  ];
  return (
    <HShell active="Cycles" stage={2} done={2}
      crumb="Cycles  ›  May 2026"
      actions={<><HBtn variant="ghost">Audit log</HBtn><HBtn>Export status<HIco name="chev" /></HBtn></>}>
      <div className="hf-col" style={{ padding: '26px 32px', gap: 22, flex: 1 }}>
        <div>
          <div className="hf-h1">May 2026 cycle</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>4,812 participants · 5 assessments · started 14 May 2026</div>
        </div>

        <div className="hf-row" style={{ gap: 18, alignItems: 'stretch' }}>
          <div style={{ flex: '0 0 330px', borderRadius: 12, padding: '22px 24px', background: H.slate, color: H.cream, position: 'relative', overflow: 'hidden' }}>
            <div className="hf-lbl" style={{ color: 'rgba(246,233,218,.6)' }}>Do next</div>
            <div className="hf-h2" style={{ margin: '10px 0 6px', fontSize: 17, color: '#fff' }}>Review items for 2 assessments</div>
            <div style={{ fontSize: 12.5, color: 'rgba(246,233,218,.8)', marginBottom: 18, lineHeight: 1.5 }}>Math and English are validated and waiting for quality review before scoring.</div>
            <HBtn variant="pri">Go to item review<HIco name="arrow" color="#fff" /></HBtn>
          </div>
          <div className="hf-card hf-col" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div className="hf-row" style={{ padding: '13px 20px', borderBottom: `1px solid ${H.line}`, background: H.tint }}>
              <span className="hf-lbl" style={{ flex: 1 }}>Assessments in this cycle</span><span className="hf-lbl">Stage</span>
            </div>
            {asm.map((a, i) => (
              <div key={i} className="hf-row" style={{ padding: '12px 20px', borderBottom: i < asm.length - 1 ? `1px solid ${H.line}` : 'none', gap: 12 }}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{a.n}{a.rtl && <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 8, border: `1px solid ${H.line2}`, padding: '1px 5px', borderRadius: 4 }}>RTL</span>}</span>
                <span className="hf-mono" style={{ fontSize: 11, color: H.ink3, width: 62, textAlign: 'right' }}>{a.items || '—'} items</span>
                <HPipeline active={a.d} done={a.d} compact />
              </div>
            ))}
          </div>
        </div>
      </div>
    </HShell>
  );
}

function HFIngest() {
  const checks = [
    { k: 'pass', t: 'File format & encoding (UTF-8)', n: 'OK' },
    { k: 'pass', t: 'All 56 questions present', n: '56 / 56' },
    { k: 'pass', t: 'Participant IDs unique', n: '4,812' },
    { k: 'warn', t: 'Responses outside expected range', n: '14 rows' },
    { k: 'warn', t: 'Blank answers (treated as incorrect)', n: '237 cells' },
    { k: 'fail', t: 'Duplicate participant submissions', n: '6 rows' },
  ];
  return (
    <HShell active="Cycles" stage={1} done={1}
      crumb="Cycles  ›  May 2026  ›  Ingest & validate  ›  English as a 2nd Language"
      actions={<HBtn variant="danger"><HIco name="upload" />Re-upload export</HBtn>}
      stageAction={<HBtn variant="pri" style={{ opacity: .45 }}>Continue to review<HIco name="arrow" color="#fff" /></HBtn>}>
      <div className="hf-row" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        <div className="hf-col" style={{ flex: 1, padding: '26px 30px', gap: 20, minWidth: 0 }}>
          <div>
            <div className="hf-h1">Ingest & validate</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>Upload the raw exam export. We check it before anything else happens.</div>
          </div>
          <div className="hf-row" style={{ gap: 14 }}>
            <HHatch label="exam_export_eng_may26.csv · 3.1 MB" h={64} w={'62%'} />
            <div className="hf-col" style={{ gap: 6, justifyContent: 'center' }}>
              <span className="hf-mono" style={{ fontSize: 11, color: H.ink2 }}>uploaded 2h ago</span>
              <HBtn variant="ghost">Replace file</HBtn>
            </div>
          </div>

          <div>
            <div className="hf-row" style={{ gap: 10, marginBottom: 11 }}>
              <span className="hf-lbl">Validation report</span>
              <span className="hf-sub" style={{ fontSize: 11.5 }}>3 passed · 2 warnings · 1 must fix</span>
            </div>
            <div className="hf-card" style={{ overflow: 'hidden' }}>
              {checks.map((c, i) => (
                <div key={i} className="hf-row" style={{ padding: '12px 15px', gap: 12, borderBottom: i < checks.length - 1 ? `1px solid ${H.line}` : 'none', background: c.k === 'fail' ? H.badSoft : 'transparent' }}>
                  <HMark kind={c.k} size={17} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: c.k === 'fail' ? 600 : 500 }}>{c.t}</span>
                  <span className="hf-mono" style={{ fontSize: 11.5, color: c.k === 'fail' ? H.bad : H.ink2 }}>{c.n}</span>
                  {c.k !== 'pass' && <HBtn variant="ghost" style={{ fontSize: 11.5 }}>Review</HBtn>}
                </div>
              ))}
            </div>
          </div>

          <div className="hf-card" style={{ padding: '17px 18px', borderStyle: 'dashed', borderColor: H.line2 }}>
            <div className="hf-row" style={{ gap: 10, marginBottom: 4, alignItems: 'center' }}>
              <span className="hf-lbl">Technical-errors spreadsheet</span>
              <HBadge tone="neutral">Optional</HBadge>
              <div style={{ flex: 1 }} />
              <span className="hf-sub" style={{ fontSize: 11.5 }}>One file for the whole sitting</span>
            </div>
            <div className="hf-sub" style={{ marginBottom: 13 }}>If technical faults hit individual students mid-question, add the faults file — student, the question they were on, and what went wrong. Not every sitting has one, so this never holds up the pipeline.</div>

            <div className="hf-row" style={{ gap: 11, padding: '11px 13px', border: `1px solid ${H.line2}`, borderRadius: 9, background: H.tint, alignItems: 'center' }}>
              <HIco name="doc" color={H.ink2} size={17} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="hf-mono" style={{ fontSize: 12, fontWeight: 600 }}>technical_errors_may26.csv</div>
                <div className="hf-sub" style={{ fontSize: 11 }}>added 2h ago · 18 rows</div>
              </div>
              <HBadge tone="good"><HMark kind="pass" size={12} />Columns matched</HBadge>
              <HBtn variant="ghost" style={{ fontSize: 11 }}>Replace</HBtn>
              <HBtn variant="ghost" style={{ fontSize: 11 }}>Remove</HBtn>
            </div>

            <div className="hf-card" style={{ overflow: 'hidden', marginTop: 12, background: H.paper }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead><tr>
                  <th className="hf-th" style={{ padding: '7px 11px' }}>Student</th>
                  <th className="hf-th" style={{ padding: '7px 11px' }}>Question</th>
                  <th className="hf-th" style={{ padding: '7px 11px' }}>Error reported</th>
                </tr></thead>
                <tbody>
                  {[
                    { s: '80412 · Aisha N.', q: 'Math · Q15', e: 'Calculator tool froze; ~4 min lost' },
                    { s: '80413 · Omar F.', q: 'English · Q07', e: 'Audio clip would not play (listening item)' },
                    { s: '80414 · Lena M.', q: 'Arabic · Q33', e: 'النص العربي لم يظهر بشكل صحيح', rtl: true },
                  ].map((r, i) => (
                    <tr key={i}>
                      <td className="hf-td hf-mono" style={{ padding: '8px 11px', fontSize: 11.5 }}>{r.s}</td>
                      <td className="hf-td hf-mono" style={{ padding: '8px 11px', fontSize: 11.5, color: H.ink2 }}>{r.q}</td>
                      <td className="hf-td" style={{ padding: '8px 11px', fontSize: 12, color: H.ink2 }} dir={r.rtl ? 'rtl' : 'ltr'}>{r.e}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 9 }}>18 incidents across 11 students — these open in the new <b style={{ color: H.ink }}>Student review</b> step, after item review.</div>
          </div>

          <div className="hf-card" style={{ padding: '15px 17px', background: H.badSoft, borderColor: H.bad, display: 'flex', gap: 13, alignItems: 'flex-start' }}>
            <HMark kind="fail" size={18} />
            <div>
              <div style={{ fontWeight: 700, color: H.bad, fontSize: 13.5 }}>6 students submitted twice — resolve before scoring.</div>
              <div className="hf-sub" style={{ marginTop: 5 }}>Keep latest submission, keep first, or exclude these students from this assessment. You can also re-upload a corrected export.</div>
              <div className="hf-row" style={{ gap: 9, marginTop: 12 }}><HBtn>Keep latest</HBtn><HBtn>Keep first</HBtn><HBtn variant="ghost">Exclude students</HBtn></div>
            </div>
          </div>
        </div>

        <div className="hf-col" style={{ width: 372, flex: '0 0 auto', borderLeft: `1px solid ${H.line2}`, background: H.paper, boxShadow: '-12px 0 28px -18px rgba(31,42,49,.20)', padding: '26px 24px', gap: 13 }}>
          <div className="hf-row" style={{ justifyContent: 'space-between' }}>
            <span className="hf-lbl">Cleaned data preview</span><span className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>first 4 rows</span>
          </div>
          <div className="hf-card" style={{ overflow: 'hidden', background: H.paper }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr>{['ID','Q1','Q2','Q3','…'].map(h => <th key={h} className="hf-th" style={{ padding: '7px 9px' }}>{h}</th>)}</tr></thead>
              <tbody>
                {[['80412','1','0','1'],['80413','1','1','1'],['80414','0','1','0'],['80415','1','1','—']].map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j} className="hf-td hf-mono" style={{ padding: '7px 9px', color: c === '—' ? H.ink3 : H.ink }}>{c}</td>)}<td className="hf-td hf-mono" style={{ padding: '7px 9px', color: H.ink3 }}>…</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hf-sub">237 blanks shown as <span className="hf-mono">—</span> and scored 0. Two ID columns merged into one.</div>
        </div>
      </div>
    </HShell>
  );
}

Object.assign(window, { HFCycles, HFOverview, HFIngest });
