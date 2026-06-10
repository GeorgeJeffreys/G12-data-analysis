// hfEntry.jsx — Entry screens: Sign-in (invite-only, Microsoft) + Access-denied state

function MSLogo({ s = 16 }) {
  const sq = s / 2 - 1;
  const C = ['#F25022', '#7FBA00', '#00A4EF', '#FFB900'];
  return (
    <span style={{ width: s, height: s, display: 'inline-grid', gridTemplateColumns: '1fr 1fr', gap: 2, flex: '0 0 auto' }}>
      {C.map((c, i) => <span key={i} style={{ background: c, width: sq, height: sq }} />)}
    </span>
  );
}

function EntryFrame({ children }) {
  return (
    <div className="hf hf-row" style={{ alignItems: 'stretch' }}>
      {/* brand panel */}
      <div className="hf-col" style={{ width: 460, flex: '0 0 auto', background: H.slate, color: '#fff', padding: '52px 48px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: 360, height: 360, borderRadius: 999, background: H.pink, opacity: .16, right: -150, top: -120 }} />
        <div style={{ position: 'absolute', width: 240, height: 240, borderRadius: 999, border: `2px solid ${H.pink}`, opacity: .18, left: -90, bottom: 40 }} />
        <div style={{ position: 'relative' }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, background: H.pink, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(193,44,104,.5)' }}>
            <span style={{ fontFamily: H.script, fontSize: 30, marginTop: 6 }}>A</span>
          </div>
          <div style={{ fontFamily: H.script, fontSize: 40, marginTop: 26, lineHeight: 1 }}>Alsama</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.15 }}>G12<span style={{ color: '#fff' }}>++</span> Exam<br/>Processing Suite</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,.72)', marginTop: 14, maxWidth: 320, lineHeight: 1.5 }}>Review item quality, set grade boundaries, and publish auditable results — one exam cycle at a time.</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative', fontSize: 11.5, color: 'rgba(255,255,255,.5)' }}>Alsama Project · internal assessment tool</div>
      </div>
      {/* content */}
      <div className="hf-col" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        {children}
      </div>
    </div>
  );
}

function HFSignin() {
  return (
    <EntryFrame>
      <div style={{ width: 380 }}>
        <div className="hf-h1" style={{ fontSize: 24 }}>Sign in</div>
        <div className="hf-sub" style={{ marginTop: 8, marginBottom: 26, fontSize: 13.5 }}>G12++ is invite-only. Use the Microsoft account your G12 lead added.</div>

        <button className="hf-btn pri" style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 14, gap: 10, background: H.paper, color: H.ink, border: `1px solid ${H.line2}`, boxShadow: 'none' }}>
          <MSLogo s={18} />Sign in with Microsoft
        </button>

        <div className="hf-row" style={{ gap: 12, margin: '24px 0' }}>
          <div style={{ flex: 1, height: 1, background: H.line }} />
          <span className="hf-sub" style={{ fontSize: 11 }}>invite-only</span>
          <div style={{ flex: 1, height: 1, background: H.line }} />
        </div>

        <div className="hf-card" style={{ padding: '14px 16px', background: H.tint, display: 'flex', gap: 11, alignItems: 'flex-start' }}>
          <HIco name="lock" size={16} color={H.ink2} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>No account yet?</div>
            <div className="hf-sub" style={{ fontSize: 12, marginTop: 3 }}>Access is granted by a G12 lead. Ask them to invite your Microsoft email, then sign in here.</div>
          </div>
        </div>
        <div className="hf-sub" style={{ fontSize: 11, marginTop: 22, textAlign: 'center' }}>Protected by Microsoft Entra ID · Alsama Project</div>
      </div>
    </EntryFrame>
  );
}

function HFDenied() {
  return (
    <EntryFrame>
      <div style={{ width: 400 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: H.warnSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
          <HMark kind="warn" size={24} />
        </div>
        <div className="hf-h1" style={{ fontSize: 23 }}>You're signed in — but not on the list</div>
        <div className="hf-sub" style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.55 }}>
          Your Microsoft account is authenticated, but it hasn't been granted access to G12++ yet. Only people a G12 lead has invited can enter.
        </div>

        <div className="hf-card" style={{ padding: '13px 15px', marginTop: 20, display: 'flex', alignItems: 'center', gap: 11 }}>
          <HAvatar name="Karim Osman" size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Karim Osman</div>
            <div className="hf-mono hf-sub" style={{ fontSize: 11.5 }}>k.osman@alsamaproject.com</div>
          </div>
          <HBadge tone="bad">No access</HBadge>
        </div>

        <div className="hf-col" style={{ gap: 9, marginTop: 22 }}>
          <HBtn variant="pri" style={{ width: '100%', justifyContent: 'center', padding: '12px' }}><HIco name="mail" color="#fff" />Email a G12 lead to request access</HBtn>
          <HBtn style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>Sign in with a different account</HBtn>
        </div>
        <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 18, textAlign: 'center' }}>Think this is a mistake? Your lead can add you under <span style={{ fontWeight: 600, color: H.ink2 }}>Settings › Users &amp; access</span>.</div>
      </div>
    </EntryFrame>
  );
}

Object.assign(window, { HFSignin, HFDenied });
