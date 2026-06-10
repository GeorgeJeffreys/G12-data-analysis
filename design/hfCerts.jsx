// hfCerts.jsx — Certificate generation: Upload & generate (interactive) + Results

// sample certificate preview (real render, not a placeholder)
function CertPreview({ scale = 1 }) {
  return (
    <div style={{ width: 320 * scale, height: 226 * scale, background: '#fff', border: `1px solid ${H.line2}`, borderRadius: 6,
      boxShadow: '0 4px 18px rgba(31,42,49,.12)', position: 'relative', overflow: 'hidden', flex: '0 0 auto' }}>
      <div style={{ position: 'absolute', inset: 8, border: `1.5px solid ${H.pink}`, borderRadius: 4, opacity: .55 }} />
      <div className="hf-col" style={{ height: '100%', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, gap: 4, position: 'relative' }}>
        <span style={{ fontFamily: H.script, fontSize: 26, color: H.pink }}>Alsama</span>
        <span className="hf-lbl" style={{ fontSize: 9, marginTop: 6 }}>Certificate of Achievement</span>
        <span style={{ fontSize: 18, fontWeight: 700, marginTop: 10 }}><Field>Aisha Nasser</Field></span>
        <span className="hf-sub" style={{ fontSize: 11 }}>has achieved an overall grade of</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: H.pink, fontFamily: H.mono }}><Field>A</Field></span>
        <span className="hf-sub" style={{ fontSize: 10, marginTop: 8 }}>May 2026 cycle · Alsama Project</span>
      </div>
    </div>
  );
}
function Field({ children }) {
  return <span style={{ background: H.pinkSoft, color: H.pink, padding: '0 6px', borderRadius: 4 }}>{children}</span>;
}

function HFCertGenerate() {
  const [gen, setGen] = React.useState(false);
  const [pct, setPct] = React.useState(0);
  React.useEffect(() => {
    if (!gen) return;
    setPct(0);
    const id = setInterval(() => setPct(p => (p >= 100 ? (clearInterval(id), 100) : p + 4)), 120);
    return () => clearInterval(id);
  }, [gen]);

  const fields = [
    { ph: '{{student_name}}', to: 'Student full name' },
    { ph: '{{overall_grade}}', to: 'Overall grade (A–E)' },
    { ph: '{{cycle_name}}', to: 'Cycle name' },
    { ph: '{{date}}', to: 'Sign-off date' },
  ];
  return (
    <HShell active="Cycles" subnav={CYC_SUBNAV('c')}
      crumb="Cycles  ›  May 2026  ›  Certificates"
      actions={<HBadge tone="good"><HMark kind="pass" size={12} />Grades locked</HBadge>}>
      <div className="hf-row" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        {/* left: template + fields */}
        <div className="hf-col" style={{ flex: 1, padding: '26px 30px', gap: 22, minWidth: 0, overflow: 'hidden' }}>
          <div>
            <div className="hf-h1">Generate certificates</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>Upload your PowerPoint template, confirm the merge fields, preview, then generate one certificate per student.</div>
          </div>

          <div>
            <div className="hf-lbl" style={{ marginBottom: 10 }}>1 · Certificate template</div>
            <div className="hf-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 13 }}>
              <div style={{ width: 38, height: 38, borderRadius: 8, background: H.pinkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><HIco name="doc" size={18} color={H.pink} /></div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>alsama_certificate_2026.pptx</div><div className="hf-sub hf-mono" style={{ fontSize: 11 }}>1.2 MB · uploaded just now</div></div>
              <HBtn variant="ghost">Replace</HBtn>
            </div>
          </div>

          <div>
            <div className="hf-lbl" style={{ marginBottom: 10 }}>2 · Confirm merge fields</div>
            <div className="hf-card" style={{ overflow: 'hidden' }}>
              {fields.map((f, i) => (
                <div key={i} className="hf-row" style={{ padding: '11px 16px', gap: 12, borderBottom: i < fields.length - 1 ? `1px solid ${H.line}` : 'none' }}>
                  <span className="hf-mono" style={{ fontSize: 12, color: H.pink, background: H.pinkSoft, padding: '2px 8px', borderRadius: 5 }}>{f.ph}</span>
                  <HIco name="arrow" size={14} color={H.ink3} />
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{f.to}</span>
                  <HBadge tone="good"><HMark kind="pass" size={11} />Matched</HBadge>
                </div>
              ))}
            </div>
            <div className="hf-sub" style={{ fontSize: 12, marginTop: 9 }}>All 4 placeholders in your template were matched to data fields. Unmatched fields would be flagged here.</div>
          </div>
        </div>

        {/* right: preview + generate */}
        <div className="hf-col" style={{ width: 392, flex: '0 0 auto', borderLeft: `1px solid ${H.line2}`, background: H.tint, padding: '26px 24px', gap: 18 }}>
          <div className="hf-col" style={{ gap: 11 }}>
            <span className="hf-lbl">3 · Preview</span>
            <div className="hf-row" style={{ justifyContent: 'center' }}><CertPreview /></div>
            <div className="hf-sub" style={{ fontSize: 11.5, textAlign: 'center' }}>Sample using the first student's data · highlighted fields are merged</div>
          </div>

          <div style={{ flex: 1 }} />

          {!gen ? (
            <div className="hf-col" style={{ gap: 12 }}>
              <div className="hf-row" style={{ justifyContent: 'space-between' }}><span className="hf-lbl">4 · Generate</span><span className="hf-sub">4,812 students</span></div>
              <HBtn variant="pri" style={{ justifyContent: 'center', padding: '13px' }} onClick={() => setGen(true)}><HIco name="award" color="#fff" />Generate 4,812 certificates</HBtn>
            </div>
          ) : (
            <div className="hf-card" style={{ padding: '16px 18px', background: H.paper }}>
              <div className="hf-row" style={{ gap: 9, marginBottom: 12 }}>
                {pct < 100 ? <><span style={{ width: 8, height: 8, borderRadius: 999, background: H.pink }} /><span style={{ fontWeight: 700, fontSize: 13 }}>Generating…</span></> : <><HMark kind="pass" size={16} /><span style={{ fontWeight: 700, fontSize: 13 }}>Done</span></>}
                <div style={{ flex: 1 }} />
                <span className="hf-mono" style={{ fontSize: 12, color: H.ink2 }}>{Math.min(pct, 100)}%</span>
              </div>
              <HProgress pct={pct} tone={pct >= 100 ? 'good' : undefined} />
              <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 10 }}>{pct < 100 ? `Merging data into ${Math.round(48.12 * Math.min(pct, 100))} of 4,812…` : 'All certificates generated.'}</div>
              {pct >= 100 && <HBtn variant="pri" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>View results<HIco name="arrow" color="#fff" /></HBtn>}
            </div>
          )}
        </div>
      </div>
    </HShell>
  );
}

// ─── Results ───────────────────────────────────────────────────────
function HFCertResults() {
  const studs = [
    { id: '80412', n: 'Aisha Nasser', g: 'A', s: 'done' },
    { id: '80413', n: 'Omar Fares', g: 'C', s: 'done' },
    { id: '80414', n: 'Lena Mroue', g: 'B', s: 'done' },
    { id: '80415', n: 'Yusuf Khaled', g: 'C', s: 'gen' },
    { id: '80416', n: 'Sara Tarek', g: 'A', s: 'done' },
    { id: '80417', n: 'Hadi Rizk', g: 'D', s: 'error' },
    { id: '80418', n: 'Maya Saad', g: 'B', s: 'done' },
  ];
  const GB = ({ g }) => <span style={{ width: 22, height: 22, border: `1px solid ${H.line2}`, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: H.mono, fontSize: 11 }}>{g}</span>;
  return (
    <HShell active="Cycles" subnav={CYC_SUBNAV('c')}
      crumb="Cycles  ›  May 2026  ›  Certificates  ›  Results"
      actions={<HBtn variant="pri"><HIco name="download" color="#fff" />Download all (.zip)</HBtn>}>
      <div className="hf-col" style={{ flex: 1, minHeight: 0 }}>
        <div className="hf-row" style={{ padding: '20px 30px', gap: 24, borderBottom: `1px solid ${H.line}`, background: H.paper }}>
          <div><div className="hf-h1" style={{ fontSize: 20 }}>Certificates</div><div className="hf-sub" style={{ marginTop: 5 }}>May 2026 · generated from alsama_certificate_2026.pptx</div></div>
          <div style={{ flex: 1 }} />
          <HStat n="4,809" label="Complete" />
          <HStat n="2" label="Generating" />
          <div className="hf-col" style={{ gap: 3 }}><span className="hf-mono" style={{ fontSize: 25, fontWeight: 600, lineHeight: 1, color: H.bad }}>1</span><span className="hf-lbl" style={{ marginTop: 4 }}>Failed</span></div>
        </div>

        <div className="hf-row" style={{ padding: '11px 30px', gap: 9, borderBottom: `1px solid ${H.line}`, background: H.paper }}>
          <span className="hf-field" style={{ width: 220 }}><HIco name="search" color={H.ink3} />Search by name or ID</span>
          <HChip on>All</HChip><HChip>Complete</HChip><HChip>Failed</HChip>
          <div style={{ flex: 1 }} />
          <HBtn variant="ghost"><HIco name="refresh" />Retry failed</HBtn>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', background: H.paper }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th className="hf-th">Participant</th><th className="hf-th" style={{ textAlign: 'center', width: 90 }}>Grade</th>
              <th className="hf-th" style={{ width: 180 }}>Status</th><th className="hf-th" style={{ textAlign: 'right', width: 160 }}></th>
            </tr></thead>
            <tbody>
              {studs.map((s, i) => (
                <tr key={i} className="hf-hover">
                  <td className="hf-td"><span className="hf-mono" style={{ fontSize: 11, color: H.ink3, marginRight: 10 }}>{s.id}</span><span style={{ fontWeight: 600, fontSize: 13 }}>{s.n}</span></td>
                  <td className="hf-td" style={{ textAlign: 'center' }}><GB g={s.g} /></td>
                  <td className="hf-td">
                    {s.s === 'done' && <HBadge tone="good"><HMark kind="pass" size={11} />Complete</HBadge>}
                    {s.s === 'gen' && <HBadge tone="accent"><span style={{ width: 6, height: 6, borderRadius: 999, background: H.pink }} />Generating…</HBadge>}
                    {s.s === 'error' && <HBadge tone="bad"><HMark kind="fail" size={11} />Failed — name field empty</HBadge>}
                  </td>
                  <td className="hf-td" style={{ textAlign: 'right' }}>
                    {s.s === 'done' && <HBtn style={{ fontSize: 11.5 }}><HIco name="download" size={13} />Download</HBtn>}
                    {s.s === 'gen' && <span className="hf-sub" style={{ fontSize: 11.5 }}>—</span>}
                    {s.s === 'error' && <HBtn variant="danger" style={{ fontSize: 11.5 }}><HIco name="refresh" size={13} />Retry</HBtn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hf-sub" style={{ padding: '14px 30px' }}>Showing 7 of 4,812 · downloads are watermarked PDFs rendered from your template</div>
        </div>
      </div>
    </HShell>
  );
}

Object.assign(window, { HFCertGenerate, HFCertResults });
