// spineA.jsx — Spine screens 1–3: Cycles dashboard, Cycle overview, Ingest & validate

// ─── 01 · Cycles dashboard ─────────────────────────────────────────
function ScreenCycles() {
  const rows = [
    { name: 'May 2026', stage: 'Review', done: 2, part: '4,812', asm: 5, act: '2h ago', live: true },
    { name: 'January 2026', stage: 'Locked', done: 7, part: '4,503', asm: 5, act: '12 Feb 2026', lock: true },
    { name: 'November 2025', stage: 'Locked', done: 7, part: '4,390', asm: 4, act: '03 Dec 2025', lock: true },
    { name: 'May 2025', stage: 'Locked', done: 7, part: '4,201', asm: 4, act: '11 Jun 2025', lock: true },
  ];
  return (
    <Shell active="Cycles" crumb="Cycles"
      actions={<><Btn variant="ghost"><Ico name="search" />Search</Btn><Btn variant="pri">+ Start new cycle</Btn></>}>
      <div className="w-col" style={{ padding: '26px 30px', gap: 20, flex: 1 }}>
        <div className="w-row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div className="w-h1">Exam cycles</div>
            <div className="w-sub" style={{ marginTop: 6 }}>Each cycle is one sitting of the assessments. Open a cycle to process its results.</div>
          </div>
          <div className="w-row" style={{ gap: 8 }}><Chip on>All</Chip><Chip>In progress</Chip><Chip>Locked</Chip></div>
        </div>

        <div className="w-card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="w-th">Cycle</th><th className="w-th">Stage in pipeline</th>
              <th className="w-th" style={{ textAlign: 'right' }}>Participants</th>
              <th className="w-th" style={{ textAlign: 'right' }}>Assessments</th>
              <th className="w-th">Last activity</th><th className="w-th"></th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ background: r.live ? W.tint : 'transparent' }}>
                  <td className="w-td">
                    <div className="w-row" style={{ gap: 9 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>
                      {r.live && <span className="w-chip on" style={{ padding: '1px 8px', fontSize: 10 }}>active</span>}
                    </div>
                  </td>
                  <td className="w-td">
                    <div className="w-row" style={{ gap: 8 }}>
                      {r.lock ? <Ico name="lock" size={13} color={W.ink2} /> : <span style={{ width: 8, height: 8, borderRadius: 999, background: W.accent, flex: '0 0 auto' }} />}
                      <span style={{ fontWeight: 500, fontSize: 12 }}>{r.lock ? 'Locked & exported' : r.stage}</span>
                      <span className="w-mono" style={{ fontSize: 10, color: W.ink3 }}>{r.done}/7</span>
                    </div>
                  </td>
                  <td className="w-td w-mono" style={{ textAlign: 'right', fontSize: 12.5 }}>{r.part}</td>
                  <td className="w-td w-mono" style={{ textAlign: 'right', fontSize: 12.5 }}>{r.asm}</td>
                  <td className="w-td w-sub">{r.act}</td>
                  <td className="w-td" style={{ textAlign: 'right' }}><Btn>{r.lock ? 'View' : 'Open →'}</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="w-sub" style={{ marginTop: 'auto' }}>4 cycles · oldest archived after 3 years per retention policy</div>
      </div>
    </Shell>
  );
}

// ─── 02 · Cycle overview ──────────────────────────────────────────
function ScreenOverview() {
  const asm = [
    { n: 'Applicable Math', d: 2, items: 48 },
    { n: 'English as a 2nd Language', d: 2, items: 56 },
    { n: 'Scientific Thinking', d: 1, items: 42 },
    { n: 'Arabic as a 1st Language', d: 1, items: 51, rtl: true },
    { n: 'Life Success Skills', d: 0, items: 0 },
  ];
  return (
    <Shell active="Cycles" stage={2} done={2}
      crumb="Cycles  ›  May 2026"
      actions={<><Btn variant="ghost">Audit log</Btn><Btn>Export status<Ico name="chev" /></Btn></>}>
      <div className="w-col" style={{ padding: '24px 30px', gap: 20, flex: 1 }}>
        <div>
          <div className="w-h1">May 2026 cycle</div>
          <div className="w-sub" style={{ marginTop: 6 }}>4,812 participants · 5 assessments · started 14 May 2026</div>
        </div>

        <div className="w-row" style={{ gap: 16, alignItems: 'stretch' }}>
          <div className="w-card" style={{ padding: '18px 22px', flex: '0 0 320px', background: W.accentSoft, borderColor: W.accent }}>
            <div className="w-lbl" style={{ color: W.accent }}>Do next</div>
            <div className="w-h2" style={{ margin: '8px 0 4px', fontSize: 16 }}>Review items for 2 assessments</div>
            <div className="w-sub" style={{ marginBottom: 16 }}>Math and English are validated and waiting for quality review before scoring.</div>
            <Btn variant="pri">Go to item review →</Btn>
          </div>
          <div className="w-card w-col" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div className="w-row" style={{ padding: '12px 18px', borderBottom: `1px solid ${W.line}`, background: W.tint }}>
              <span className="w-lbl" style={{ flex: 1 }}>Assessments in this cycle</span>
              <span className="w-lbl">Stage</span>
            </div>
            {asm.map((a, i) => (
              <div key={i} className="w-row" style={{ padding: '11px 18px', borderBottom: i < asm.length - 1 ? `1px solid ${W.line}` : 'none', gap: 12 }}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 12.5 }}>{a.n}{a.rtl && <span className="w-mono" style={{ fontSize: 9, color: W.ink3, marginLeft: 7, border: `1px solid ${W.line2}`, padding: '0 4px', borderRadius: 3 }}>RTL</span>}</span>
                <span className="w-mono" style={{ fontSize: 11, color: W.ink3, width: 60, textAlign: 'right' }}>{a.items || '—'} items</span>
                <Pipeline active={a.d} done={a.d} compact />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ─── 03 · Ingest & validate ───────────────────────────────────────
function ScreenIngest() {
  const checks = [
    { k: 'pass', t: 'File format & encoding (UTF-8)', n: 'OK' },
    { k: 'pass', t: 'All 56 questions present', n: '56 / 56' },
    { k: 'pass', t: 'Participant IDs unique', n: '4,812' },
    { k: 'warn', t: 'Responses outside expected range', n: '14 rows' },
    { k: 'warn', t: 'Blank answers (treated as incorrect)', n: '237 cells' },
    { k: 'fail', t: 'Duplicate participant submissions', n: '6 rows' },
  ];
  return (
    <Shell active="Cycles" stage={1} done={1}
      crumb="Cycles  ›  May 2026  ›  Ingest & validate  ›  English as a 2nd Language"
      actions={<><Btn variant="danger"><Ico name="upload" />Re-upload export</Btn><Btn variant="pri" style={{ opacity: .4 }}>Continue to review →</Btn></>}>
      <div className="w-row" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        <div className="w-col" style={{ flex: 1, padding: '24px 28px', gap: 18, minWidth: 0 }}>
          <div>
            <div className="w-h1">Ingest & validate</div>
            <div className="w-sub" style={{ marginTop: 6 }}>Upload the raw exam export. We check it before anything else happens.</div>
          </div>
          <div className="w-row" style={{ gap: 14 }}>
            <Hatch label="exam_export_eng_may26.csv · 3.1 MB" h={62} w={'62%'} />
            <div className="w-col" style={{ gap: 6, justifyContent: 'center' }}>
              <span className="w-mono" style={{ fontSize: 11, color: W.ink2 }}>uploaded 2h ago</span>
              <Btn variant="ghost">Replace file</Btn>
            </div>
          </div>

          <div>
            <div className="w-row" style={{ gap: 10, marginBottom: 10 }}>
              <span className="w-lbl">Validation report</span>
              <span className="w-sub" style={{ fontSize: 11 }}>3 passed · 2 warnings · 1 must fix</span>
            </div>
            <div className="w-card" style={{ overflow: 'hidden' }}>
              {checks.map((c, i) => (
                <div key={i} className="w-row" style={{ padding: '11px 14px', gap: 11, borderBottom: i < checks.length - 1 ? `1px solid ${W.line}` : 'none', background: c.k === 'fail' ? W.badSoft : 'transparent' }}>
                  <Mark kind={c.k} size={16} />
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: c.k === 'fail' ? 600 : 500 }}>{c.t}</span>
                  <span className="w-mono" style={{ fontSize: 11.5, color: c.k === 'fail' ? W.bad : W.ink2 }}>{c.n}</span>
                  {c.k !== 'pass' && <Btn variant="ghost" style={{ fontSize: 11 }}>Review</Btn>}
                </div>
              ))}
            </div>
          </div>

          <div className="w-card" style={{ padding: '14px 16px', background: W.badSoft, borderColor: W.bad, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Mark kind="fail" size={17} />
            <div>
              <div style={{ fontWeight: 600, color: W.bad, fontSize: 13 }}>6 students submitted twice — resolve before scoring.</div>
              <div className="w-sub" style={{ marginTop: 4 }}>Keep latest submission, keep first, or exclude these students from this assessment. You can also re-upload a corrected export.</div>
              <div className="w-row" style={{ gap: 8, marginTop: 11 }}><Btn>Keep latest</Btn><Btn>Keep first</Btn><Btn variant="ghost">Exclude students</Btn></div>
            </div>
          </div>
        </div>

        <div className="w-col" style={{ width: 360, flex: '0 0 auto', borderLeft: `1px solid ${W.line}`, background: W.tint, padding: '24px 22px', gap: 12 }}>
          <div className="w-row" style={{ justifyContent: 'space-between' }}>
            <span className="w-lbl">Cleaned data preview</span>
            <span className="w-mono" style={{ fontSize: 10, color: W.ink3 }}>first 4 rows</span>
          </div>
          <div className="w-card" style={{ overflow: 'hidden', background: W.paper }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr><th className="w-th" style={{ padding: '6px 8px' }}>ID</th><th className="w-th" style={{ padding: '6px 8px' }}>Q1</th><th className="w-th" style={{ padding: '6px 8px' }}>Q2</th><th className="w-th" style={{ padding: '6px 8px' }}>Q3</th><th className="w-th" style={{ padding: '6px 8px' }}>…</th></tr></thead>
              <tbody>
                {[['80412','1','0','1'],['80413','1','1','1'],['80414','0','1','0'],['80415','1','1','—']].map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j} className="w-td w-mono" style={{ padding: '6px 8px', color: c === '—' ? W.ink3 : W.ink }}>{c}</td>)}<td className="w-td w-mono" style={{ padding: '6px 8px', color: W.ink3 }}>…</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="w-sub">237 blanks shown as <span className="w-mono">—</span> and scored 0. Two ID columns merged into one.</div>
        </div>
      </div>
    </Shell>
  );
}

Object.assign(window, { ScreenCycles, ScreenOverview, ScreenIngest });
