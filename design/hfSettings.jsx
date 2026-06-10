// hfSettings.jsx — Settings area: Users & access · Roles & permissions · Configuration

const SET_SUBNAV = (a) => [
  { label: 'Users & access', on: a === 'u' },
  { label: 'Roles & permissions', on: a === 'r' },
  { label: 'Configuration', on: a === 'c' },
];

// ─── Users & access ────────────────────────────────────────────────
function HFUsers() {
  const users = [
    { n: 'Rana Mansour', e: 'rana.mansour@alsamaproject.com', role: 'G12 Lead', st: 'active', last: '2h ago' },
    { n: 'Sami Haddad', e: 's.haddad@alsamaproject.com', role: 'Data Scientist', st: 'active', last: 'Yesterday' },
    { n: 'Karim Osman', e: 'k.osman@alsamaproject.com', role: 'Data Scientist', st: 'invited', last: 'Invite sent 3d ago' },
  ];
  return (
    <HShell active="Settings" subnav={SET_SUBNAV('u')}
      crumb="Settings  ›  Users & access"
      actions={<HBtn variant="pri"><HIco name="plus" color="#fff" />Invite person</HBtn>}>
      <div className="hf-col" style={{ padding: '26px 30px', gap: 18, flex: 1 }}>
        <div style={{ maxWidth: 620 }}>
          <div className="hf-h1">Users & access</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>Only people invited here can sign in. Invite by Microsoft email and give them a role. Keep the circle small.</div>
        </div>

        <div className="hf-row" style={{ gap: 9 }}>
          <span className="hf-field" style={{ width: 240 }}><HIco name="search" color={H.ink3} />Search people</span>
          <HChip on>All</HChip><HChip>Active</HChip><HChip>Invited</HChip>
        </div>

        <div className="hf-card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="hf-th">Person</th><th className="hf-th" style={{ width: 200 }}>Role</th>
              <th className="hf-th" style={{ width: 150 }}>Status</th><th className="hf-th" style={{ width: 170 }}>Last active</th><th className="hf-th" style={{ width: 50 }}></th>
            </tr></thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={i} className="hf-hover">
                  <td className="hf-td"><div className="hf-row" style={{ gap: 12 }}>
                    <HAvatar name={u.n} size={36} tone={u.st === 'active' ? 'pink' : undefined} />
                    <div><div style={{ fontWeight: 600, fontSize: 13 }}>{u.n}</div><div className="hf-mono hf-sub" style={{ fontSize: 11.5 }}>{u.e}</div></div>
                  </div></td>
                  <td className="hf-td"><span className="hf-row" style={{ gap: 6, fontSize: 12.5, fontWeight: 600 }}>{u.role}<HIco name="chev" size={13} color={H.ink3} /></span></td>
                  <td className="hf-td">{u.st === 'active' ? <HBadge tone="good"><HMark kind="pass" size={11} />Active</HBadge> : <HBadge tone="warn">Invited</HBadge>}</td>
                  <td className="hf-td hf-sub" style={{ fontSize: 12 }}>{u.last}</td>
                  <td className="hf-td" style={{ textAlign: 'center' }}>{u.st === 'invited' ? <HBtn variant="ghost" style={{ fontSize: 11 }}>Resend</HBtn> : <HIco name="dots" color={H.ink3} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hf-sub" style={{ fontSize: 12 }}>Removing someone revokes access immediately. Their past actions stay in the audit log.</div>
      </div>
    </HShell>
  );
}

// ─── Roles & permissions (checkbox grid) ───────────────────────────
function HFRoles() {
  const roles = [
    { r: 'G12 Lead', n: 1, lead: true },
    { r: 'Data Scientist', n: 2 },
  ];
  const groups = [
    { g: 'Cycle pipeline', caps: [
      { c: 'Create a cycle', v: [1, 0] }, { c: 'Upload / replace an export', v: [1, 1] },
      { c: 'Resolve validation issues', v: [1, 1] }, { c: 'Review & exclude items', v: [1, 1] },
      { c: 'Set grade boundaries', v: [1, 1] }, { c: 'Lock & sign off grades', v: [1, 0] },
      { c: 'Re-open a locked cycle', v: [1, 0] },
    ] },
    { g: 'Output', caps: [{ c: 'Generate certificates', v: [1, 0] }] },
    { g: 'Admin & analytics', caps: [
      { c: 'View analytics', v: [1, 1] }, { c: 'Manage users', v: [1, 0] }, { c: 'Edit settings', v: [1, 0] },
    ] },
  ];
  return (
    <HShell active="Settings" subnav={SET_SUBNAV('r')}
      crumb="Settings  ›  Roles & permissions"
      actions={<><HBtn variant="ghost"><HIco name="plus" />Add role</HBtn><HBtn variant="pri">Save changes</HBtn></>}>
      <div className="hf-col" style={{ padding: '26px 30px', gap: 18, flex: 1 }}>
        <div style={{ maxWidth: 640 }}>
          <div className="hf-h1">Roles & permissions</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>Tick a capability to grant it to a role. Defaults give the G12 Lead full access and the Data Scientist everything except sign-off and admin.</div>
        </div>

        <div className="hf-card" style={{ overflow: 'hidden', maxWidth: 760 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="hf-th" style={{ width: '52%' }}>Capability</th>
              {roles.map(r => (
                <th key={r.r} className="hf-th" style={{ textAlign: 'center' }}>
                  <div className="hf-col" style={{ alignItems: 'center', gap: 2 }}>
                    <span className="hf-row" style={{ gap: 5, color: r.lead ? H.pink : H.ink }}>{r.r}</span>
                    <span style={{ fontSize: 9, fontWeight: 500, color: H.ink3, textTransform: 'none', letterSpacing: 0 }}>{r.n} {r.n === 1 ? 'member' : 'members'}</span>
                  </div>
                </th>
              ))}
              <th className="hf-th" style={{ width: 60, textAlign: 'center', color: H.ink3 }}>+</th>
            </tr></thead>
            <tbody>
              {groups.map((grp, gi) => (
                <React.Fragment key={gi}>
                  <tr><td colSpan={4} style={{ padding: '9px 12px 7px', background: H.canvas, borderBottom: `1px solid ${H.line}` }}><span className="hf-lbl" style={{ fontSize: 9.5 }}>{grp.g}</span></td></tr>
                  {grp.caps.map((cap, ci) => (
                    <tr key={ci} className="hf-hover">
                      <td className="hf-td" style={{ fontSize: 12.5, fontWeight: 500 }}>{cap.c}</td>
                      {cap.v.map((on, j) => <td key={j} className="hf-td" style={{ textAlign: 'center' }}><span style={{ display: 'inline-flex' }}><HCheck on={!!on} /></span></td>)}
                      <td className="hf-td"></td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hf-sub" style={{ fontSize: 12 }}>Click a role name to rename it. New roles start with no capabilities — tick what they need.</div>
      </div>
    </HShell>
  );
}

// ─── Configuration ─────────────────────────────────────────────────
function HFConfig() {
  const thresholds = [
    { m: 'p-value (difficulty)', good: '0.30 – 0.85', rev: 'outside', flag: '< 0.15 / > 0.95' },
    { m: 'Item-total correlation', good: '≥ 0.30', rev: '0.20 – 0.30', flag: '< 0.20' },
    { m: 'Point-biserial', good: '≥ 0.25', rev: '0.15 – 0.25', flag: '< 0.15' },
    { m: 'Discrimination', good: '≥ 0.30', rev: '0.20 – 0.30', flag: '< 0.20' },
  ];
  const SectionCard = ({ title, sub, children }) => (
    <div className="hf-card" style={{ padding: '18px 20px' }}>
      <div className="hf-h2">{title}</div>
      {sub && <div className="hf-sub" style={{ fontSize: 12, marginTop: 3, marginBottom: 14 }}>{sub}</div>}
      {children}
    </div>
  );
  const Rowi = ({ label, children, last }) => (
    <div className="hf-row" style={{ justifyContent: 'space-between', padding: '11px 0', borderBottom: last ? 'none' : `1px solid ${H.line}`, gap: 16 }}>
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>{children}
    </div>
  );
  return (
    <HShell active="Settings" subnav={SET_SUBNAV('c')}
      crumb="Settings  ›  Configuration"
      actions={<HBtn variant="pri">Save changes</HBtn>}>
      <div className="hf-row" style={{ padding: '26px 30px', gap: 20, flex: 1, alignItems: 'flex-start', overflow: 'hidden' }}>
        {/* left column */}
        <div className="hf-col" style={{ flex: 1, gap: 18, minWidth: 0 }}>
          <SectionCard title="Item-quality thresholds" sub="The bands that drive the Good / Review / Flag rating on each item statistic.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th className="hf-th" style={{ paddingLeft: 0 }}>Statistic</th>
                <th className="hf-th" style={{ textAlign: 'right' }}><HBadge tone="good">Good</HBadge></th>
                <th className="hf-th" style={{ textAlign: 'right' }}><HBadge tone="warn">Review</HBadge></th>
                <th className="hf-th" style={{ textAlign: 'right', paddingRight: 0 }}><HBadge tone="bad">Flag</HBadge></th>
              </tr></thead>
              <tbody>
                {thresholds.map((t, i) => (
                  <tr key={i}>
                    <td className="hf-td" style={{ paddingLeft: 0, fontSize: 12.5, fontWeight: 600 }}>{t.m}</td>
                    <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 11.5 }}>{t.good}</td>
                    <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 11.5, color: H.ink2 }}>{t.rev}</td>
                    <td className="hf-td hf-mono" style={{ textAlign: 'right', paddingRight: 0, fontSize: 11.5, color: H.bad }}>{t.flag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>

          <SectionCard title="Grading defaults">
            <Rowi label="Grade bands"><span className="hf-row" style={{ gap: 6 }}>{['A', 'B', 'C', 'D', 'E'].map(g => <span key={g} style={{ width: 24, height: 24, border: `1px solid ${H.line2}`, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: H.mono, fontWeight: 700, fontSize: 11 }}>{g}</span>)}</span></Rowi>
            <Rowi label="Default boundary method"><div className="hf-row" style={{ border: `1px solid ${H.line2}`, borderRadius: 8, overflow: 'hidden' }}><span style={{ padding: '6px 11px', fontSize: 11.5, fontWeight: 700, background: H.pinkSoft, color: H.pink }}>Fix boundaries</span><span style={{ padding: '6px 11px', fontSize: 11.5, color: H.ink2, borderLeft: `1px solid ${H.line2}` }}>Fix cohort %</span></div></Rowi>
            <Rowi label="Carry boundaries from previous cycle" last><HToggle on /></Rowi>
          </SectionCard>

          <SectionCard title="Distinction safeguard" sub="Guards the top award: a Distinction is only granted when a student attempted enough of the hardest questions.">
            <Rowi label="Top-difficulty questions a student must answer">
              <span className="hf-row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="hf-row" style={{ border: `1px solid ${H.line2}`, borderRadius: 8, overflow: 'hidden' }}>
                  <span style={{ padding: '6px 9px', fontSize: 13, color: H.ink3, borderRight: `1px solid ${H.line2}`, cursor: 'pointer' }}>–</span>
                  <span className="hf-mono" style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700 }}>3</span>
                  <span style={{ padding: '6px 9px', fontSize: 13, color: H.ink3, borderLeft: `1px solid ${H.line2}`, cursor: 'pointer' }}>+</span>
                </span>
                <span className="hf-sub">answered</span>
              </span>
            </Rowi>
            <Rowi label="What counts as top-difficulty">
              <div className="hf-row" style={{ border: `1px solid ${H.line2}`, borderRadius: 8, overflow: 'hidden' }}>
                <span style={{ padding: '6px 11px', fontSize: 11.5, color: H.ink2 }}>Recall</span>
                <span style={{ padding: '6px 11px', fontSize: 11.5, color: H.ink2, borderLeft: `1px solid ${H.line2}` }}>Apply</span>
                <span style={{ padding: '6px 11px', fontSize: 11.5, fontWeight: 700, background: H.pinkSoft, color: H.pink, borderLeft: `1px solid ${H.line2}` }}>Reason · highest demand</span>
              </div>
            </Rowi>
            <Rowi label="If a Distinction candidate falls short" last>
              <span className="hf-row" style={{ gap: 8 }}><span className="hf-sub">cap to</span><HBadge tone="neutral">Advanced achievement</HBadge></span>
            </Rowi>
          </SectionCard>
        </div>

        {/* right column */}
        <div className="hf-col" style={{ flex: 1, gap: 18, minWidth: 0 }}>
          <SectionCard title="Data retention">
            <Rowi label="Archive locked cycles after"><span className="hf-row" style={{ gap: 8 }}><span className="hf-input" style={{ width: 48 }}>3</span><span className="hf-sub">years</span></span></Rowi>
            <Rowi label="Delete raw exports after archive"><HToggle on /></Rowi>
            <Rowi label="Keep audit log indefinitely" last><HToggle on /></Rowi>
          </SectionCard>

          <SectionCard title="Branding" sub="Used on certificates and the sign-in screen.">
            <Rowi label="Organisation logo"><HBtn style={{ fontSize: 11.5 }}><HIco name="upload" size={13} />Replace</HBtn></Rowi>
            <Rowi label="Accent colour"><span className="hf-row" style={{ gap: 8 }}>{[H.pink, H.slate, '#2f7d52'].map((c, i) => <span key={i} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: i === 0 ? `2px solid ${H.ink}` : `1px solid ${H.line2}`, outline: i === 0 ? `2px solid ${H.paper}` : 'none', outlineOffset: -3 }} />)}</span></Rowi>
            <Rowi label="Default certificate template" last><span className="hf-row" style={{ gap: 8 }}><span className="hf-mono hf-sub" style={{ fontSize: 11 }}>alsama_certificate_2026.pptx</span><HBtn variant="ghost" style={{ fontSize: 11 }}>Change</HBtn></span></Rowi>
          </SectionCard>
        </div>
      </div>
    </HShell>
  );
}

Object.assign(window, { HFUsers, HFRoles, HFConfig, SET_SUBNAV });
