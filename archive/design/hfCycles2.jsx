// hfCycles2.jsx — New Cycles-area screens: Start a new cycle + Audit log

const CYC_SUBNAV = (active) => [
  { label: 'Pipeline', on: active === 'p' },
  { label: 'Audit log', on: active === 'a' },
  { label: 'Certificates', on: active === 'c' },
];

// ─── Start a new cycle ─────────────────────────────────────────────
function HFNewCycle() {
  const asm = [
    { n: 'Applicable Math', on: true, file: 'math_export.csv' },
    { n: 'English as a 2nd Language', on: true, file: 'eng_export.csv' },
    { n: 'Scientific Thinking', on: true, file: null },
    { n: 'Arabic as a 1st Language', on: true, file: null, rtl: true },
    { n: 'Life Success Skills', on: false, file: null },
  ];
  return (
    <HShell active="Cycles" crumb="Cycles  ›  New cycle"
      actions={<><HBtn variant="ghost">Cancel</HBtn><HBtn variant="pri">Create cycle</HBtn></>}>
      <div className="hf-row" style={{ flex: 1, justifyContent: 'center', alignItems: 'flex-start', overflow: 'hidden' }}>
        <div className="hf-col" style={{ width: 760, padding: '30px 24px', gap: 24 }}>
          <div>
            <div className="hf-h1">Start a new cycle</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>A cycle is one exam sitting. Name it, pick the assessments, and add each raw export now or later.</div>
          </div>

          {/* name + date */}
          <div className="hf-row" style={{ gap: 16 }}>
            <label className="hf-col" style={{ gap: 7, flex: 1 }}>
              <span className="hf-lbl">Cycle name</span>
              <span className="hf-field" style={{ color: H.ink, fontWeight: 600 }}>May 2026</span>
            </label>
            <label className="hf-col" style={{ gap: 7, width: 200 }}>
              <span className="hf-lbl">Sitting date</span>
              <span className="hf-field" style={{ justifyContent: 'space-between' }}>14 May 2026<HIco name="cal" color={H.ink3} /></span>
            </label>
          </div>

          {/* assessments */}
          <div>
            <div className="hf-row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="hf-lbl">Assessments in this cycle</span>
              <span className="hf-sub" style={{ fontSize: 11.5 }}>4 of 5 selected</span>
            </div>
            <div className="hf-card" style={{ overflow: 'hidden' }}>
              {asm.map((a, i) => (
                <div key={i} className="hf-row" style={{ padding: '13px 16px', gap: 13, borderBottom: i < asm.length - 1 ? `1px solid ${H.line}` : 'none', opacity: a.on ? 1 : .55 }}>
                  <HCheck on={a.on} />
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{a.n}{a.rtl && <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 8, border: `1px solid ${H.line2}`, padding: '1px 5px', borderRadius: 4 }}>RTL</span>}</span>
                  {!a.on
                    ? <span className="hf-sub" style={{ fontSize: 12 }}>Not included</span>
                    : a.file
                      ? <span className="hf-row" style={{ gap: 9 }}><HBadge tone="good"><HMark kind="pass" size={12} />Export added</HBadge><span className="hf-mono hf-sub" style={{ fontSize: 11 }}>{a.file}</span><HBtn variant="ghost" style={{ fontSize: 11 }}>Replace</HBtn></span>
                      : <span className="hf-row" style={{ gap: 9 }}><HBtn style={{ fontSize: 11.5 }}><HIco name="upload" size={13} />Upload export</HBtn><span className="hf-sub" style={{ fontSize: 11.5 }}>or add later</span></span>}
                </div>
              ))}
            </div>
            <div className="hf-sub" style={{ fontSize: 12, marginTop: 10 }}>You can create the cycle now and upload missing exports from the pipeline — each assessment validates on upload.</div>
          </div>
        </div>
      </div>
    </HShell>
  );
}

// ─── Audit log ─────────────────────────────────────────────────────
function HFAudit() {
  const rows = [
    { t: '16:02', d: 'Today', who: 'Rana Mansour', role: 'G12 Lead', type: 'override', tone: 'accent', act: 'Overrode cap', det: 'Karim D. (80440) kept at Distinction — two top-difficulty items lost to a confirmed tech fault' },
    { t: '15:58', d: 'Today', who: 'Rana Mansour', role: 'G12 Lead', type: 'cap', tone: 'warn', act: 'Capped award', det: 'Maya H. (80421) Distinction → Advanced achievement — 2 of 3 top-difficulty questions answered' },
    { t: '15:10', d: 'Today', who: 'Sami Haddad', role: 'Data Scientist', type: 'sexclude', tone: 'accent', act: 'Excluded for one student', det: 'Q15 removed for 80412 Aisha N. only — confirmed technical fault (calculator froze)' },
    { t: '14:32', d: 'Today', who: 'Rana Mansour', role: 'G12 Lead', type: 'lock', tone: 'good', act: 'Locked grades', det: 'Applicable Math — 4,812 students signed off' },
    { t: '14:18', d: 'Today', who: 'Rana Mansour', role: 'G12 Lead', type: 'boundary', tone: 'accent', act: 'Changed boundary', det: 'Grade A cut 78% → 76% (Applicable Math)' },
    { t: '11:47', d: 'Today', who: 'Sami Haddad', role: 'Data Scientist', type: 'exclude', tone: 'warn', act: 'Excluded item', det: 'Q23 — reason: negative discrimination (−0.06)' },
    { t: '11:45', d: 'Today', who: 'Sami Haddad', role: 'Data Scientist', type: 'exclude', tone: 'warn', act: 'Excluded item', det: 'Q31 — reason: ambiguous wording, flagged in review' },
    { t: '09:12', d: 'Today', who: 'Sami Haddad', role: 'Data Scientist', type: 'export', tone: 'neutral', act: 'Exported data', det: 'Cleaned response matrix (English 2nd Lang)' },
    { t: '16:50', d: 'Yesterday', who: 'Rana Mansour', role: 'G12 Lead', type: 'reopen', tone: 'bad', act: 'Re-opened cycle', det: 'Unlocked Scientific Thinking to re-review items' },
    { t: '16:20', d: 'Yesterday', who: 'Rana Mansour', role: 'G12 Lead', type: 'upload', tone: 'neutral', act: 'Re-uploaded export', det: 'Arabic 1st Lang — corrected duplicate submissions' },
    { t: '15:02', d: 'Yesterday', who: 'Sami Haddad', role: 'Data Scientist', type: 'boundary', tone: 'accent', act: 'Changed boundary', det: 'Grade C cut 50% → 52% (English 2nd Lang)' },
  ];
  return (
    <HShell active="Cycles" subnav={CYC_SUBNAV('a')}
      crumb="Cycles  ›  May 2026  ›  Audit log"
      actions={<HBtn variant="ghost"><HIco name="download" />Export log</HBtn>}>
      <div className="hf-col" style={{ flex: 1, minHeight: 0 }}>
        <div className="hf-row" style={{ gap: 9, padding: '16px 26px', borderBottom: `1px solid ${H.line}`, flexWrap: 'wrap', background: H.paper }}>
          <span className="hf-field" style={{ width: 230 }}><HIco name="search" color={H.ink3} />Search actions or items</span>
          <HChip on>All actions</HChip><HChip>Per-student</HChip><HChip>Caps</HChip><HChip>Exclusions</HChip><HChip>Boundaries</HChip><HChip>Locks</HChip>
          <span style={{ width: 1, height: 20, background: H.line2, margin: '0 3px' }} />
          <HChip>Anyone<HIco name="chev" /></HChip><HChip>Last 7 days<HIco name="chev" /></HChip>
          <div style={{ flex: 1 }} />
          <span className="hf-sub">142 events</span>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', background: H.paper }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="hf-th" style={{ width: 120 }}>When</th>
              <th className="hf-th" style={{ width: 230 }}>Who</th>
              <th className="hf-th" style={{ width: 170 }}>Action</th>
              <th className="hf-th">Details</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="hf-hover">
                  <td className="hf-td"><div className="hf-mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.t}</div><div className="hf-sub" style={{ fontSize: 11 }}>{r.d}</div></td>
                  <td className="hf-td"><div className="hf-row" style={{ gap: 10 }}><HAvatar name={r.who} size={30} /><div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.who}</div><div className="hf-sub" style={{ fontSize: 11 }}>{r.role}</div></div></div></td>
                  <td className="hf-td"><HBadge tone={r.tone}>{r.act}</HBadge></td>
                  <td className="hf-td" style={{ fontSize: 12.5, color: H.ink2 }}>{r.det}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hf-sub" style={{ padding: '14px 26px' }}>Showing 8 of 142 events · every consequential action is recorded and cannot be edited</div>
        </div>
      </div>
    </HShell>
  );
}

Object.assign(window, { HFNewCycle, HFAudit, CYC_SUBNAV });
