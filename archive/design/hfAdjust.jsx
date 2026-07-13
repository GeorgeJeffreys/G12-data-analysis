// hfAdjust.jsx — New scoring-model screens for G12++ (Alsama brand)
//  · Screen 1: Ingest additions — two optional, non-blocking uploads (HFIngestPlus)
//  · Screen 2: Adjustments stage — incident triage queue + student complaints (HFAdjustTriage)
//  · Screen 2b: Essay marks & per-student composition (HFAdjustEssay)
// Continues hf.jsx primitives, pipeline, and the left-primary / right-supporting discipline.
// The mark model is transparent everywhere:  MCQ marks + Essay marks + Alterations = Subject total.

const first = (n) => n.split(' ')[0];
const inits = (n) => n.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

// real cycle roster the typeahead searches over
const ROSTER = [
  { id: '80412', n: 'Aisha Nasser' }, { id: '80413', n: 'Omar Fadel' },
  { id: '80414', n: 'Leila Mansour' }, { id: '80421', n: 'Maya Hassan' },
  { id: '80440', n: 'Karim Daoud' }, { id: '80207', n: 'Omar Saleh' },
];

// ───────────────────────────────────────────────────────────────────
// Screen 1 — Ingest additions: two optional uploads beside the main export
// ───────────────────────────────────────────────────────────────────
function OptionalUpload({ icon, title, file, when, rows, lines, foot, footTone }) {
  return (
    <div className="hf-card hf-col" style={{ flex: 1, minWidth: 0, padding: '15px 16px', gap: 12, borderStyle: 'dashed', borderColor: H.line2 }}>
      <div className="hf-row" style={{ gap: 9 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: H.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}><HIco name={icon} color={H.ink2} size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="hf-row" style={{ gap: 8 }}><span className="hf-h2" style={{ fontSize: 13.5 }}>{title}</span><HBadge tone="neutral">Optional</HBadge></div>
        </div>
      </div>
      <div className="hf-row" style={{ gap: 10, padding: '9px 11px', border: `1px solid ${H.line2}`, borderRadius: 8, background: H.tint, alignItems: 'center' }}>
        <HIco name="doc" color={H.ink2} size={16} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="hf-mono" style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file}</div>
          <div className="hf-sub" style={{ fontSize: 10.5 }}>{when} · {rows}</div>
        </div>
        <HBadge tone="good"><HMark kind="pass" size={11} />Read</HBadge>
      </div>
      <div className="hf-col" style={{ gap: 6 }}>
        {lines.map((l, i) => (
          <div key={i} className="hf-row" style={{ gap: 8, fontSize: 11.5 }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: H.ink3, flex: '0 0 auto' }} />
            <span style={{ color: H.ink2, flex: 1 }}>{l.t}</span>
            <span className="hf-mono" style={{ color: l.tone === 'warn' ? H.warn : H.ink, fontWeight: 600 }}>{l.n}</span>
          </div>
        ))}
      </div>
      <div className="hf-row" style={{ gap: 8, marginTop: 'auto', paddingTop: 4, alignItems: 'center' }}>
        <span className="hf-sub" style={{ fontSize: 11, color: footTone === 'warn' ? H.warn : H.ink3, flex: 1 }}>{foot}</span>
        <HBtn variant="ghost" style={{ fontSize: 11 }}>Replace</HBtn>
        <HBtn variant="ghost" style={{ fontSize: 11 }}>Remove</HBtn>
      </div>
    </div>
  );
}

function HFIngestPlus() {
  const checks = [
    { k: 'pass', t: 'File format & encoding (UTF-8)', n: 'OK' },
    { k: 'pass', t: 'All 56 questions present', n: '56 / 56' },
    { k: 'pass', t: 'Participant IDs unique', n: '4,812' },
    { k: 'warn', t: 'Responses outside expected range', n: '14 rows' },
    { k: 'fail', t: 'Duplicate participant submissions', n: '6 rows' },
  ];
  return (
    <HShell active="Cycles" stage={1} done={1} stages={HSTAGES2} optIndex={-1}
      crumb="Cycles  ›  May 2026  ›  Ingest & validate  ›  English as a 2nd Language"
      actions={<HBtn variant="danger"><HIco name="upload" />Re-upload export</HBtn>}
      stageAction={<HBtn variant="pri" style={{ opacity: .45 }}>Continue to review<HIco name="arrow" color="#fff" /></HBtn>}>
      <div className="hf-row" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        <div className="hf-col" style={{ flex: 1, padding: '26px 30px', gap: 20, minWidth: 0 }}>
          <div>
            <div className="hf-h1">Ingest & validate</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>Upload the raw exam export. We check it before anything else happens. Essay marks and the incident log are optional extras you can add now.</div>
          </div>

          {/* PRIMARY upload — the exam export, dominant */}
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
              <span className="hf-sub" style={{ fontSize: 11.5 }}>3 passed · 1 warning · 1 must fix</span>
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

          {/* SECONDARY — two optional inputs, compact, non-blocking */}
          <div className="hf-col" style={{ gap: 11 }}>
            <div className="hf-row" style={{ gap: 10, alignItems: 'center' }}>
              <span className="hf-lbl">Optional inputs for this sitting</span>
              <div style={{ flex: 1, height: 1, background: H.line }} />
              <span className="hf-row" style={{ gap: 6, fontSize: 11, color: H.ink3 }}><HIco name="lock" size={11} color={H.ink3} />Never blocks the pipeline</span>
            </div>
            <div className="hf-row" style={{ gap: 14, alignItems: 'stretch' }}>
              <OptionalUpload icon="doc" title="Essay marks" file="essay_marks_may26.xlsx" when="added 2h ago" rows="1,790 scores"
                lines={[{ t: 'English essays matched', n: '1,402' }, { t: 'Arabic essays matched', n: '388' }, { t: 'Students not yet matched', n: '10', tone: 'warn' }]}
                foot="Offline-marked essays — English & Arabic only. Confirmed in Adjustments." footTone="warn" />
              <OptionalUpload icon="filter" title="Incident log" file="incident_log_may26.xlsx" when="added 2h ago" rows="23 incidents"
                lines={[{ t: 'Delivery incidents', n: '18' }, { t: 'Student complaints', n: '5' }, { t: 'Suggested name matches', n: '19' }]}
                foot="Free-text exam incidents — each is triaged into an alteration in Adjustments." />
            </div>
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

        {/* right supporting rail — unchanged cleaned-data preview */}
        <div className="hf-col" style={{ width: 340, flex: '0 0 auto', borderLeft: `1px solid ${H.line2}`, background: H.paper, boxShadow: '-12px 0 28px -18px rgba(31,42,49,.20)', padding: '26px 22px', gap: 13 }}>
          <div className="hf-row" style={{ justifyContent: 'space-between' }}>
            <span className="hf-lbl">Cleaned data preview</span><span className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>first 4 rows</span>
          </div>
          <div className="hf-card" style={{ overflow: 'hidden', background: H.paper }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr>{['ID', 'Q1', 'Q2', 'Q3', '…'].map(h => <th key={h} className="hf-th" style={{ padding: '7px 9px' }}>{h}</th>)}</tr></thead>
              <tbody>
                {[['80412', '1', '0', '1'], ['80413', '1', '1', '1'], ['80414', '0', '1', '0'], ['80415', '1', '1', '—']].map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j} className="hf-td hf-mono" style={{ padding: '7px 9px', color: c === '—' ? H.ink3 : H.ink }}>{c}</td>)}<td className="hf-td hf-mono" style={{ padding: '7px 9px', color: H.ink3 }}>…</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hf-sub">237 blanks shown as <span className="hf-mono">—</span> and scored 0. Two ID columns merged into one.</div>

          <div style={{ height: 1, background: H.line, margin: '6px 0' }} />
          <span className="hf-lbl">How a subject mark is built</span>
          <div className="hf-card" style={{ padding: '13px 14px', background: H.canvas }}>
            {[['1', 'MCQ marks', 'auto-scored from this export'], ['2', 'Essay marks', 'English & Arabic only'], ['3', 'Alterations', 'from incident triage']].map(([n, t, s], i) => (
              <div key={i} className="hf-row" style={{ gap: 10, padding: '7px 0', borderBottom: i < 2 ? `1px solid ${H.line}` : 'none' }}>
                <span className="hf-mono" style={{ width: 18, height: 18, borderRadius: 5, background: H.tint2, color: H.ink2, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{n}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 600 }}>{t}</div><div className="hf-sub" style={{ fontSize: 10.5 }}>{s}</div></div>
              </div>
            ))}
            <div className="hf-row" style={{ gap: 7, marginTop: 9, paddingTop: 9, borderTop: `1px solid ${H.line2}`, fontSize: 11.5, color: H.ink }}>
              <span className="hf-mono" style={{ fontWeight: 700 }}>= Subject total</span>
            </div>
          </div>
        </div>
      </div>
    </HShell>
  );
}

// ───────────────────────────────────────────────────────────────────
// Screen 1b — Ingest as three equal inputs (accordion)
//   Exam export · Essay marks · Incident log all read as equal options.
//   Click one to expand into its upload + validation report; collapse to
//   return all three to the same size. Single-open so height stays bounded.
// ───────────────────────────────────────────────────────────────────
function IngestDropzone({ file, size, when, rows, onReplace }) {
  return (
    <div className="hf-row" style={{ gap: 12, padding: '13px 15px', border: `1.5px dashed ${H.line2}`, borderRadius: 10,
      background: `repeating-linear-gradient(135deg, ${H.canvas} 0 11px, ${H.tint} 11px 12px)`, alignItems: 'center' }}>
      <span style={{ width: 34, height: 34, borderRadius: 8, background: H.paper, border: `1px solid ${H.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
        <HIco name="doc" color={H.ink2} size={17} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="hf-mono" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file}</div>
        <div className="hf-sub" style={{ fontSize: 11 }}>{size} · {when} · {rows}</div>
      </div>
      <HBadge tone="good"><HMark kind="pass" size={11} />Read</HBadge>
      <HBtn variant="ghost" style={{ fontSize: 11.5 }}><HIco name="upload" size={12} />Replace</HBtn>
    </div>
  );
}

function IngestReport({ title, note, checks }) {
  return (
    <div className="hf-col" style={{ gap: 9 }}>
      <div className="hf-row" style={{ gap: 10 }}>
        <span className="hf-lbl">{title}</span>
        <span className="hf-sub" style={{ fontSize: 11.5 }}>{note}</span>
      </div>
      <div className="hf-card" style={{ overflow: 'hidden' }}>
        {checks.map((c, i) => (
          <div key={i} className="hf-row" style={{ padding: '11px 14px', gap: 12, borderBottom: i < checks.length - 1 ? `1px solid ${H.line}` : 'none', background: c.k === 'fail' ? H.badSoft : 'transparent' }}>
            <HMark kind={c.k} size={16} />
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: c.k === 'fail' ? 600 : 500 }}>{c.t}</span>
            <span className="hf-mono" style={{ fontSize: 11.5, color: c.k === 'fail' ? H.bad : c.k === 'warn' ? H.warn : H.ink2 }}>{c.n}</span>
            {c.k !== 'pass' && <HBtn variant="ghost" style={{ fontSize: 11 }}>Review</HBtn>}
          </div>
        ))}
      </div>
    </div>
  );
}

function IngestPanel({ open, onToggle, icon, num, title, desc, required, tone, summary, children }) {
  // tone: 'good' | 'warn' | 'bad' | 'neutral' for the collapsed status pill
  const toneBadge = {
    good: <HBadge tone="good"><HMark kind="pass" size={11} />Validated</HBadge>,
    warn: <HBadge tone="warn"><HMark kind="warn" size={11} />Check matches</HBadge>,
    bad: <HBadge tone="bad"><HMark kind="fail" size={11} />1 must fix</HBadge>,
    neutral: <HBadge tone="neutral">Not added</HBadge>,
  }[tone];
  return (
    <div className="hf-card" style={{ overflow: 'hidden', flex: open ? '1 1 auto' : '0 0 auto',
      borderColor: open ? H.ink3 : H.line2,
      boxShadow: open ? '0 6px 26px -12px rgba(31,42,49,.30)' : '0 1px 2px rgba(44,55,57,.03)',
      transition: 'box-shadow .18s, border-color .18s' }}>
      {/* header — identical structure across all three, so collapsed they read equal */}
      <div onClick={onToggle} className="hf-row" style={{ gap: 14, padding: '17px 18px', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ width: 44, height: 44, borderRadius: 11, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? H.pinkSoft : H.tint, color: open ? H.pink : H.ink2, transition: '.18s' }}>
          <HIco name={icon} size={20} color="currentColor" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="hf-row" style={{ gap: 9 }}>
            <span className="hf-mono" style={{ fontSize: 11, color: H.ink3, fontWeight: 600, flex: '0 0 auto' }}>{num}</span>
            <span className="hf-h2" style={{ fontSize: 15, whiteSpace: 'nowrap', flex: '0 0 auto' }}>{title}</span>
            {required ? <HBadge tone="accent">Required</HBadge> : <HBadge tone="neutral">Optional</HBadge>}
          </div>
          <div className="hf-sub" style={{ fontSize: 12, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{desc}</div>
        </div>
        <div className="hf-col" style={{ alignItems: 'flex-end', gap: 6, flex: '0 0 auto' }}>
          {toneBadge}
          <span className="hf-mono" style={{ fontSize: 11, color: H.ink3, whiteSpace: 'nowrap' }}>{summary}</span>
        </div>
        <span style={{ width: 30, height: 30, borderRadius: 8, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? H.tint2 : 'transparent', color: H.ink2, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s, background .15s' }}>
          <HIco name="chev" size={16} color="currentColor" />
        </span>
      </div>
      {open && (
        <div className="hf-col" style={{ gap: 16, padding: '4px 20px 20px', borderTop: `1px solid ${H.line}` }}>
          <div style={{ height: 4 }} />
          {children}
        </div>
      )}
    </div>
  );
}

function HFIngestTriad() {
  const [open, setOpen] = React.useState('exam'); // single-open accordion; '' = all collapsed/equal
  const toggle = (k) => setOpen(o => (o === k ? '' : k));

  const examChecks = [
    { k: 'pass', t: 'File format & encoding (UTF-8)', n: 'OK' },
    { k: 'pass', t: 'All 56 questions present', n: '56 / 56' },
    { k: 'pass', t: 'Participant IDs unique', n: '4,812' },
    { k: 'warn', t: 'Responses outside expected range', n: '14 rows' },
    { k: 'fail', t: 'Duplicate participant submissions', n: '6 rows' },
  ];
  const essayChecks = [
    { k: 'pass', t: 'File format & encoding (UTF-8)', n: 'OK' },
    { k: 'pass', t: 'English essays matched to students', n: '1,402' },
    { k: 'pass', t: 'Arabic essays matched to students', n: '388' },
    { k: 'warn', t: 'Students not yet matched', n: '10 rows' },
  ];
  const incidentChecks = [
    { k: 'pass', t: 'File format & encoding (UTF-8)', n: 'OK' },
    { k: 'pass', t: 'Delivery incidents parsed', n: '18' },
    { k: 'pass', t: 'Student complaints parsed', n: '5' },
    { k: 'warn', t: 'Names needing confirmation', n: '4 of 23' },
  ];

  return (
    <HShell active="Cycles" stage={1} done={1} stages={HSTAGES2} optIndex={-1}
      crumb="Cycles  ›  May 2026  ›  Ingest & validate  ›  English as a 2nd Language"
      actions={<HBtn variant="ghost"><HIco name="doc" />Audit log</HBtn>}
      stageAction={<HBtn variant="pri" style={{ opacity: .45 }}>Continue to review<HIco name="arrow" color="#fff" /></HBtn>}>
      <div className="hf-row" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        <div className="hf-col" style={{ flex: 1, padding: '26px 30px', gap: 20, minWidth: 0 }}>
          <div>
            <div className="hf-h1">Ingest & validate</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 620 }}>Three inputs feed this sitting. Open any one to upload its file and read its validation report — collapse it again to see all three side by side. Only the exam export is required to continue.</div>
          </div>

          <div className="hf-col" style={{ gap: 12 }}>
            <IngestPanel
              open={open === 'exam'} onToggle={() => toggle('exam')}
              icon="upload" num="01" title="Raw exam export" required tone="bad"
              desc="The scored MCQ responses. Everything downstream is built from this file."
              summary="4,812 participants · 56 Q">
              <IngestDropzone file="exam_export_eng_may26.csv" size="3.1 MB" when="uploaded 2h ago" rows="4,812 rows" />
              <IngestReport title="Validation report" note="3 passed · 1 warning · 1 must fix" checks={examChecks} />
              <div className="hf-card" style={{ padding: '14px 16px', background: H.badSoft, borderColor: H.bad, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <HMark kind="fail" size={17} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: H.bad, fontSize: 13 }}>6 students submitted twice — resolve before scoring.</div>
                  <div className="hf-sub" style={{ marginTop: 4 }}>Keep the latest submission, keep the first, or exclude these students. You can also re-upload a corrected export.</div>
                  <div className="hf-row" style={{ gap: 9, marginTop: 11 }}><HBtn>Keep latest</HBtn><HBtn>Keep first</HBtn><HBtn variant="ghost">Exclude students</HBtn></div>
                </div>
              </div>
            </IngestPanel>

            <IngestPanel
              open={open === 'essay'} onToggle={() => toggle('essay')}
              icon="doc" num="02" title="Essay marks" tone="warn"
              desc="Offline-marked essays for English & Arabic, matched to each student."
              summary="1,790 scores · 10 unmatched">
              <IngestDropzone file="essay_marks_may26.xlsx" size="612 KB" when="added 2h ago" rows="1,790 scores" />
              <IngestReport title="Validation report" note="3 passed · 1 to confirm" checks={essayChecks} />
              <div className="hf-row" style={{ gap: 9, padding: '11px 14px', borderRadius: 9, background: H.warnSoft, color: H.warn, fontSize: 12, alignItems: 'center' }}>
                <HIco name="filter" size={14} color={H.warn} />
                <span style={{ flex: 1 }}>10 essays couldn't be auto-matched to a student. Confirm them in <strong>Adjustments → Essay marks</strong> — this never blocks the pipeline.</span>
                <HBtn variant="ghost" style={{ fontSize: 11.5, color: H.warn }}>Confirm matches</HBtn>
              </div>
            </IngestPanel>

            <IngestPanel
              open={open === 'incident'} onToggle={() => toggle('incident')}
              icon="filter" num="03" title="Incident log" tone="warn"
              desc="Free-text exam incidents, each triaged into a mark alteration."
              summary="23 incidents · 19 matched">
              <IngestDropzone file="incident_log_may26.xlsx" size="88 KB" when="added 2h ago" rows="23 incidents" />
              <IngestReport title="Validation report" note="3 passed · 1 to confirm" checks={incidentChecks} />
              <div className="hf-row" style={{ gap: 9, padding: '11px 14px', borderRadius: 9, background: H.tint, color: H.ink2, fontSize: 12, alignItems: 'center' }}>
                <HIco name="arrow" size={14} color={H.ink2} />
                <span style={{ flex: 1 }}>18 delivery incidents and 5 student complaints will appear in the <strong>Adjustments</strong> stage, where each becomes a per-student or per-subject alteration.</span>
                <HBtn variant="ghost" style={{ fontSize: 11.5 }}>Preview triage</HBtn>
              </div>
            </IngestPanel>
          </div>
        </div>

        {/* right supporting rail — ties the three inputs to the mark model */}
        <div className="hf-col" style={{ width: 320, flex: '0 0 auto', borderLeft: `1px solid ${H.line2}`, background: H.paper, boxShadow: '-12px 0 28px -18px rgba(31,42,49,.20)', padding: '26px 22px', gap: 14 }}>
          <span className="hf-lbl">How a subject mark is built</span>
          <div className="hf-card" style={{ padding: '13px 14px', background: H.canvas }}>
            {[['01', 'MCQ marks', 'from the exam export', H.bad], ['02', 'Essay marks', 'English & Arabic only', H.warn], ['03', 'Alterations', 'from incident triage', H.warn]].map(([n, t, s, c], i) => (
              <div key={i} className="hf-row" style={{ gap: 10, padding: '8px 0', borderBottom: i < 2 ? `1px solid ${H.line}` : 'none' }}>
                <span className="hf-mono" style={{ width: 20, height: 20, borderRadius: 6, background: H.tint2, color: H.ink2, fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{n}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{t}</div><div className="hf-sub" style={{ fontSize: 10.5 }}>{s}</div></div>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: c, flex: '0 0 auto' }} />
              </div>
            ))}
            <div className="hf-row" style={{ gap: 7, marginTop: 9, paddingTop: 9, borderTop: `1px solid ${H.line2}`, fontSize: 12, color: H.ink }}>
              <span className="hf-mono" style={{ fontWeight: 700 }}>= Subject total</span>
            </div>
          </div>

          <div style={{ height: 1, background: H.line, margin: '2px 0' }} />
          <span className="hf-lbl">Status of this sitting</span>
          <div className="hf-col" style={{ gap: 9 }}>
            {[['Raw exam export', 'bad', '1 must fix'], ['Essay marks', 'warn', '10 to confirm'], ['Incident log', 'warn', '4 to confirm']].map(([t, tone, s], i) => {
              const c = tone === 'bad' ? H.bad : tone === 'warn' ? H.warn : H.good;
              return (
                <div key={i} className="hf-row" style={{ gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: c, flex: '0 0 auto' }} />
                  <span style={{ flex: 1, fontSize: 12.5 }}>{t}</span>
                  <span className="hf-mono" style={{ fontSize: 11, color: c, fontWeight: 600 }}>{s}</span>
                </div>
              );
            })}
          </div>
          <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 2 }}>Optional inputs never block scoring. Resolve the exam export's 6 duplicates to continue.</div>
        </div>
      </div>
    </HShell>
  );
}

// ───────────────────────────────────────────────────────────────────
// Screen 2 — Adjustments stage (shared shell + tabs)
// ───────────────────────────────────────────────────────────────────
function AdjustShell({ tab, stageAction, children }) {
  const tabs = [
    { k: 'triage', label: 'Incident triage', sub: '23' },
    { k: 'essay', label: 'Essay marks & composition' },
  ];
  return (
    <HShell active="Cycles" stage={3} done={3} stages={HSTAGES2} optIndex={-1}
      crumb="Cycles  ›  May 2026  ›  Adjustments"
      actions={<HBtn variant="ghost"><HIco name="doc" />Audit log</HBtn>}
      stageAction={stageAction}>
      <div className="hf-row" style={{ flex: '0 0 auto', borderBottom: `1px solid ${H.line}`, padding: '0 24px', gap: 4, background: H.paper }}>
        {tabs.map(t => (
          <div key={t.k} className="hf-row" style={{ gap: 7, padding: '13px 15px', fontSize: 13, fontWeight: t.k === tab ? 700 : 500, color: t.k === tab ? H.pink : H.ink2, borderBottom: `3px solid ${t.k === tab ? H.pink : 'transparent'}`, cursor: 'pointer' }}>
            {t.label}{t.sub && <span className="hf-mono" style={{ fontSize: 10, color: t.k === tab ? H.pink : H.ink3, background: t.k === tab ? H.pinkSoft : H.tint2, padding: '1px 7px', borderRadius: 999 }}>{t.sub}</span>}
          </div>
        ))}
      </div>
      {children}
    </HShell>
  );
}

// — incident data (free-text, real-world messy) —
const TRIAGE = [
  {
    id: 'INC-04', name: 'Aisha Nasser', code: 'MATH-G12', subj: 'Applicable Math', qs: 'Q15', rtl: false,
    issue: 'Calculator tool froze mid-question; candidate waited ~4 min before the invigilator restarted the device.',
    action: 'Invigilator logged the fault and allowed the candidate to continue from the same question.',
    staff: 'S. Haddad', t: '09:12 – 09:18',
    match: { id: '80412', n: 'Aisha Nasser', conf: 'strong' },
    d: 'alter', applies: 'student', who: 'Aisha Nasser', marks: 2, reason: 'Confirmed technical fault — time lost', by: 'R. Mansour', at: '16:38',
  },
  {
    id: 'INC-09', name: 'Room B — all candidates', code: 'MATH-G12', subj: 'Applicable Math', qs: null, rtl: false,
    issue: 'Power outage in Room B; the session was paused for 8 minutes for all 26 candidates seated there.',
    action: 'Lost time was added back and the session resumed; no individual fault recorded.',
    staff: 'S. Haddad', t: '10:02 – 10:10',
    match: null,
    d: 'alter', applies: 'all', who: 'All in Applicable Math', marks: 0, note: 'Time restored — no mark change, logged for audit', reason: 'Delivery incident, whole room', by: 'R. Mansour', at: '16:40',
  },
  {
    id: 'INC-11', name: 'Leila M.', code: 'ARAB-G12', subj: 'Arabic 1st Lang', qs: 'Q33', rtl: true,
    issue: 'لم يظهر النص العربي بشكل صحيح في السؤال؛ اضطرت الطالبة لإعادة تحميل الصفحة.',
    action: 'أعاد المراقب تحميل الصفحة وتأكد من ظهور النص قبل المتابعة.',
    staff: 'N. Khalil', t: '11:20 – 11:24',
    match: { id: '80414', n: 'Leila Mansour', conf: 'strong' },
    d: 'await', open: true,
  },
  {
    id: 'INC-14', name: 'Omar', code: 'ENG-G12', subj: 'English 2nd Lang', qs: 'Q07', rtl: false,
    issue: 'Audio clip for the listening item would not play; candidate flagged it to the invigilator.',
    action: 'Invigilator could not reproduce the fault on review; noted for triage.',
    staff: 'R. Mansour', t: '13:41 – 13:43',
    match: { id: null, n: null, conf: 'ambiguous', count: 2 },
    d: 'await',
  },
  {
    id: 'INC-17', name: 'Karim Daoud', code: 'MATH-G12', subj: 'Applicable Math', qs: 'Q23', rtl: false,
    issue: 'Candidate reported brief screen flicker; said no time was lost and continued normally.',
    action: 'Invigilator observed no interruption to the session.',
    staff: 'S. Haddad', t: '09:50 – 09:51',
    match: { id: '80440', n: 'Karim Daoud', conf: 'strong' },
    d: 'noaction', by: 'R. Mansour', at: '16:42', reason: 'No time lost — informational only',
  },
  {
    id: 'INC-20', name: 'Maya Hassan', code: 'MATH-G12', subj: 'Applicable Math', qs: 'Q12, Q13', rtl: false,
    issue: 'Tablet battery died at 40%; candidate resumed on a replacement device after ~6 minutes.',
    action: 'Replacement issued; remaining time honoured.',
    staff: 'S. Haddad', t: '10:33 – 10:39',
    match: { id: '80421', n: 'Maya Hassan', conf: 'strong' },
    d: 'await',
  },
];

const COMPLAINTS = [
  { id: 'CMP-1', name: 'Sara Tarek', school: 'Al-Noor School', subj: 'English 2nd Lang', code: 'ENG-G12', rtl: false,
    text: 'I was given the wrong seat and lost time settling in before the exam started.', match: { id: null, n: null, conf: 'none' }, d: 'await' },
  { id: 'CMP-2', name: 'Yusuf Khalil', school: 'Cedars International', subj: 'English 2nd Lang', code: 'ENG-G12', rtl: false,
    text: 'The reading passage font was very small and hard to read on my screen.', match: { id: null, n: null, conf: 'ambiguous', count: 2 }, d: 'noaction', by: 'R. Mansour', at: '16:50', reason: 'Display met spec — no action' },
  { id: 'CMP-3', name: 'نور سالم', school: 'مدرسة الأندلس', subj: 'Arabic 1st Lang', code: 'ARAB-G12', rtl: true,
    text: 'انقطع الإنترنت لفترة قصيرة أثناء الامتحان مما أثّر على تركيزي.', match: { id: null, n: null, conf: 'none' }, d: 'await' },
];

function MatchHint({ match }) {
  if (!match) return null;
  if (match.conf === 'strong') {
    return (
      <span className="hf-row" style={{ gap: 6, fontSize: 11, padding: '3px 9px 3px 6px', borderRadius: 999, background: H.goodSoft, color: H.good, fontWeight: 600, whiteSpace: 'nowrap' }}>
        <HMark kind="pass" size={12} />Suggested: {match.n} · {match.id}
      </span>
    );
  }
  if (match.conf === 'ambiguous') {
    return <span className="hf-row" style={{ gap: 6, fontSize: 11, padding: '3px 9px', borderRadius: 999, background: H.warnSoft, color: H.warn, fontWeight: 600, whiteSpace: 'nowrap' }}><HMark kind="warn" size={12} />{match.count} possible matches — confirm</span>;
  }
  return <span className="hf-row" style={{ gap: 6, fontSize: 11, padding: '3px 9px', borderRadius: 999, background: H.tint2, color: H.ink2, fontWeight: 600, whiteSpace: 'nowrap' }}><HIco name="search" size={11} color={H.ink2} />No match — search roster</span>;
}

// the resolved-state decision summary (compact, right-aligned)
function DecisionSummary({ inc, kind }) {
  if (inc.d === 'alter') {
    const all = inc.applies === 'all';
    const pos = inc.marks > 0, neg = inc.marks < 0, zero = inc.marks === 0;
    const c = pos ? H.good : neg ? H.bad : H.ink2;
    return (
      <div className="hf-col" style={{ gap: 5, alignItems: 'flex-end', textAlign: 'right' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 6px', borderRadius: 999, background: all ? H.slate : H.pink, color: '#fff', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
          <span style={{ width: 18, height: 18, borderRadius: 999, background: 'rgba(255,255,255,.22)', fontSize: all ? 8.5 : 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{all ? 'ALL' : inits(inc.who)}</span>
          {zero ? 'No mark change' : `${pos ? '+' : '−'}${Math.abs(inc.marks)} mark${Math.abs(inc.marks) > 1 ? 's' : ''}`}
          <span style={{ opacity: .8, fontWeight: 600 }}>→ {all ? inc.subj : first(inc.who)}</span>
        </span>
        <span className="hf-sub" style={{ fontSize: 10.5, maxWidth: 260, textWrap: 'pretty' }}>{inc.note || inc.reason} · {inc.subj}</span>
        <div className="hf-row" style={{ gap: 8 }}>
          <span className="hf-row" style={{ gap: 4, fontSize: 10, color: H.ink3 }}><HIco name="lock" size={10} color={H.ink3} />{inc.by} · {inc.at}</span>
          <HBtn variant="ghost" style={{ fontSize: 10.5, padding: '3px 7px' }}>Change</HBtn>
        </div>
      </div>
    );
  }
  // no action / informational
  return (
    <div className="hf-col" style={{ gap: 5, alignItems: 'flex-end', textAlign: 'right' }}>
      <HBadge tone="neutral"><HMark kind="pass" size={11} />No action · informational</HBadge>
      <span className="hf-sub" style={{ fontSize: 10.5, maxWidth: 240, textWrap: 'pretty' }}>{inc.reason}</span>
      <div className="hf-row" style={{ gap: 8 }}>
        <span className="hf-row" style={{ gap: 4, fontSize: 10, color: H.ink3 }}><HIco name="lock" size={10} color={H.ink3} />{inc.by} · {inc.at}</span>
        <HBtn variant="ghost" style={{ fontSize: 10.5, padding: '3px 7px' }}>Change</HBtn>
      </div>
    </div>
  );
}

// the OPEN decision editor — applies-to · subject · alteration + reason
function DecisionEditor({ inc }) {
  const seg = [['student', 'This student'], ['all', 'All in subject'], ['none', 'No action']];
  const sel = 'student';
  return (
    <div className="hf-card" style={{ padding: '13px 14px', width: 312, borderColor: H.pink, boxShadow: '0 10px 28px -14px rgba(193,44,104,.45)' }}>
      {/* applies to */}
      <span className="hf-lbl" style={{ color: H.pink }}>Applies to</span>
      <div className="hf-row" style={{ border: `1px solid ${H.line2}`, borderRadius: 8, overflow: 'hidden', marginTop: 7 }}>
        {seg.map(([k, l], i) => (
          <span key={k} style={{ flex: 1, textAlign: 'center', padding: '7px 4px', fontSize: 11, fontWeight: sel === k ? 700 : 500, cursor: 'pointer', background: sel === k ? H.pinkSoft : H.paper, color: sel === k ? H.pink : H.ink2, borderLeft: i ? `1px solid ${H.line2}` : 'none' }}>{l}</span>
        ))}
      </div>

      {/* roster typeahead with suggestion */}
      <div className="hf-row" style={{ gap: 7, marginTop: 11, padding: '8px 10px', border: `1.5px solid ${H.pink}`, borderRadius: 8, background: H.pinkSoft2, alignItems: 'center' }}>
        <HAvatar name={inc.match.n} size={22} tone="pink" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{inc.match.n}</div>
          <div className="hf-mono hf-sub" style={{ fontSize: 10 }}>{inc.match.id} · matched from “{inc.name}”</div>
        </div>
        <HBtn variant="ghost" style={{ fontSize: 10.5, padding: '3px 7px' }}>Change</HBtn>
      </div>

      {/* subject (defaulted from code) */}
      <div className="hf-row" style={{ gap: 9, marginTop: 9, alignItems: 'center' }}>
        <span className="hf-lbl" style={{ width: 54 }}>Subject</span>
        <span className="hf-field" style={{ flex: 1, padding: '7px 10px', color: H.ink, justifyContent: 'space-between' }}>{inc.subj}<HIco name="chev" color={H.ink3} /></span>
      </div>
      <div className="hf-sub" style={{ fontSize: 10, marginTop: 4, marginLeft: 63 }}>defaulted from <span className="hf-mono">{inc.code}</span></div>

      {/* alteration stepper + reason */}
      <div className="hf-row" style={{ gap: 9, marginTop: 11, alignItems: 'center' }}>
        <span className="hf-lbl" style={{ width: 54 }}>Alteration</span>
        <div className="hf-row" style={{ gap: 6, alignItems: 'center' }}>
          <span style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${H.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: H.ink2, fontWeight: 700 }}>−</span>
          <span className="hf-mono" style={{ width: 58, textAlign: 'center', padding: '6px 0', borderRadius: 7, border: `1px solid ${H.pink}`, background: H.paper, fontSize: 14, fontWeight: 700, color: H.good }}>+2</span>
          <span style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${H.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: H.ink2, fontWeight: 700 }}>+</span>
          <span className="hf-sub" style={{ fontSize: 11 }}>marks</span>
        </div>
      </div>
      <div className="hf-col" style={{ gap: 5, marginTop: 9 }}>
        <span className="hf-lbl">Reason <span style={{ color: H.pink }}>· required</span></span>
        <div style={{ border: `1px solid ${H.line2}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: H.ink, background: H.paper, minHeight: 34 }}>Confirmed technical fault — calculator froze, ~4 min lost.</div>
      </div>

      <div className="hf-row" style={{ gap: 7, marginTop: 12 }}>
        <HBtn variant="pri" style={{ fontSize: 11.5 }}>Apply alteration</HBtn>
        <HBtn variant="ghost" style={{ fontSize: 11.5 }}>No action</HBtn>
      </div>
    </div>
  );
}

// outstanding but not yet open — a compact prompt
function DecisionPrompt({ inc }) {
  return (
    <div className="hf-col" style={{ gap: 8, alignItems: 'flex-end', textAlign: 'right' }}>
      <MatchHint match={inc.match} />
      <div className="hf-row" style={{ gap: 7 }}>
        <HBtn variant="pri" style={{ fontSize: 11.5 }}>Triage…</HBtn>
        <HBtn style={{ fontSize: 11.5 }}>No action</HBtn>
      </div>
      <span className="hf-sub" style={{ fontSize: 10.5 }}>set who it applies to & the mark change</span>
    </div>
  );
}

function TriageRow({ inc, complaint, last }) {
  const resolved = inc.d === 'alter' || inc.d === 'noaction';
  const rowBg = inc.d === 'alter' ? (inc.applies === 'all' ? H.canvas : H.pinkSoft2) : inc.open ? H.pinkSoft2 : 'transparent';
  return (
    <div className="hf-row" style={{ padding: '15px 17px', gap: 18, alignItems: 'flex-start', borderBottom: last ? 'none' : `1px solid ${H.line}`, background: rowBg }}>
      <div className="hf-col" style={{ flex: 1, gap: 8, minWidth: 0 }}>
        {/* context header */}
        <div className="hf-row" style={{ gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="hf-mono" style={{ fontSize: 10, color: H.ink3, border: `1px solid ${H.line2}`, padding: '1px 6px', borderRadius: 4 }}>{inc.id}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }} dir={inc.rtl ? 'rtl' : 'ltr'}>“{inc.name}”</span>
          <span className="hf-mono" style={{ fontSize: 10, color: H.ink2, background: H.tint2, padding: '2px 7px', borderRadius: 4 }}>{inc.code}</span>
          {complaint
            ? <span className="hf-row" style={{ gap: 5, fontSize: 11, color: H.ink2 }}><HIco name="mail" size={12} color={H.ink2} />{inc.school}</span>
            : (inc.qs
              ? <span className="hf-chip" style={{ fontSize: 10.5, padding: '2px 9px' }}>{inc.qs}</span>
              : <span className="hf-row" style={{ gap: 5, fontSize: 10.5, color: H.ink3, fontStyle: 'italic' }}>no question affected</span>)}
          {!resolved && <span style={{ marginLeft: 'auto' }}><HBadge tone={inc.open ? 'accent' : 'warn'}>{inc.open ? 'Triaging' : 'Outstanding'}</HBadge></span>}
        </div>
        {/* issue + action (read-only) */}
        <div style={{ fontSize: 12.5, color: H.ink, textWrap: 'pretty' }} dir={inc.rtl ? 'rtl' : 'ltr'}>{inc.issue || inc.text}</div>
        {inc.action && (
          <div className="hf-row" style={{ gap: 7, alignItems: 'flex-start' }} dir={inc.rtl ? 'rtl' : 'ltr'}>
            <span className="hf-lbl" style={{ fontSize: 9, marginTop: 2, flex: '0 0 auto' }}>Action taken</span>
            <span style={{ fontSize: 11.5, color: H.ink2, textWrap: 'pretty' }}>{inc.action}</span>
          </div>
        )}
        <div className="hf-row" style={{ gap: 12, marginTop: 1 }}>
          {inc.staff && <span className="hf-row" style={{ gap: 5, fontSize: 10.5, color: H.ink3 }}><HIco name="award" size={11} color={H.ink3} />{inc.staff}</span>}
          {inc.t && <span className="hf-mono" style={{ fontSize: 10.5, color: H.ink3 }}>{inc.t}</span>}
          <span className="hf-mono" style={{ fontSize: 9.5, color: H.ink3, border: `1px solid ${H.line2}`, padding: '0 5px', borderRadius: 4 }}>{complaint ? 'from complaints' : 'from incident log'}</span>
        </div>
      </div>
      {/* decision */}
      <div style={{ flex: '0 0 auto' }}>
        {inc.open ? <DecisionEditor inc={inc} /> : resolved ? <DecisionSummary inc={inc} /> : <DecisionPrompt inc={inc} />}
      </div>
    </div>
  );
}

function HFAdjustTriage({ state = 'working', stream = 'incidents' }) {
  const baseList = stream === 'complaints' ? COMPLAINTS : TRIAGE;
  // resolve everything in the "resolved" state
  const resolvers = {
    'INC-11': { d: 'alter', applies: 'student', who: 'Leila Mansour', marks: 2, reason: 'Confirmed display fault (Arabic text)', by: 'R. Mansour', at: '16:55', open: false },
    'INC-14': { d: 'noaction', reason: 'Audio confirmed working on review', by: 'R. Mansour', at: '16:57', open: false },
    'INC-20': { d: 'alter', applies: 'student', who: 'Maya Hassan', marks: 1, reason: 'Device failure — time lost', by: 'R. Mansour', at: '17:01', open: false },
    'CMP-1': { d: 'noaction', reason: 'Seating corrected at the time — no time lost', by: 'R. Mansour', at: '17:05' },
    'CMP-3': { d: 'alter', applies: 'student', who: 'نور سالم', marks: 1, reason: 'Connectivity drop confirmed in room log', by: 'R. Mansour', at: '17:08' },
  };
  const list = state === 'resolved' ? baseList.map(i => resolvers[i.id] ? { ...i, ...resolvers[i.id] } : i) : baseList;

  const nAlter = list.filter(i => i.d === 'alter').length;
  const nNo = list.filter(i => i.d === 'noaction').length;
  const nOut = list.filter(i => i.d === 'await').length;
  const net = list.filter(i => i.d === 'alter').reduce((s, i) => s + (i.marks || 0), 0);

  const complaint = stream === 'complaints';
  const otherCount = complaint ? TRIAGE.length : COMPLAINTS.length;

  const stageAction = nOut > 0
    ? <div className="hf-row" style={{ gap: 13 }}><span className="hf-sub" style={{ fontSize: 11.5 }}>{nOut} still outstanding — you can decide later</span><HBtn variant="pri">Continue to scoring<HIco name="arrow" color="#fff" /></HBtn></div>
    : <HBtn variant="pri">Continue to scoring<HIco name="arrow" color="#fff" /></HBtn>;

  return (
    <AdjustShell tab="triage" stageAction={stageAction}>
      <div className="hf-col" style={{ flex: 1, minHeight: 0 }}>
        {/* intro + ONE slim stats row */}
        <div className="hf-col" style={{ padding: '20px 28px 15px', gap: 15, borderBottom: `1px solid ${H.line}`, background: H.paper }}>
          <div className="hf-row" style={{ gap: 24, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="hf-h1">Incident triage</div>
              <div className="hf-sub" style={{ marginTop: 7, maxWidth: 640 }}>Each row is a raw, free-text incident from the log. Confirm who it applies to, then turn it into a mark alteration — or record no action. Every decision is audit-logged.</div>
            </div>
          </div>
          {state === 'resolved' && (
            <div className="hf-card" style={{ padding: '12px 16px', background: H.goodSoft, borderColor: H.good, display: 'flex', gap: 11, alignItems: 'center' }}>
              <HMark kind="pass" size={17} />
              <span style={{ fontSize: 13 }}><b>All {list.length} {complaint ? 'complaints' : 'incidents'} triaged.</b> {nAlter} alteration{nAlter !== 1 ? 's' : ''} applied, {nNo} recorded as no action. Net {net >= 0 ? '+' : '−'}{Math.abs(net)} marks moved.</span>
            </div>
          )}
          <div className="hf-row" style={{ gap: 38 }}>
            <HStat n={list.length} label={complaint ? 'Complaints' : 'Incidents'} sub="from log" />
            <HStat n={nAlter} label="Alterations applied" accent={nAlter > 0} />
            <HStat n={nNo} label="No action" sub="informational" />
            <HStat n={`${net >= 0 ? '+' : '−'}${Math.abs(net)}`} label="Net marks moved" />
            <HStat n={nOut} label="Outstanding" sub={nOut ? 'needs a decision' : 'all clear'} />
          </div>
        </div>

        {/* ONE filter row, with the incidents / complaints stream segment */}
        <div className="hf-row" style={{ gap: 11, padding: '12px 28px', borderBottom: `1px solid ${H.line}`, background: H.paper, flexWrap: 'wrap' }}>
          <div className="hf-row" style={{ border: `1px solid ${H.line2}`, borderRadius: 8, overflow: 'hidden' }}>
            {[['incidents', 'Incidents', stream === 'complaints' ? otherCount : list.length], ['complaints', 'Complaints', stream === 'complaints' ? list.length : otherCount]].map(([k, l, n], i) => (
              <span key={k} style={{ padding: '6px 13px', fontSize: 11.5, fontWeight: stream === k ? 700 : 500, cursor: 'pointer', background: stream === k ? H.pinkSoft : H.paper, color: stream === k ? H.pink : H.ink2, borderLeft: i ? `1px solid ${H.line2}` : 'none' }}>{l} <span className="hf-mono" style={{ fontSize: 10, opacity: .8 }}>{n}</span></span>
            ))}
          </div>
          <span style={{ width: 1, height: 20, background: H.line2, margin: '0 3px' }} />
          <span className="hf-field" style={{ width: 220 }}><HIco name="search" color={H.ink3} />Search name, ID or text</span>
          <HChip>All subjects<HIco name="chev" /></HChip>
          <HChip on={state !== 'resolved'}>Outstanding</HChip><HChip on={state === 'resolved'}>Resolved</HChip>
          <div style={{ flex: 1 }} />
          <span className="hf-sub">{list.length} {complaint ? 'complaints' : 'incidents'} · {nOut} outstanding</span>
        </div>

        {/* PRIMARY — the queue */}
        <div style={{ flex: 1, overflow: 'auto', background: H.canvas, padding: '18px 28px' }}>
          {complaint && (
            <div className="hf-row" style={{ gap: 9, marginBottom: 13, padding: '10px 14px', borderRadius: 9, background: H.tint, border: `1px solid ${H.line2}` }}>
              <HIco name="mail" size={15} color={H.ink2} />
              <span style={{ fontSize: 12, color: H.ink2 }}>Student-submitted complaints are reviewed the same way — confirm the student, then apply an alteration or record no action.</span>
            </div>
          )}
          <div className="hf-card" style={{ overflow: 'hidden' }}>
            {list.map((inc, i) => <TriageRow key={inc.id} inc={inc} complaint={complaint} last={i === list.length - 1} />)}
          </div>
          <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 13, display: 'flex', gap: 7, alignItems: 'center' }}><HIco name="lock" size={12} color={H.ink3} />Every alteration and no-action decision is attributed and written to the audit log. Re-opening the cycle is required to change a locked one.</div>
        </div>
      </div>
    </AdjustShell>
  );
}

// ───────────────────────────────────────────────────────────────────
// Screen 2b — Essay marks & per-student composition
// ───────────────────────────────────────────────────────────────────
const COMPO = {
  'English 2nd Lang': { mcqMax: 40, essayMax: 20, rows: [
    { id: '80412', n: 'Aisha Nasser', mcq: 34, essay: 16, alt: 2 },
    { id: '80413', n: 'Omar Fadel', mcq: 28, essay: 12, alt: 0 },
    { id: '80414', n: 'Leila Mansour', mcq: 31, essay: 17, alt: 0 },
    { id: '80415', n: 'Yusuf Khalil', mcq: 22, essay: 9, alt: 0 },
    { id: '80416', n: 'Sara Tarek', mcq: 37, essay: 18, alt: 0 },
    { id: '80421', n: 'Maya Hassan', mcq: 30, essay: null, alt: 1, unmatched: true },
  ] },
  'Arabic 1st Lang': { mcqMax: 38, essayMax: 22, rtl: true, rows: [
    { id: '80414', n: 'Leila Mansour', mcq: 33, essay: 19, alt: 2 },
    { id: '80433', n: 'Noor Salem', mcq: 29, essay: 20, alt: 1 },
    { id: '80417', n: 'Hadi Rashid', mcq: 24, essay: 14, alt: 0 },
  ] },
};

function CompoTable({ subj }) {
  const d = COMPO[subj];
  const total = (r) => r.essay == null ? null : r.mcq + r.essay + r.alt;
  const Op = ({ ch }) => <td style={{ padding: '0 2px', textAlign: 'center', color: H.ink3, fontSize: 14, fontWeight: 600, fontFamily: H.mono }}>{ch}</td>;
  const altC = (a) => a > 0 ? H.good : a < 0 ? H.bad : H.ink3;
  return (
    <div className="hf-card" style={{ overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th className="hf-th">Participant</th>
          <th className="hf-th" style={{ textAlign: 'right' }}>MCQ marks<div style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: H.ink3, fontSize: 9 }}>/ {d.mcqMax}</div></th>
          <th className="hf-th"></th>
          <th className="hf-th" style={{ textAlign: 'right' }}>Essay marks<div style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: H.ink3, fontSize: 9 }}>/ {d.essayMax}</div></th>
          <th className="hf-th"></th>
          <th className="hf-th" style={{ textAlign: 'right' }}>Alterations</th>
          <th className="hf-th"></th>
          <th className="hf-th" style={{ textAlign: 'right' }}>Subject total<div style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: H.ink3, fontSize: 9 }}>/ {d.mcqMax + d.essayMax}</div></th>
        </tr></thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={i} className={r.unmatched ? '' : 'hf-hover'} style={{ background: r.unmatched ? H.warnSoft : 'transparent' }}>
              <td className="hf-td"><div className="hf-row" style={{ gap: 11 }}><HAvatar name={r.n} size={28} /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }} dir={d.rtl ? 'rtl' : 'ltr'}>{r.n}</div><div className="hf-mono hf-sub" style={{ fontSize: 11 }}>{r.id}</div></div></div></td>
              <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 14 }}>{r.mcq}</td>
              <Op ch="+" />
              <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 14, color: r.essay == null ? H.warn : H.ink }}>{r.essay == null ? 'missing' : r.essay}</td>
              <Op ch="+" />
              <td className="hf-td hf-mono" style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, color: altC(r.alt) }}>{r.alt > 0 ? '+' : r.alt < 0 ? '−' : ''}{r.alt === 0 ? '0' : Math.abs(r.alt)}</td>
              <Op ch="=" />
              <td className="hf-td" style={{ textAlign: 'right' }}>
                {total(r) == null
                  ? <span className="hf-row" style={{ gap: 6, justifyContent: 'flex-end' }}><HBadge tone="warn">Essay unmatched</HBadge></span>
                  : <span className="hf-mono" style={{ fontSize: 15.5, fontWeight: 700 }}>{total(r)}<span style={{ color: H.ink3, fontWeight: 500, fontSize: 12 }}> / {d.mcqMax + d.essayMax}</span></span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HFAdjustEssay({ subj = 'English 2nd Lang' }) {
  const loads = [
    { s: 'English 2nd Lang', file: 'english_essays_may26.xlsx', matched: 1402, un: 7 },
    { s: 'Arabic 1st Lang', file: 'arabic_essays_may26.xlsx', matched: 388, un: 3, rtl: true },
  ];
  const tabs = ['English 2nd Lang', 'Arabic 1st Lang'];
  return (
    <AdjustShell tab="essay" stageAction={<HBtn variant="pri">Continue to scoring<HIco name="arrow" color="#fff" /></HBtn>}>
      <div className="hf-row" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        {/* PRIMARY — composition */}
        <div className="hf-col" style={{ flex: 1, minWidth: 0, padding: '22px 28px', gap: 18, overflow: 'auto' }}>
          <div>
            <div className="hf-h1">Essay marks & composition</div>
            <div className="hf-sub" style={{ marginTop: 7, maxWidth: 660 }}>Essays apply to English and Arabic only. This view shows exactly how each subject mark is built, so anyone can audit it later: <b style={{ color: H.ink }}>MCQ marks + Essay marks + Alterations = Subject total</b>.</div>
          </div>

          {/* subject tabs (essay subjects only) */}
          <div className="hf-row" style={{ gap: 8 }}>
            {tabs.map(t => (
              <span key={t} className="hf-chip" style={{ fontSize: 12, padding: '6px 13px', fontWeight: t === subj ? 700 : 500, color: t === subj ? H.pink : H.ink2, background: t === subj ? H.pinkSoft : H.paper, borderColor: t === subj ? H.pink : H.line2 }}>{t}{t.includes('Arabic') && <span className="hf-mono" style={{ fontSize: 9, marginLeft: 6, opacity: .7 }}>RTL</span>}</span>
            ))}
            <div style={{ flex: 1 }} />
            <span className="hf-field" style={{ width: 200 }}><HIco name="search" color={H.ink3} />Find a student</span>
          </div>

          <CompoTable subj={subj} />
          <div className="hf-sub" style={{ fontSize: 11.5, display: 'flex', gap: 7, alignItems: 'center' }}><HIco name="lock" size={12} color={H.ink3} />This composition is the audit record for every English and Arabic mark. Maxes shown include the essay component.</div>
        </div>

        {/* SUPPORTING — narrow essay-load status rail */}
        <div className="hf-col" style={{ width: 320, flex: '0 0 auto', borderLeft: `1px solid ${H.line2}`, background: H.paper, boxShadow: '-12px 0 28px -18px rgba(31,42,49,.20)', padding: '24px 22px', gap: 16 }}>
          <span className="hf-lbl">Essay marks loaded</span>
          {loads.map((l, i) => (
            <div key={i} className="hf-card" style={{ padding: '13px 14px' }}>
              <div className="hf-row" style={{ gap: 8, marginBottom: 9 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{l.s}{l.rtl && <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 6, border: `1px solid ${H.line2}`, padding: '0 5px', borderRadius: 4 }}>RTL</span>}</span>
                {l.un > 0 ? <HBadge tone="warn">{l.un} unmatched</HBadge> : <HBadge tone="good"><HMark kind="pass" size={11} />All matched</HBadge>}
              </div>
              <div className="hf-row" style={{ gap: 8, padding: '7px 9px', border: `1px solid ${H.line2}`, borderRadius: 7, background: H.tint, marginBottom: 10 }}>
                <HIco name="doc" size={14} color={H.ink2} />
                <span className="hf-mono" style={{ fontSize: 10.5, fontWeight: 600, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.file}</span>
              </div>
              <div className="hf-row" style={{ gap: 9 }}>
                <div style={{ flex: 1 }}><div className="hf-mono" style={{ fontSize: 18, fontWeight: 600, color: H.good }}>{l.matched.toLocaleString()}</div><div className="hf-lbl" style={{ marginTop: 2 }}>Matched</div></div>
                <div style={{ flex: 1 }}><div className="hf-mono" style={{ fontSize: 18, fontWeight: 600, color: l.un ? H.warn : H.ink3 }}>{l.un}</div><div className="hf-lbl" style={{ marginTop: 2 }}>Unmatched</div></div>
              </div>
              {l.un > 0 && <HBtn variant="ghost" style={{ fontSize: 11, marginTop: 10, width: '100%', justifyContent: 'center' }}>Match remaining {l.un}<HIco name="arrow" /></HBtn>}
            </div>
          ))}
          <div className="hf-card" style={{ padding: '12px 14px', background: H.canvas }}>
            <div className="hf-row" style={{ gap: 8 }}><HIco name="award" size={14} color={H.ink2} /><span className="hf-lbl">Other subjects</span></div>
            <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 7 }}>Math, Scientific Thinking and Life Skills are MCQ-only — no essay component, so their total is MCQ + Alterations.</div>
          </div>
        </div>
      </div>
    </AdjustShell>
  );
}

Object.assign(window, { HFIngestPlus, HFIngestTriad, HFAdjustTriage, HFAdjustEssay });
